/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { baseSepolia, polygon } from 'porto/Chains';
import type { Abi, Address } from 'viem';

import type { WalletChainSetting } from './types.js';

export const USDC_ABI = [
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

export const USDC_DECIMALS = 1_000_000n;

export const USDC_CONFIGS: Record<number, { address: Address; name: string }> =
  {
    137: {
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      name: 'USD Coin',
    },
    84532: {
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      name: 'USDC',
    },
  };

export const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export function resolveChain(chain: WalletChainSetting) {
  switch (chain) {
    case 'polygon':
      return polygon;
    case 'base-sepolia':
    default:
      return baseSepolia;
  }
}

export function getUsdcConfig(chainId: number) {
  return USDC_CONFIGS[chainId];
}

export function toUsdcBase(amount: number): bigint {
  if (Number.isNaN(amount) || amount <= 0) return 0n;
  return BigInt(Math.round(amount * Number(USDC_DECIMALS)));
}

export function getPaymasterPaymentUrl(): string | undefined {
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
