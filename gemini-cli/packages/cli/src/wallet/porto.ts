/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@google/gemini-cli-core';
import { Storage } from '@google/gemini-cli-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import open from 'open';
import { Mode, Porto } from 'porto';
import { base, baseSepolia } from 'porto/Chains';
import { Dialog } from 'porto/cli';
import { Account, WalletActions } from 'porto/viem';
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  parseSignature,
  publicActions,
  type Abi,
  type Address,
  type WalletActions as ViemWalletActions
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { LoadedSettings } from '../config/settings.js';
import { registerCleanup } from '../utils/cleanup.js';
import { AppEvent, appEvents } from '../utils/events.js';

export type WalletChainSetting = 'base-sepolia' | 'base';

export interface WalletIdentityRecord {
  address: Address;
  chainIds: readonly number[];
  provider: 'porto';
  ts: number;
}

// Declare a typed cache on globalThis for the Porto wallet client
declare global {
  var __GEMINI_PORTO: Porto.Porto | undefined;
  var __GEMINI_PORTO_EPHEMERAL_CLIENT:
    | (ReturnType<typeof createWalletClient> & ViemWalletActions)
    | undefined;
  var __GEMINI_PORTO_IDENTITY: WalletIdentityRecord | undefined;
  var __GEMINI_PORTO_BUDGET_PROMPT: BudgetPromptState | undefined;
  var __GEMINI_PORTO_SESSION: PortoSessionState | undefined;
}

type GrantedPermission = Awaited<
  ReturnType<typeof WalletActions.grantPermissions>
>;

interface PortoSessionState {
  chainSetting: WalletChainSetting;
  chainId: number;
  identity: WalletIdentityRecord;
  account: ReturnType<typeof Account.from>;
  ephemeralAccount: ReturnType<typeof privateKeyToAccount>;
  permission?: GrantedPermission;
  usdcAddress?: Address;
  budgetLimit: bigint;
  fundedAmount: bigint;
  fundsTransferred: boolean;
  cleanupRegistered: boolean;
}

export interface BudgetPromptState {
  address: Address;
  balance: bigint;
  chainId: number;
  tokenSymbol: 'USDC';
  lastUpdated: number;
  balanceError?: string;
}

const USDC_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'nonces',
    outputs: [{ name: 'nonce', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'version',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    name: 'permit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const satisfies Abi;

const USDC_DECIMALS = 1_000_000n;

const USDC_CONFIGS: Record<number, { address: Address; name: string }> = {
  84532: {
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    name: 'USDC',
  },
  8453: {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    name: 'USD Coin',
  },
};

const USDC_TRANSFER_SIGNATURE = 'transfer(address,uint256)' as const;
const USDC_TRANSFER_FROM_SIGNATURE =
  'transferFrom(address,address,uint256)' as const;
const USDC_PERMIT_SIGNATURE =
  'permit(address,address,uint256,uint256,uint256,uint8,bytes32,bytes32)' as const;

export function getPendingBudgetPrompt(): BudgetPromptState | undefined {
  return globalThis.__GEMINI_PORTO_BUDGET_PROMPT;
}

export function clearPendingBudgetPrompt(): void {
  globalThis.__GEMINI_PORTO_BUDGET_PROMPT = undefined;
}

function createPublicClientForChain(chainSetting: WalletChainSetting) {
  return createWalletClient({
    chain: resolveChain(chainSetting),
    transport: http(),
  }).extend(publicActions);
}

function createPortoWalletClient(session: PortoSessionState) {
  return createWalletClient({
    chain: resolveChain(session.chainSetting),
    account: session.account,
    transport: custom(globalThis.__GEMINI_PORTO!.provider),
  });
}

async function readUsdcBalance(
  chainSetting: WalletChainSetting,
  token: Address,
  holder: Address,
): Promise<bigint> {
  const client = createPublicClientForChain(chainSetting);
  return (await client.readContract({
    abi: USDC_ABI,
    address: token,
    functionName: 'balanceOf',
    args: [holder],
  })) as bigint;
}

type EncodedCall = {
  to: Address;
  data: `0x${string}`;
};

async function transferSessionBudget(
  session: PortoSessionState,
  calls: EncodedCall[],
): Promise<void> {
  if (calls.length === 0) return;
  console.info('[wallet][session] executing call bundle', {
    callCount: calls.length,
    chainId: session.chainId,
    account: session.identity.address,
  });
  const walletClient = createPortoWalletClient(session);
  const { id } = await walletClient.sendCalls({
    chain: resolveChain(session.chainSetting),
    account: session.identity.address,
    calls,
  });

  console.info('[wallet][session] call bundle sent', { id });
}

async function ensureBudgetInBase(requiredBudget: bigint): Promise<void> {
  if (requiredBudget <= 0n) return;
  const session = assertSessionState();
  session.budgetLimit = requiredBudget;
  if (!session.permission) {
    console.info(
      '[wallet][session] ensureBudgetInBase skipped - no permission yet',
      {
        requested: requiredBudget.toString(),
      },
    );
    return;
  }
  const usdcConfig = session.usdcAddress
    ? {
        address: session.usdcAddress,
        name: getUsdcConfig(session.chainId)?.name,
      }
    : undefined;
  if (!usdcConfig) {
    console.warn(
      '[wallet][session] ensureBudgetInBase skipped - missing USDC config',
      {
        chainId: session.chainId,
      },
    );
    return;
  }

  const currentBalance = await readUsdcBalance(
    session.chainSetting,
    usdcConfig.address,
    session.ephemeralAccount.address,
  );
  if (currentBalance >= requiredBudget) {
    session.fundedAmount = currentBalance;
    return;
  }

  const delta = requiredBudget - currentBalance;
  if (delta <= 0n) return;

  console.info('[wallet][session] funding ephemeral account', {
    requested: requiredBudget.toString(),
    currentBalance: currentBalance.toString(),
    delta: delta.toString(),
  });
  const transferData = encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'transfer',
    args: [session.ephemeralAccount.address, delta],
  });

  await transferSessionBudget(session, [
    {
      to: usdcConfig.address,
      data: transferData,
    },
  ]);

  session.fundsTransferred = true;
  const updatedBalance = await readUsdcBalance(
    session.chainSetting,
    usdcConfig.address,
    session.ephemeralAccount.address,
  );
  session.fundedAmount = updatedBalance;
}

export function setSessionBudgetLimitUSDC(amount: number): void {
  const session = getSessionState();
  if (!session) return;
  session.budgetLimit = toUsdcBase(amount);
}

export async function applySessionBudgetSelection(
  budget: number,
): Promise<void> {
  const session = assertSessionState();
  const amountBase = toUsdcBase(budget);
  session.budgetLimit = amountBase;

  console.info('[wallet][session] applying budget selection', {
    budget,
    amountBase: amountBase.toString(),
    chainId: session.chainId,
    account: session.identity.address,
  });

  if (amountBase <= 0n) {
    console.info('[wallet][session] clearing session budget (<= 0)');
    session.permission = undefined;
    session.fundsTransferred = false;
    session.fundedAmount = 0n;
    return;
  }

  const usdcConfig = session.usdcAddress
    ? {
        address: session.usdcAddress,
        name: getUsdcConfig(session.chainId)?.name,
      }
    : undefined;
  if (!usdcConfig) {
    session.permission = undefined;
    session.fundsTransferred = false;
    session.fundedAmount = 0n;
    console.warn('[wallet][session] missing USDC config when applying budget', {
      chainId: session.chainId,
    });
    return;
  }

  await ensureWalletDialogOpen();

  const permissionExpirySeconds = Math.floor(Date.now() / 1000) + 4 * 3600;

  console.info('[wallet][session] requesting permission grant', {
    expiry: permissionExpirySeconds,
    spendLimit: amountBase.toString(),
  });
  const portoWalletClient = createPortoWalletClient(session);
  console.info('[wallet][session] created Porto wallet client', {
    chainId: portoWalletClient.chain?.id,
    account: portoWalletClient.account?.address,
    ephemeralAccount: session.ephemeralAccount.address,
  });

  console.log(
    '[wallet][session] existing permission:',
    await WalletActions.getPermissions(portoWalletClient),
  );

  // const permission = await globalThis.__GEMINI_PORTO?.provider.request({
  //   method: 'wallet_grantPermissions',
  //   params: [
  //     {
  //       expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 1 week
  //       feeToken: {
  //         limit: '1',
  //         symbol: 'USDC',
  //       },
  //       key: {
  //         publicKey: session.ephemeralAccount.address,
  //         type: 'secp256k1',
  //       },
  //       permissions: {
  //         calls: [
  //           {
  //             signature: 'transfer(address,uint256)',
  //             to: usdcConfig.address,
  //           },
  //         ],
  //         spend: [
  //           {
  //             limit: toHex(parseUnits('0.1', 6)), // 0.1 USDC
  //             period: 'day',
  //             token: usdcConfig.address,
  //           },
  //         ],
  //       },
  //     },
  //   ],
  // });

  let permission;
  try {
    permission = await withUrlAutoOpen(() =>
      WalletActions.grantPermissions(portoWalletClient, {
        chainId: session.chainId,
        expiry: permissionExpirySeconds,
        feeToken: {
          limit: '0.1',
          symbol: 'USDC',
        },
        key: {
          publicKey: session.ephemeralAccount.address,
          type: 'address',
        },
        permissions: {
          calls: [
            {
              signature: USDC_TRANSFER_SIGNATURE,
              to: usdcConfig.address,
            },
            {
              signature: USDC_TRANSFER_FROM_SIGNATURE,
              to: usdcConfig.address,
            },
            {
              signature: USDC_PERMIT_SIGNATURE,
              to: usdcConfig.address,
            },
          ],
          spend: [
            {
              limit: amountBase,
              period: 'day',
              token: usdcConfig.address,
            },
          ],
          // signatureVerification: {
          //   addresses: [session.ephemeralAccount.address],
          // },
        },
      }),
    );
    console.log('Permission granted:', permission);
  } catch (e) {
    console.error('Permission grant failed:', e);
    throw e;
  }

  session.permission = permission;

  if (!session.cleanupRegistered) {
    registerCleanup(returnSessionFunds);
    session.cleanupRegistered = true;
  }

  console.info('[wallet][session] permission granted', {
    permissionId: permission?.id!,
  });
}

export async function ensureSessionBudgetFundedUSDC(
  amount: number,
): Promise<void> {
  const required = toUsdcBase(amount);
  if (required <= 0n) return;
  await ensureBudgetInBase(required);
}

function queueBudgetPrompt(state: BudgetPromptState): void {
  globalThis.__GEMINI_PORTO_BUDGET_PROMPT = state;
  appEvents.emit(AppEvent.ShowBudgetDialog, state);
}

function getSessionState(): PortoSessionState | undefined {
  return globalThis.__GEMINI_PORTO_SESSION;
}

function setSessionState(state: PortoSessionState): void {
  globalThis.__GEMINI_PORTO_SESSION = state;
}

function assertSessionState(): PortoSessionState {
  const session = getSessionState();
  if (!session) {
    throw new Error('Porto session state unavailable');
  }
  return session;
}

function getUsdcConfig(chainId: number) {
  return USDC_CONFIGS[chainId];
}

function toUsdcBase(amount: number): bigint {
  if (Number.isNaN(amount) || amount <= 0) return 0n;
  return BigInt(Math.round(amount * Number(USDC_DECIMALS)));
}

function resolveChain(chain: WalletChainSetting) {
  switch (chain) {
    case 'base':
      return base;
    case 'base-sepolia':
    default:
      return baseSepolia;
  }
}

function getWalletIdentityPath(): string {
  const dir = Storage.getGlobalGeminiDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'wallet_identity.json');
}

export function readStoredWalletIdentity(): WalletIdentityRecord | null {
  try {
    const p = getWalletIdentityPath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw) as WalletIdentityRecord;
  } catch {
    return null;
  }
}

export function clearStoredWalletIdentity(): void {
  try {
    const p = getWalletIdentityPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    globalThis.__GEMINI_PORTO_IDENTITY = undefined;
    globalThis.__GEMINI_PORTO_BUDGET_PROMPT = undefined;
    globalThis.__GEMINI_PORTO_SESSION = undefined;
  } catch {
    // ignore
  }
}

function interceptStdoutForUrls(onUrl: (url: string) => void) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const origWrite = process.stdout.write.bind(process.stdout);
  const origErrWrite = process.stderr.write.bind(process.stderr);
  let opened = false;

  function check(chunk: string | Buffer) {
    try {
      const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      const match = str.match(urlRegex);
      if (match && match.length > 0 && !opened) {
        opened = true;
        onUrl(match[0]);
      }
    } catch (_) {
      // ignore parse errors
    }
  }

  // Wrap writes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout.write as any) = (chunk: any, encoding?: any, cb?: any) => {
    check(chunk);
    return origWrite(chunk, encoding as never, cb as never);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr.write as any) = (chunk: any, encoding?: any, cb?: any) => {
    check(chunk);
    return origErrWrite(chunk, encoding as never, cb as never);
  };

  return () => {
    // restore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout.write as any) = origWrite;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr.write as any) = origErrWrite;
  };
}

async function withUrlAutoOpen<T>(
  operation: () => Promise<T>,
  onOpenUrl?: (url: string) => void,
): Promise<T> {
  const restore = interceptStdoutForUrls(async (url) => {
    try {
      await open(url);
      if (onOpenUrl) onOpenUrl(url);
    } catch (error) {
      console.error('Could not auto-open browser:', error);
    }
  });
  try {
    return await operation();
  } finally {
    restore();
  }
}

export async function connectPortoWallet(
  effectiveChain: WalletChainSetting,
  onOpenUrl?: (url: string) => void,
): Promise<WalletIdentityRecord | null> {
  const chain = resolveChain(effectiveChain);

  const dialog = await Dialog.cli();
  const host = process.env['PORT']
    ? new URL(`/dialog`, `https://localhost:${process.env['PORT']}/`).toString()
    : undefined;
  const porto = Porto.create({
    chains: [chain],
    mode: Mode.dialog({
      ...(host ? { host } : {}),
      renderer: dialog,
    }),
  });

  const client = createWalletClient({
    chain,
    transport: custom(porto.provider),
  });

  const publicClient = client.extend(publicActions);

  // Intercept stdout/stderr to auto-open login URLs printed by the dialog
  const restore = interceptStdoutForUrls(async (url) => {
    try {
      await open(url);
      if (onOpenUrl) onOpenUrl(url);
    } catch (e) {
      // ignore open errors, user can still click manually
      console.error('Could not auto-open browser:', e);
    }
  });

  const { chainIds, accounts } = await WalletActions.connect(client, {
    email: true,
    chainIds: [chain.id],
  });

  // Restore stdout/stderr
  restore();

  const identity: WalletIdentityRecord = {
    address: accounts[0].address,
    chainIds,
    provider: 'porto',
    ts: Date.now(),
  };

  globalThis.__GEMINI_PORTO = porto;
  globalThis.__GEMINI_PORTO_IDENTITY = identity;

  const account = Account.from(accounts[0]);
  const usdcConfig = getUsdcConfig(chain.id);
  const usdcAddress = usdcConfig?.address;

  const ephemeralPK = generatePrivateKey();
  const ephemeralAccount = privateKeyToAccount(ephemeralPK);
  console.log('Ephemeral address:', ephemeralAccount.address);

  const sessionState: PortoSessionState = {
    chainSetting: effectiveChain,
    chainId: chain.id,
    identity,
    account,
    ephemeralAccount,
    permission: undefined,
    usdcAddress,
    budgetLimit: 0n,
    fundedAmount: 0n,
    fundsTransferred: false,
    cleanupRegistered: false,
  };
  setSessionState(sessionState);

  if (usdcAddress) {
    try {
      const balance = await publicClient.readContract({
        abi: USDC_ABI,
        address: usdcAddress,
        functionName: 'balanceOf',
        args: [identity.address],
      });
      queueBudgetPrompt({
        address: identity.address,
        balance: balance as bigint,
        chainId: chain.id,
        tokenSymbol: 'USDC',
        lastUpdated: Date.now(),
        balanceError: undefined,
      });
    } catch (error) {
      console.warn('Failed to fetch USDC balance for budget dialog:', error);
      queueBudgetPrompt({
        address: identity.address,
        balance: 0n,
        chainId: chain.id,
        tokenSymbol: 'USDC',
        lastUpdated: Date.now(),
        balanceError:
          error instanceof Error ? error.message : 'Unable to retrieve balance',
      });
    }
  }

  // Send success + close dialog messages
  Dialog.messenger.send('success', {
    title: 'Wallet connected',
    content: `Account: ${identity.address}\n\nReturn to the Gemini CLI to choose your x402 session budget.`,
  });

  if (!sessionState.cleanupRegistered) {
    registerCleanup(returnSessionFunds);
    sessionState.cleanupRegistered = true;
  }

  const ephemeralClient = createWalletClient({
    chain,
    account: ephemeralAccount,
    transport: http(),
  }).extend(publicActions);

  globalThis.__GEMINI_PORTO_EPHEMERAL_CLIENT = ephemeralClient;

  Dialog.messenger.send('success', {
    title: 'Ephemeral session created',
    content: `Ephemeral account: ${ephemeralAccount.address}`,
  });

  // Persist globally so UI can pick it up later
  fs.writeFileSync(getWalletIdentityPath(), JSON.stringify(identity, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });

  Dialog.messenger.send('close', undefined);
  return identity;
}

async function returnSessionFunds(): Promise<void> {
  const session = getSessionState();
  if (!session || !session.fundsTransferred || !session.permission) return;
  const usdcConfig = session.usdcAddress
    ? {
        address: session.usdcAddress,
        name: getUsdcConfig(session.chainId)?.name,
      }
    : undefined;
  if (!usdcConfig) return;

  try {
    console.info(
      '[wallet][session] returning remaining USDC to primary account',
    );
    const currentBalance = await readUsdcBalance(
      session.chainSetting,
      usdcConfig.address,
      session.ephemeralAccount.address,
    );
    if (currentBalance === 0n) {
      session.fundsTransferred = false;
      session.fundedAmount = 0n;
      return;
    }

    const publicClient = createPublicClientForChain(session.chainSetting);
    const nonce = (await publicClient.readContract({
      abi: USDC_ABI,
      address: usdcConfig.address,
      functionName: 'nonces',
      args: [session.ephemeralAccount.address],
    })) as bigint;

    const version = (await publicClient.readContract({
      abi: USDC_ABI,
      address: usdcConfig.address,
      functionName: 'version',
      args: [],
    })) as string;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const domain = {
      name: usdcConfig.name ?? 'USDC',
      version,
      chainId: session.chainId,
      verifyingContract: usdcConfig.address,
    } as const;

    const permitTypes = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    } as const;

    const permitMessage = {
      owner: session.ephemeralAccount.address,
      spender: session.identity.address,
      value: currentBalance,
      nonce,
      deadline,
    } as const;

    const permitSignature = await session.ephemeralAccount.signTypedData({
      domain,
      primaryType: 'Permit',
      types: permitTypes,
      message: permitMessage,
    });

    const { r, s, v } = parseSignature(permitSignature);

    const permitData = encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'permit',
      args: [
        session.ephemeralAccount.address,
        session.identity.address,
        currentBalance,
        deadline,
        Number(v),
        r,
        s,
      ],
    });

    const transferFromData = encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'transferFrom',
      args: [
        session.ephemeralAccount.address,
        session.identity.address,
        currentBalance,
      ],
    });

    await transferSessionBudget(session, [
      { to: usdcConfig.address, data: permitData },
      { to: usdcConfig.address, data: transferFromData },
    ]);

    session.fundsTransferred = false;
    session.fundedAmount = 0n;
  } catch (error) {
    console.warn('Failed to return session USDC to primary wallet:', error);
  }
}

export async function maybeAutoConnectWallet(
  settings: LoadedSettings,
  argvWalletChain: string | undefined,
  _config: Config,
): Promise<WalletIdentityRecord | null> {
  const provider = settings.merged.wallet?.provider as unknown as
    | string
    | undefined;
  const auto = settings.merged.wallet?.autoConnect ?? false;
  if (provider !== 'porto' || !auto) return null;

  const chainSetting = (argvWalletChain ||
    settings.merged.wallet?.chain ||
    'base-sepolia') as WalletChainSetting;
  try {
    const identity = await connectPortoWallet(chainSetting, (url) => {
      console.log(`Opening browser to complete wallet login: ${url}`);
    });
    return identity;
  } catch (e) {
    console.error('Wallet connect failed:', e);
    return null;
  }
}

/**
 * Returns a viem WalletClient that can sign transactions via the Porto provider.
 * Requires a connected wallet (persisted identity). Throws otherwise.
 */
export async function getWalletClient(chain: WalletChainSetting) {
  const parsedChain = resolveChain(chain);
  return createWalletClient({
    account: __GEMINI_PORTO_IDENTITY?.address!,
    transport: custom(globalThis.__GEMINI_PORTO!.provider),
    chain: parsedChain,
  }).extend(publicActions);
}

export async function getEphemeralWalletClient() {
  const session = getSessionState();
  if (!session) {
    await connectPortoWallet('base-sepolia');
  }
  const resolvedSession = assertSessionState();
  const existing = globalThis.__GEMINI_PORTO_EPHEMERAL_CLIENT;
  if (!existing || existing.chain?.id !== resolvedSession.chainId) {
    globalThis.__GEMINI_PORTO_EPHEMERAL_CLIENT = createWalletClient({
      chain: resolveChain(resolvedSession.chainSetting),
      account: resolvedSession.ephemeralAccount,
      transport: http(),
    }).extend(publicActions);
  }
  return globalThis.__GEMINI_PORTO_EPHEMERAL_CLIENT!;
}

/** Ensure the Porto dialog CLI renderer is active before signing flows.
 * Safe to call multiple times; it will no-op if already initialized. */
export async function ensureWalletDialogOpen(): Promise<void> {
  try {
    await Dialog.cli();
  } catch {
    // ignore; renderer likely already initialized
  }
}
