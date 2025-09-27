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
import { WalletActions } from 'porto/viem';
import {
  createWalletClient,
  custom,
  http,
  publicActions,
  type Address,
  type WalletActions as ViemWalletActions,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { LoadedSettings } from '../config/settings.js';

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
  const porto = Porto.create({
    chains: [chain],
    mode: Mode.dialog({ renderer: dialog }),
  });

  const client = createWalletClient({
    chain,
    transport: custom(porto.provider),
  });

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

  // Send success + close dialog messages
  Dialog.messenger.send('success', {
    title: 'Wallet connected',
    content: `Account: ${identity.address}`,
  });

  const ephemeralPK = generatePrivateKey();
  const ephemeralAccount = privateKeyToAccount(ephemeralPK);
  console.log('Ephemeral address:', ephemeralAccount.address);

  WalletActions.grantPermissions(client, {
    expiry: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    feeToken: null,
    key: {
      publicKey: ephemeralAccount.address,
      type: 'address',
    },
    permissions: {
      calls: [],
    },
  });

  const ephemeralClient = createWalletClient({
    chain: baseSepolia,
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
  if (!globalThis.__GEMINI_PORTO_EPHEMERAL_CLIENT) {
    await connectPortoWallet('base-sepolia');
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
