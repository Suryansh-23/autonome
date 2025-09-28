/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Hex } from 'viem';
import {
  decodeXPaymentResponse,
  wrapFetchWithPayment,
  type Signer,
} from 'x402-fetch';
import type { X402PaymentHandler } from '@google/gemini-cli-core';
import {
  ensureSessionBudgetFundedUSDC,
  ensureWalletDialogOpen,
  getEphemeralAccount,
  readStoredWalletIdentity,
} from '../wallet/porto.js';
import type { Settings } from '../config/settings.js';

/**
 * Creates an x402 payment handler that integrates with the Porto wallet system
 * @param settings - The CLI settings containing wallet and payment configuration
 * @returns A payment handler function that can be used with the WebFetch tool
 */
export function createX402PaymentHandler(
  settings: Settings,
): X402PaymentHandler {
  return async (url: string, signal?: AbortSignal): Promise<Response> => {
    console.info('[x402] web-fetch: Attempting x402 payment for:', url);

    // Check if wallet payments are enabled
    const walletProvider = settings.wallet?.provider as
      | 'none'
      | 'porto'
      | undefined;
    const payCfg = settings.wallet?.payments as
      | {
          enabled?: boolean;
          chain?: 'base-sepolia' | 'polygon';
          maxUsdBudget?: number;
        }
      | undefined;

    if (walletProvider !== 'porto') {
      console.warn('[x402] web-fetch: Wallet provider not set to porto');
      throw new Error(
        'x402 payments require Porto wallet provider to be enabled. Set settings.wallet.provider to "porto"',
      );
    }

    if (!payCfg?.enabled) {
      console.warn(
        '[x402] web-fetch: Payments not enabled in wallet configuration',
      );
      throw new Error(
        'x402 payments require wallet payments to be enabled. Set settings.wallet.payments.enabled to true',
      );
    }

    // Check if wallet is connected
    const identity = readStoredWalletIdentity();
    if (!identity?.address) {
      console.warn('[x402] web-fetch: No wallet identity found');
      throw new Error(
        'x402 payments require wallet to be connected. Run /wallet connect first.',
      );
    }

    const chain = (payCfg.chain || settings.wallet?.chain || 'base-sepolia') as
      | 'base-sepolia'
      | 'polygon';

    try {
      // Get the ephemeral account for signing payments
      const account = await getEphemeralAccount();

      // Try to log chainId as an extra sanity check
      const cid = await (
        account as unknown as { getChainId?: () => Promise<number> }
      ).getChainId?.();
      if (cid !== undefined) {
        console.info('[x402] web-fetch: signer.getChainId():', cid);
      }

      // Determine budget to fund
      const configuredBudget = payCfg.maxUsdBudget;
      const defaultBudget = 10;
      const budgetToFund =
        typeof configuredBudget === 'number'
          ? Math.max(0, configuredBudget)
          : defaultBudget;

      let budgetEnsured = false;
      const ensureBudgetOnce = async () => {
        if (!budgetEnsured && budgetToFund > 0) {
          console.info(
            '[x402] web-fetch: ensuring session budget:',
            budgetToFund,
            'USDC',
          );
          await ensureSessionBudgetFundedUSDC(budgetToFund);
          budgetEnsured = true;
        }
      };

      // Ensure wallet dialog is open for potential user interactions
      await ensureWalletDialogOpen();

      console.info(
        '[x402] web-fetch: initiating payment for:',
        url,
        'on',
        chain,
      );

      // Create a proxy signer to log payment operations
      const proxySigner: Signer = {
        ...(account as unknown as Signer),
        signTypedData: async (parameters: any): Promise<Hex> => {
          console.info(
            '[x402] web-fetch: signTypedData called:',
            JSON.stringify(parameters, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
          );
          const result = await account.signTypedData(parameters);
          console.info('[x402] web-fetch: signTypedData result:', result);
          return result;
        },
      };

      // Create the payment-wrapped fetch function
      const fetchWithPayment = wrapFetchWithPayment(
        globalThis.fetch,
        proxySigner,
      );

      // Create a funded fetch that ensures budget before payment
      const fundedFetch = (async (input: RequestInfo, init?: RequestInit) => {
        await ensureBudgetOnce();
        return fetchWithPayment(input, init);
      }) as unknown as typeof fetch;

      console.info('[x402] web-fetch: wrapper created; sending request…');

      // Execute the payment-wrapped request
      const response: Response = await fundedFetch(url, {
        method: 'GET',
        signal,
      });

      console.info('[x402] web-fetch: response status:', response.status);

      // Log payment response if present
      const paymentHeader = response.headers.get('x-payment-response');
      if (paymentHeader) {
        try {
          const decoded = decodeXPaymentResponse(paymentHeader);
          console.info(
            '[x402] web-fetch: decoded payment response:',
            JSON.stringify(decoded),
          );
        } catch (error) {
          console.warn(
            '[x402] web-fetch: failed to decode payment response:',
            error,
          );
        }
      } else {
        console.info('[x402] web-fetch: no x-payment-response header present');
      }

      return response;
    } catch (error) {
      const errorMessage = `x402 payment failed for ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      console.error('[x402] web-fetch:', errorMessage, error);
      throw new Error(errorMessage);
    }
  };
}
