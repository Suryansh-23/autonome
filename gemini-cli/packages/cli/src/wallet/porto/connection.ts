/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import open from 'open';
import { Mode, Porto } from 'porto';
import { Dialog } from 'porto/cli';
import { Account, WalletActions } from 'porto/viem';
import { createWalletClient, custom, publicActions, type Address } from 'viem';
import { generatePrivateKey } from 'viem/accounts';

import type { Config } from '@google/gemini-cli-core';
import type { LoadedSettings } from '../../config/settings.js';
import { createPublicClientForChain } from './clients.js';
import { getUsdcConfig, resolveChain, USDC_ABI } from './constants.js';
import { ensureReturnCleanupRegistered } from './paymaster.js';
import {
  emitSessionBudgetUpdate,
  getEphemeralClient,
  getEphemeralPorto,
  getIdentity,
  getPrimaryPorto,
  getSessionState,
  queueBudgetPrompt,
  setEphemeralClient,
  setEphemeralPorto,
  setIdentity,
  setPrimaryPorto,
  setSessionState,
  writeStoredWalletIdentity,
} from './state.js';
import type {
  PortoSessionState,
  WalletChainSetting,
  WalletIdentityRecord,
} from './types.js';

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
    } catch {
      // ignore parse errors
    }
  }

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout.write as any) = origWrite;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr.write as any) = origErrWrite;
  };
}

export async function ensureWalletDialogOpen(): Promise<void> {
  try {
    await Dialog.cli();
  } catch {
    // ignore; renderer likely already initialised
  }
}

async function enqueueBudgetPrompt(
  identity: WalletIdentityRecord,
  chainId: number,
  usdcAddress: Address | undefined,
  chainSetting: WalletChainSetting,
  session: PortoSessionState,
) {
  if (!usdcAddress) {
    session.currentBalance = 0n;
    emitSessionBudgetUpdate(session);
    return;
  }
  try {
    const balance = await createPublicClientForChain(chainSetting).readContract(
      {
        abi: USDC_ABI,
        address: usdcAddress,
        functionName: 'balanceOf',
        args: [identity.address],
      },
    );
    session.currentBalance = balance as bigint;
    emitSessionBudgetUpdate(session);
    queueBudgetPrompt({
      address: identity.address,
      balance: balance as bigint,
      chainId,
      tokenSymbol: 'USDC',
      lastUpdated: Date.now(),
      balanceError: undefined,
    });
  } catch (error) {
    console.warn('Failed to fetch USDC balance for budget dialog:', error);
    queueBudgetPrompt({
      address: identity.address,
      balance: 0n,
      chainId,
      tokenSymbol: 'USDC',
      lastUpdated: Date.now(),
      balanceError:
        error instanceof Error ? error.message : 'Unable to retrieve balance',
    });
    session.currentBalance = 0n;
    emitSessionBudgetUpdate(session);
  }
}

export async function connectPortoWallet(
  effectiveChain: WalletChainSetting,
  onOpenUrl?: (url: string) => void,
): Promise<WalletIdentityRecord | null> {
  const chain = resolveChain(effectiveChain);
  const dialog = await Dialog.cli();
  const host = process.env['HOST_URL']
    ? new URL(`/dialog`, process.env['HOST_URL']).toString()
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

  const restore = interceptStdoutForUrls(async (url) => {
    try {
      await open(url);
      if (onOpenUrl) onOpenUrl(url);
    } catch (error) {
      console.error('Could not auto-open browser:', error);
    }
  });

  const { chainIds, accounts } = await WalletActions.connect(client, {
    email: true,
    chainIds: [chain.id],
  });

  restore();

  const primaryAddress = accounts[0].address as Address;

  const identity: WalletIdentityRecord = {
    address: primaryAddress,
    chainIds,
    provider: 'porto',
    ts: Date.now(),
  };

  const account = primaryAddress;
  const usdcAddress = resolveUsdcAddress(chain.id);

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

  setPrimaryPorto(porto);
  setEphemeralPorto(ephemeralPorto);
  setIdentity(identity);

  const sessionState = {
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
    currentBalance: 0n,
  };
  setSessionState(sessionState);

  await enqueueBudgetPrompt(
    identity,
    chain.id,
    usdcAddress,
    effectiveChain,
    sessionState,
  );

  Dialog.messenger.send('success', {
    title: 'Wallet connected',
    content: `Account: ${identity.address}\n\nReturn to the Gemini CLI to choose your x402 session budget.`,
  });

  ensureReturnCleanupRegistered(sessionState);
  setEphemeralClient(ephemeralClient);

  Dialog.messenger.send('success', {
    title: 'Ephemeral session created',
    content: `Ephemeral account: ${ephemeralAccount.address}`,
  });

  writeStoredWalletIdentity(identity);
  Dialog.messenger.send('close', undefined);
  return identity;
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
    'polygon') as WalletChainSetting;
  try {
    const identity = await connectPortoWallet(chainSetting, (url) => {
      console.log(`Opening browser to complete wallet login: ${url}`);
    });
    return identity;
  } catch (error) {
    console.error('Wallet connect failed:', error);
    return null;
  }
}

export async function getWalletClient(chain: WalletChainSetting) {
  const porto = getPrimaryPorto();
  if (!porto) throw new Error('Porto provider not initialised');
  const parsedChain = resolveChain(chain);
  return createWalletClient({
    account: getIdentity()?.address!,
    transport: custom(porto.provider),
    chain: parsedChain,
  }).extend(publicActions);
}

export async function getEphemeralWalletClient() {
  const session = getSessionState();
  if (!session) {
    await connectPortoWallet('polygon');
  }
  const resolvedSession = getSessionState();
  if (!resolvedSession) throw new Error('Porto session state unavailable');
  const existing = getEphemeralClient();
  if (!existing || existing.chain?.id !== resolvedSession.chainId) {
    const ephemeralPorto = getEphemeralPorto();
    if (!ephemeralPorto) throw new Error('Ephemeral Porto provider missing');
    setEphemeralClient(
      createWalletClient({
        chain: resolveChain(resolvedSession.chainSetting),
        account: resolvedSession.ephemeralAccount,
        transport: custom(ephemeralPorto.provider),
      }).extend(publicActions),
    );
  }
  return getEphemeralClient()!;
}

export async function getEphemeralAccount() {
  const session = getSessionState();
  if (!session) {
    await connectPortoWallet('polygon');
  }
  return getSessionState()!.ephemeralAccount;
}

function resolveUsdcAddress(chainId: number): Address | undefined {
  const config = getUsdcConfig(chainId);
  return config?.address;
}
