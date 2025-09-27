/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@google/gemini-cli-core';
import { Storage } from '@google/gemini-cli-core';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import open from 'open';
import { Mode, Porto } from 'porto';
import { base, baseSepolia } from 'porto/Chains';
import { Dialog } from 'porto/cli';
import { Account, WalletActions } from 'porto/viem';
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  parseErc6492Signature,
  publicActions,
  toHex,
  type Abi,
  type Address,
  type EncodeFunctionDataParameters,
  type Hex,
  type WalletActions as ViemWalletActions,
} from 'viem';
import { generatePrivateKey } from 'viem/accounts';
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
  var __GEMINI_EPHEMERAL_PORT: Porto.Porto | undefined;
  var __GEMINI_PORTO_EPHEMERAL_CLIENT:
    | (ReturnType<typeof createWalletClient> & ViemWalletActions)
    | undefined;
  var __GEMINI_PORTO_IDENTITY: WalletIdentityRecord | undefined;
  var __GEMINI_PORTO_BUDGET_PROMPT: BudgetPromptState | undefined;
  var __GEMINI_PORTO_SESSION: PortoSessionState | undefined;
}

interface PortoSessionState {
  chainSetting: WalletChainSetting;
  chainId: number;
  identity: WalletIdentityRecord;
  account: Address;
  ephemeralPK: Hex;
  ephemeralAccount: ReturnType<typeof Account.fromPrivateKey>;
  usdcAddress?: Address;
  usdcVersion?: string;
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
  {
    inputs: [
      {
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'value',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'validAfter',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'validBefore',
        type: 'uint256',
      },
      {
        internalType: 'bytes32',
        name: 'nonce',
        type: 'bytes32',
      },
      {
        internalType: 'bytes',
        name: 'signature',
        type: 'bytes',
      },
    ],
    name: 'transferWithAuthorization',
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

const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// const USDC_TRANSFER_SIGNATURE = 'transfer(address,uint256)' as const;
// const USDC_TRANSFER_FROM_SIGNATURE =
//   'transferFrom(address,address,uint256)' as const;
// const USDC_PERMIT_SIGNATURE =
//   'permit(address,address,uint256,uint256,uint256,uint8,bytes32,bytes32)' as const;

export function getPendingBudgetPrompt(): BudgetPromptState | undefined {
  return globalThis.__GEMINI_PORTO_BUDGET_PROMPT;
}

export function clearPendingBudgetPrompt(): void {
  globalThis.__GEMINI_PORTO_BUDGET_PROMPT = undefined;
}

function createPublicClientForChain(chainSetting: WalletChainSetting) {
  return createPublicClient({
    chain: resolveChain(chainSetting),
    transport: http(),
  });
}

function createPortoWalletClient(session: PortoSessionState) {
  const tmp = createWalletClient({
    chain: resolveChain(session.chainSetting),
    account: session.account,
    transport: custom(globalThis.__GEMINI_PORTO!.provider),
  }).extend(publicActions);
  console.log('Created porto wallet client for account:', tmp.account.address);
  return tmp;
}

function createNonce(): `0x${string}` {
  return `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
}

async function ensureUsdcVersion(
  session: PortoSessionState,
): Promise<string | undefined> {
  if (!session.usdcAddress) return undefined;
  if (!session.usdcVersion) {
    try {
      const client = createPublicClientForChain(session.chainSetting);
      session.usdcVersion = (await client.readContract({
        abi: USDC_ABI,
        address: session.usdcAddress,
        functionName: 'version',
        args: [],
      })) as string;
    } catch (error) {
      console.warn('[wallet][session] failed to fetch USDC version', error);
    }
  }
  return session.usdcVersion;
}

async function buildTransferWithAuthorizationCall(
  session: PortoSessionState,
  params: {
    from: Address;
    to: Address;
    value: bigint;
    signer: 'identity' | 'ephemeral';
  },
): Promise<
  Omit<
    EncodeFunctionDataParameters<typeof USDC_ABI, 'transferWithAuthorization'>,
    'abi' | 'functionName'
  >
> {
  const usdcAddress = session.usdcAddress;
  if (!usdcAddress) {
    throw new Error('USDC address is not available for the current session.');
  }
  const config = getUsdcConfig(session.chainId);
  if (!config) {
    throw new Error(`No USDC config found for chain ${session.chainId}`);
  }

  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 4 * 3600);
  const nonce = createNonce();
  const version = (await ensureUsdcVersion(session)) ?? '2';

  const domain = {
    name: config.name,
    version,
    chainId: session.chainId,
    verifyingContract: usdcAddress,
  } as const;

  const message = {
    from: params.from,
    to: params.to,
    value: params.value,
    validAfter,
    validBefore,
    nonce,
  } as const;

  let signature: Hex;
  if (params.signer === 'identity') {
    const walletClient = createPortoWalletClient(session);
    ({ signature } = parseErc6492Signature(
      await walletClient.signTypedData({
        account: session.account,
        domain,
        types: TRANSFER_WITH_AUTH_TYPES,
        primaryType: 'TransferWithAuthorization',
        message,
      }),
    ));

    const publicClient = createPublicClientForChain(session.chainSetting);
    const isCorrect = await publicClient.verifyTypedData({
      address: session.account,
      domain,
      types: TRANSFER_WITH_AUTH_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
      signature,
    });
    console.log('Signature verification result:', isCorrect);
  } else {
    signature = await session.ephemeralAccount.signTypedData({
      domain,
      types: TRANSFER_WITH_AUTH_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    });
  }

  return {
    args: [
      params.from,
      params.to,
      params.value,
      validAfter,
      validBefore,
      nonce,
      signature,
    ],
  };
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

async function submitReturnTransfer(
  session: PortoSessionState,
  data: Omit<
    EncodeFunctionDataParameters<typeof USDC_ABI, 'transferWithAuthorization'>,
    'abi' | 'functionName'
  >,
): Promise<void> {
  const usdcAddress = session.usdcAddress;
  if (!usdcAddress) {
    console.warn('[wallet][session] submitReturnTransfer skipped - no USDC address');
    return;
  }

  const paymasterPaymentUrl = getPaymasterPaymentUrl();
  console.info('[wallet][session] attempting to use paymaster relay', {
    paymasterPaymentUrl,
    chainId: session.chainId,
    account: session.ephemeralAccount.address,
  });

  if (paymasterPaymentUrl) {
    try {
      const response = await fetch(paymasterPaymentUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          {
            args: data.args,
            chainId: session.chainId,
          },
          (_, v) => (typeof v === 'bigint' ? toHex(v) : v),
        ),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `paymaster payment relay failed with status ${response.status}: ${errorText}`,
        );
      }

      const result = (await response.json().catch(() => undefined)) as
        | { hash?: string }
        | undefined;

      console.info('[wallet][session] paymaster relay submitted', {
        to: data.args[1],
        hash: result?.hash,
      });
      console.log('[wallet][session] paymaster relay completed', {
        chainId: session.chainId,
        account: session.ephemeralAccount.address,
      });
      return;
    } catch (paymasterError) {
      console.warn(
        '[wallet][session] paymaster relay failed, falling back to porto',
        paymasterError,
      );
    }
  } else {
    console.warn('[wallet][session] no paymaster payment URL configured');
  }

  if (!globalThis.__GEMINI_EPHEMERAL_PORT) {
    throw new Error('Ephemeral Porto provider unavailable for fallback relay');
  }

  console.info('[wallet][session] executing return via porto fallback', {
    chainId: session.chainId,
    account: session.ephemeralAccount.address,
  });

  try {
    const result = await globalThis.__GEMINI_EPHEMERAL_PORT.provider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          calls: [
            {
              to: usdcAddress,
              data: encodeFunctionData({
                abi: USDC_ABI,
                functionName: 'transferWithAuthorization',
                args: data.args,
              }),
            },
          ],
        },
      ],
    });
    console.log('[wallet][session] porto fallback relay result:', result);
  } catch (error) {
    console.error('[wallet][session] porto fallback relay failed', error);
    throw error;
  }
}

async function fundSessionBudget(
  session: PortoSessionState,
  requiredBudget: bigint,
): Promise<void> {
  if (requiredBudget <= 0n) return;

  const usdcAddress = session.usdcAddress;
  if (!usdcAddress) {
    console.warn('[wallet][session] fundSessionBudget skipped - no USDC address', {
      chainId: session.chainId,
    });
    return;
  }

  const currentBalance = await readUsdcBalance(
    session.chainSetting,
    usdcAddress,
    session.ephemeralAccount.address,
  );

  if (currentBalance >= requiredBudget) {
    session.fundedAmount = requiredBudget;
    session.fundsTransferred = true;
    return;
  }

  const delta = requiredBudget - currentBalance;
  if (delta <= 0n) {
    session.fundedAmount = requiredBudget;
    session.fundsTransferred = true;
    return;
  }

  console.info('[wallet][session] funding ephemeral account', {
    requested: requiredBudget.toString(),
    currentBalance: currentBalance.toString(),
    delta: delta.toString(),
  });

  const walletClient = createPortoWalletClient(session);
  const transferData = encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'transfer',
    args: [session.ephemeralAccount.address, delta],
  });

  const { id } = await walletClient.sendCalls({
    chain: resolveChain(session.chainSetting),
    account: session.identity.address,
    calls: [
      {
        to: usdcAddress,
        data: transferData,
      },
    ],
  });

  console.info('[wallet][session] USDC funding transaction sent', { id });
  await walletClient.waitForCallsStatus({ id });
  console.info('[wallet][session] USDC funding transaction confirmed', { id });

  session.fundedAmount = requiredBudget;
  session.fundsTransferred = true;
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
    session.fundsTransferred = false;
    session.fundedAmount = 0n;
    console.warn('[wallet][session] missing USDC config when applying budget', {
      chainId: session.chainId,
    });
    return;
  }
  await fundSessionBudget(session, amountBase);
}

export async function ensureSessionBudgetFundedUSDC(
  amount: number,
): Promise<void> {
  const required = toUsdcBase(amount);
  if (required <= 0n) return;
  const session = getSessionState();
  if (!session) return;
  session.budgetLimit = required;
  await fundSessionBudget(session, required);
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

function getPaymasterPaymentUrl(): string | undefined {
  const base = process.env['PAYMASTER_URL'];
  if (!base) return undefined;
  try {
    return new URL('/paymaster', base).toString();
  } catch (error) {
    console.warn(
      '[wallet][session] invalid PAYMASTER_URL, skipping paymaster relay',
      {
        base,
        error,
      },
    );
    return undefined;
  }
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

  const account = accounts[0].address;
  const usdcConfig = getUsdcConfig(chain.id);
  const usdcAddress = usdcConfig?.address;

  const ephemeralPorto = Porto.create({
    chains: [chain],
    mode: Mode.relay(),
  });

  const ephemeralPK = generatePrivateKey();
  const ephemeralAccount = Account.fromPrivateKey(ephemeralPK);
  const ephemeralClient = createWalletClient({
    chain,
    account: ephemeralAccount,
    transport: custom(ephemeralPorto.provider),
  }).extend(publicActions);

  console.log('Ephemeral address:', ephemeralAccount.address);

  globalThis.__GEMINI_PORTO = porto;
  globalThis.__GEMINI_EPHEMERAL_PORT = ephemeralPorto;
  globalThis.__GEMINI_PORTO_IDENTITY = identity;

  const sessionState: PortoSessionState = {
    chainSetting: effectiveChain,
    chainId: chain.id,
    identity,
    account,
    ephemeralPK,
    ephemeralAccount,
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
  if (!session || !session.fundsTransferred) return;
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

    const transferCall = await buildTransferWithAuthorizationCall(session, {
      from: session.ephemeralAccount.address,
      to: session.identity.address,
      value: currentBalance,
      signer: 'ephemeral',
    });

    await submitReturnTransfer(session, transferCall);

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
      transport: custom(globalThis.__GEMINI_EPHEMERAL_PORT?.provider!),
    }).extend(publicActions);
  }
  return globalThis.__GEMINI_PORTO_EPHEMERAL_CLIENT!;
}

export async function getEphemeralAccount() {
  const session = getSessionState();
  if (!session) {
    await connectPortoWallet('base-sepolia');
  }

  const resolvedSession = assertSessionState();
  return resolvedSession.ephemeralAccount;
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
