/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseErc6492Signature,
  publicActions,
  type EncodeFunctionDataParameters,
  type Hex,
  type Address,
} from 'viem';

import type { PortoSessionState, WalletChainSetting } from './types.js';
import {
  TRANSFER_WITH_AUTH_TYPES,
  USDC_ABI,
  getUsdcConfig,
  resolveChain,
} from './constants.js';
import { getPrimaryPorto } from './state.js';

export function createPublicClientForChain(chainSetting: WalletChainSetting) {
  return createPublicClient({
    chain: resolveChain(chainSetting),
    transport: http(),
  });
}

export function createPortoWalletClient(session: PortoSessionState) {
  const porto = getPrimaryPorto();
  if (!porto) throw new Error('Porto provider not initialised');
  return createWalletClient({
    chain: resolveChain(session.chainSetting),
    account: session.account,
    transport: custom(porto.provider),
  }).extend(publicActions);
}

export function createNonce(): `0x${string}` {
  return `0x${randomBytes(32).toString('hex')}` as const;
}

export async function ensureUsdcVersion(
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

export async function buildTransferWithAuthorizationCall(
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

export async function readUsdcBalance(
  session: Pick<PortoSessionState, 'chainSetting'>,
  token: Address,
  holder: Address,
): Promise<bigint> {
  const client = createPublicClientForChain(session.chainSetting);
  return (await client.readContract({
    abi: USDC_ABI,
    address: token,
    functionName: 'balanceOf',
    args: [holder],
  })) as bigint;
}
