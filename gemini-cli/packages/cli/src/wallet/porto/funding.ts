/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { encodeFunctionData } from 'viem';

import { createPortoWalletClient, readUsdcBalance } from './clients.js';
import { resolveChain, toUsdcBase, USDC_ABI } from './constants.js';
import { emitSessionBudgetUpdate, getSessionState } from './state.js';
import type { PortoSessionState } from './types.js';
async function fundSessionBudget(
  session: PortoSessionState,
  requiredBudget: bigint,
): Promise<void> {
  if (requiredBudget <= 0n) return;

  const usdcAddress = session.usdcAddress;
  if (!usdcAddress) {
    console.warn(
      '[wallet][session] fundSessionBudget skipped - no USDC address',
      {
        chainId: session.chainId,
      },
    );
    return;
  }

  if (session.fundsTransferred && requiredBudget <= session.fundedAmount) {
    // Already provisioned this budget earlier in the session.
    session.budgetLimit = requiredBudget;
    emitSessionBudgetUpdate(session);
    return;
  }

  const currentBalance = await readUsdcBalance(
    session,
    usdcAddress,
    session.ephemeralAccount.address,
  );

  session.currentBalance = currentBalance;

  if (!session.fundsTransferred && currentBalance >= requiredBudget) {
    session.fundedAmount = requiredBudget;
    session.fundsTransferred = true;
    emitSessionBudgetUpdate(session);
    return;
  }

  let delta: bigint;
  if (!session.fundsTransferred) {
    delta = requiredBudget - currentBalance;
  } else {
    delta = requiredBudget - session.fundedAmount;
  }

  if (currentBalance >= requiredBudget) {
    session.fundedAmount = requiredBudget;
    session.fundsTransferred = true;
    session.currentBalance = currentBalance;
    emitSessionBudgetUpdate(session);
    return;
  }

  if (delta <= 0n) {
    session.fundedAmount = requiredBudget;
    session.fundsTransferred = true;
    session.currentBalance = currentBalance;
    emitSessionBudgetUpdate(session);
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

  // const { id } = await globalThis.__GEMINI_PORTO?.provider.request({
  //   method: 'wallet_sendCalls',
  //   params: [
  //     {
  //       calls: [
  //         {
  //           to: usdcAddress,
  //           data: transferData,
  //         },
  //       ],
  //     },
  //   ],
  // })!;

  // const { id } = await RelayActions.sendCalls(
  //   {
  //     account: session.identity.address,
  //     chain: resolveChain(session.chainSetting),
  //   },
  // );

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
  const { status, receipts } = await walletClient.waitForCallsStatus({ id });
  if (status !== 'success') {
    console.error('[wallet][session] USDC funding transaction failed', {
      id,
      status,
    });
    throw new Error('USDC funding transaction failed');
  }

  const updatedBalance = await readUsdcBalance(
    session,
    usdcAddress,
    session.ephemeralAccount.address,
  );

  if (updatedBalance < requiredBudget) {
    console.error(
      '[wallet][session] USDC funding transaction balance shortfall',
      {
        id,
        expected: requiredBudget.toString(),
        actual: updatedBalance.toString(),
        txHash: receipts?.[0]?.transactionHash,
      },
    );
    throw new Error(
      'USDC funding transaction did not settle the expected balance',
    );
  }

  console.info('[wallet][session] USDC funding transaction confirmed', {
    id,
    status,
    txHash: receipts?.[0]?.transactionHash,
    balance: updatedBalance.toString(),
  });

  session.fundedAmount = requiredBudget;
  session.fundsTransferred = true;
  session.currentBalance = updatedBalance;
  emitSessionBudgetUpdate(session);
}

export function setSessionBudgetLimitUSDC(amount: number): void {
  const session = getSessionState();
  if (!session) return;
  session.budgetLimit = toUsdcBase(amount);
}

export async function applySessionBudgetSelection(
  budget: number,
): Promise<void> {
  const session = getSessionState();
  if (!session) return;

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
    session.currentBalance = 0n;
    emitSessionBudgetUpdate(session);
    return;
  }

  if (!session.usdcAddress) {
    session.fundsTransferred = false;
    session.fundedAmount = 0n;
    session.currentBalance = 0n;
    console.warn('[wallet][session] missing USDC config when applying budget', {
      chainId: session.chainId,
    });
    emitSessionBudgetUpdate(session);
    return;
  }

  await fundSessionBudget(session, amountBase);
}

export async function ensureSessionBudgetFundedUSDC(
  amount: number,
): Promise<void> {
  const session = getSessionState();
  if (!session) return;
  const required = toUsdcBase(amount);
  if (required <= 0n) return;
  session.budgetLimit = required;
  await fundSessionBudget(session, required);
}

export function registerSessionSpend(amount: bigint): void {
  if (amount <= 0n) return;
  const session = getSessionState();
  if (!session) return;
  session.currentBalance =
    session.currentBalance > amount ? session.currentBalance - amount : 0n;
  emitSessionBudgetUpdate(session);
}
