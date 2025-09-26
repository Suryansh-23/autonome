/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Account } from 'porto/viem';
import type { Address, Hex } from 'viem';

export type WalletChainSetting = 'base-sepolia' | 'base';

export interface WalletIdentityRecord {
  address: Address;
  chainIds: readonly number[];
  provider: 'porto';
  ts: number;
}

export interface BudgetPromptState {
  address: Address;
  balance: bigint;
  chainId: number;
  tokenSymbol: 'USDC';
  lastUpdated: number;
  balanceError?: string;
}

export type PortoAccount = ReturnType<typeof Account.fromPrivateKey>;

export interface PortoSessionState {
  chainSetting: WalletChainSetting;
  chainId: number;
  identity: WalletIdentityRecord;
  account: Address;
  ephemeralPK: Hex;
  ephemeralAccount: PortoAccount;
  usdcAddress?: Address;
  usdcVersion?: string;
  budgetLimit: bigint;
  fundedAmount: bigint;
  fundsTransferred: boolean;
  cleanupRegistered: boolean;
  currentBalance: bigint;
}

export interface SessionBudgetSnapshot {
  balance: bigint;
  limit: bigint;
  chainId: number | undefined;
}
