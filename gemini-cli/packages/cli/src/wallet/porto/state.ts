/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Storage } from '@google/gemini-cli-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Porto } from 'porto';
import type { WalletActions as ViemWalletActions } from 'viem';
import { createWalletClient } from 'viem';

import { AppEvent, appEvents } from '../../utils/events.js';
import type {
  BudgetPromptState,
  PortoSessionState,
  WalletIdentityRecord,
  SessionBudgetSnapshot,
} from './types.js';

// Declare a typed cache on globalThis for the Porto wallet client
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
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

export function getPrimaryPorto(): Porto.Porto | undefined {
  return globalThis.__GEMINI_PORTO;
}

export function setPrimaryPorto(porto: Porto.Porto | undefined): void {
  globalThis.__GEMINI_PORTO = porto;
}

export function getEphemeralPorto(): Porto.Porto | undefined {
  return globalThis.__GEMINI_EPHEMERAL_PORT;
}

export function setEphemeralPorto(porto: Porto.Porto | undefined): void {
  globalThis.__GEMINI_EPHEMERAL_PORT = porto;
}

export function getEphemeralClient() {
  return globalThis.__GEMINI_PORTO_EPHEMERAL_CLIENT;
}

export function setEphemeralClient(
  client:
    | (ReturnType<typeof createWalletClient> & ViemWalletActions)
    | undefined,
): void {
  globalThis.__GEMINI_PORTO_EPHEMERAL_CLIENT = client;
}

export function getIdentity(): WalletIdentityRecord | undefined {
  return globalThis.__GEMINI_PORTO_IDENTITY;
}

export function setIdentity(identity: WalletIdentityRecord | undefined): void {
  globalThis.__GEMINI_PORTO_IDENTITY = identity;
}

export function getSessionState(): PortoSessionState | undefined {
  return globalThis.__GEMINI_PORTO_SESSION;
}

export function setSessionState(state: PortoSessionState | undefined): void {
  globalThis.__GEMINI_PORTO_SESSION = state;
  emitSessionBudgetUpdate(state);
}

export function assertSessionState(): PortoSessionState {
  const session = getSessionState();
  if (!session) {
    throw new Error('Porto session state unavailable');
  }
  return session;
}

export function getPendingBudgetPrompt(): BudgetPromptState | undefined {
  return globalThis.__GEMINI_PORTO_BUDGET_PROMPT;
}

export function clearPendingBudgetPrompt(): void {
  globalThis.__GEMINI_PORTO_BUDGET_PROMPT = undefined;
}

export function queueBudgetPrompt(state: BudgetPromptState): void {
  globalThis.__GEMINI_PORTO_BUDGET_PROMPT = state;
  appEvents.emit(AppEvent.ShowBudgetDialog, state);
}

export function getWalletIdentityPath(): string {
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

export function writeStoredWalletIdentity(identity: WalletIdentityRecord): void {
  fs.writeFileSync(getWalletIdentityPath(), JSON.stringify(identity, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function clearStoredWalletIdentity(): void {
  try {
    const p = getWalletIdentityPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    setIdentity(undefined);
    clearPendingBudgetPrompt();
    setSessionState(undefined);
  } catch {
    // ignore
  }
}

export function emitSessionBudgetUpdate(
  session: PortoSessionState | undefined,
): void {
  const payload: SessionBudgetSnapshot | null = session
    ? {
        balance: session.currentBalance,
        limit: session.budgetLimit,
        chainId: session.chainId,
      }
    : null;
  appEvents.emit(AppEvent.SessionBudgetUpdated, payload);
}

export function getSessionBudgetSnapshot(): SessionBudgetSnapshot | null {
  const session = getSessionState();
  if (!session) return null;
  return {
    balance: session.currentBalance,
    limit: session.budgetLimit,
    chainId: session.chainId,
  };
}
