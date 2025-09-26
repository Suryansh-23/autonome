/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type { WalletChainSetting, WalletIdentityRecord, BudgetPromptState } from './types.js';
export type { SessionBudgetSnapshot } from './types.js';
export {
  getPendingBudgetPrompt,
  clearPendingBudgetPrompt,
  readStoredWalletIdentity,
  clearStoredWalletIdentity,
  getSessionBudgetSnapshot,
} from './state.js';
export {
  setSessionBudgetLimitUSDC,
  applySessionBudgetSelection,
  ensureSessionBudgetFundedUSDC,
  registerSessionSpend,
} from './funding.js';
export {
  connectPortoWallet,
  maybeAutoConnectWallet,
  getWalletClient,
  getEphemeralWalletClient,
  getEphemeralAccount,
  ensureWalletDialogOpen,
} from './connection.js';
