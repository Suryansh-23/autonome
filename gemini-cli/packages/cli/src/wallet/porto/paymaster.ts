/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { toHex, encodeFunctionData } from 'viem';

import { registerCleanup } from '../../utils/cleanup.js';
import {
  buildTransferWithAuthorizationCall,
  readUsdcBalance,
} from './clients.js';
import {
  getPaymasterPaymentUrl,
  getUsdcConfig,
  USDC_ABI,
} from './constants.js';
import {
  emitSessionBudgetUpdate,
  getEphemeralPorto,
  getSessionState,
} from './state.js';
import type { PortoSessionState } from './types.js';

export async function submitReturnTransfer(
  session: PortoSessionState,
  call: Awaited<ReturnType<typeof buildTransferWithAuthorizationCall>>,
): Promise<void> {
  const usdcAddress = session.usdcAddress;
  if (!usdcAddress) {
    console.warn(
      '[wallet][session] submitReturnTransfer skipped - no USDC address',
    );
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
            args: call.args,
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

      console.info('[wallet][session] paymaster relay completed', {
        to: call.args[1],
        hash: result?.hash,
        chainId: session.chainId,
      });
      const amount = call.args[2] as bigint;
      session.currentBalance =
        session.currentBalance > amount ? session.currentBalance - amount : 0n;
      emitSessionBudgetUpdate(session);
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

  const ephemeralPorto = getEphemeralPorto();
  if (!ephemeralPorto) {
    throw new Error('Ephemeral Porto provider unavailable for fallback relay');
  }

  console.info('[wallet][session] executing return via porto fallback', {
    chainId: session.chainId,
    account: session.ephemeralAccount.address,
  });

  try {
    const result = await ephemeralPorto.provider.request({
      method: 'wallet_sendCalls',
      params: [
        {
          calls: [
            {
              to: usdcAddress,
              data: encodeFunctionData({
                abi: USDC_ABI,
                functionName: 'transferWithAuthorization',
                args: call.args,
              }),
            },
          ],
        },
      ],
    });
    console.info('[wallet][session] porto fallback relay result', result);
    const amount = call.args[2] as bigint;
    session.currentBalance =
      session.currentBalance > amount ? session.currentBalance - amount : 0n;
    emitSessionBudgetUpdate(session);
  } catch (error) {
    console.error('[wallet][session] porto fallback relay failed', error);
    throw error;
  }
}

export async function returnSessionFunds(): Promise<void> {
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
      session,
      usdcConfig.address,
      session.ephemeralAccount.address,
    );
    session.currentBalance = currentBalance;
    emitSessionBudgetUpdate(session);
    if (currentBalance === 0n) {
      session.fundsTransferred = false;
      session.fundedAmount = 0n;
      emitSessionBudgetUpdate(session);
      console.info('[wallet][session] no remaining USDC to return');
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
    session.currentBalance = 0n;
    emitSessionBudgetUpdate(session);
    console.info('[wallet][session] session budget returned to primary account', {
      amount: currentBalance.toString(),
      recipient: session.identity.address,
    });
  } catch (error) {
    console.warn('Failed to return session USDC to primary wallet:', error);
  }
}

export function ensureReturnCleanupRegistered(
  session: PortoSessionState,
): void {
  if (session.cleanupRegistered) return;
  registerCleanup(returnSessionFunds);
  session.cleanupRegistered = true;
}
