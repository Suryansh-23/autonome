/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import open from 'open';
import type { Hex } from 'viem';
import {
  decodeXPaymentResponse,
  wrapFetchWithPayment,
  type Signer,
} from 'x402-fetch';
import {
  clearStoredWalletIdentity,
  connectPortoWallet,
  ensureSessionBudgetFundedUSDC,
  ensureWalletDialogOpen,
  getEphemeralWalletClient,
  readStoredWalletIdentity,
  type WalletIdentityRecord,
} from '../../wallet/porto.js';
import { CommandKind, type SlashCommand } from './types.js';
export const walletCommand: SlashCommand = {
  name: 'wallet',
  description: 'Manage wallet identity (Porto).',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    {
      name: 'connect',
      description: 'Connect wallet using Porto CLI flow (opens browser).',
      kind: CommandKind.BUILT_IN,
      async action(context) {
        const provider = context.services.settings.merged.wallet?.provider as
          | string
          | undefined;
        if (provider !== 'porto') {
          return {
            type: 'message',
            messageType: 'error',
            content:
              "Wallet provider is not set to 'porto'. Set settings.wallet.provider to 'porto' and try again.",
          } as const;
        }

        // If already connected, short-circuit.
        const existing = readStoredWalletIdentity();
        if (existing?.address) {
          return {
            type: 'message',
            messageType: 'info',
            content: `Wallet already connected: ${existing.address}`,
          } as const;
        }

        // Spinner while waiting
        const spinnerFrames = [
          '⠋',
          '⠙',
          '⠹',
          '⠸',
          '⠼',
          '⠴',
          '⠦',
          '⠧',
          '⠇',
          '⠏',
        ];
        let frame = 0;
        const spinnerInterval = setInterval(() => {
          const icon = spinnerFrames[frame++ % spinnerFrames.length];
          context.ui.setPendingItem({
            type: 'info',
            text: `${icon} Waiting for wallet authentication…`,
          });
        }, 100);

        try {
          const chain = (context.services.settings.merged.wallet?.chain ||
            'base-sepolia') as 'base-sepolia' | 'base';
          const identity: WalletIdentityRecord | null =
            await connectPortoWallet(chain, (url: string) => {
              context.ui.addItem(
                {
                  type: 'info',
                  text: `Opening browser to complete wallet login…\n${url}`,
                },
                Date.now(),
              );
            });
          if (identity?.address) {
            return {
              type: 'message',
              messageType: 'info',
              content: `Wallet connected: ${identity.address}`,
            } as const;
          }
          return {
            type: 'message',
            messageType: 'error',
            content: 'Wallet connection did not return an address.',
          } as const;
        } catch (e) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Wallet connect failed: ${e instanceof Error ? e.message : String(e)}`,
          } as const;
        } finally {
          clearInterval(spinnerInterval);
          context.ui.setPendingItem(null);
        }
      },
    },
    {
      name: 'disconnect',
      description: 'Disconnect wallet (clear stored identity).',
      kind: CommandKind.BUILT_IN,
      async action() {
        clearStoredWalletIdentity();
        return {
          type: 'message',
          messageType: 'info',
          content: 'Wallet disconnected.',
        } as const;
      },
    },
    {
      name: 'status',
      description: 'Show current wallet status.',
      kind: CommandKind.BUILT_IN,
      async action() {
        const identity = readStoredWalletIdentity();
        if (!identity) {
          return {
            type: 'message',
            messageType: 'info',
            content: 'Wallet: disconnected',
          } as const;
        }
        const chains = identity.chainIds.join(', ');
        return {
          type: 'message',
          messageType: 'info',
          content: `Wallet: ${identity.address} (chains: ${chains})`,
        } as const;
      },
    },
    {
      name: 'dashboard',
      description:
        'Open the Porto wallet dashboard (https://id.porto.sh/) in your default browser.',
      kind: CommandKind.BUILT_IN,
      async action() {
        const url = 'https://id.porto.sh/';
        try {
          await open(url);
          return {
            type: 'message',
            messageType: 'info',
            content: `Opened Porto wallet dashboard: ${url}`,
          } as const;
        } catch (e) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to open Porto dashboard. You can open it manually: ${url}`,
          } as const;
        }
      },
    },
    {
      name: 'pay-test',
      description:
        'Test a paid request with x402. Usage: /wallet pay-test <https-url>',
      kind: CommandKind.BUILT_IN,
      async action(context, args) {
        const url = (args || '').trim();
        if (!url || !/^https?:\/\//i.test(url)) {
          return {
            type: 'message',
            messageType: 'error',
            content:
              'Usage: /wallet pay-test <https-url>\nPlease provide a fully-qualified https URL.',
          } as const;
        }

        const payCfg = context.services.settings.merged.wallet?.payments as
          | {
              enabled?: boolean;
              chain?: 'base-sepolia' | 'base';
              maxUsdBudget?: number;
            }
          | undefined;
        const chain = (payCfg?.chain ||
          context.services.settings.merged.wallet?.chain ||
          'base-sepolia') as 'base-sepolia' | 'base';
        const client = await getEphemeralWalletClient();
        // Try to log chainId as an extra sanity check

        const cid = await (
          client as unknown as { getChainId?: () => Promise<number> }
        ).getChainId?.();
        if (cid !== undefined) console.info('[x402] signer.getChainId():', cid);

        const configuredBudget = payCfg?.maxUsdBudget;
        const defaultBudget = 10;
        const budgetToFund =
          typeof configuredBudget === 'number'
            ? Math.max(0, configuredBudget)
            : defaultBudget;
        let budgetEnsured = false;
        const ensureBudgetOnce = async () => {
          if (!budgetEnsured && budgetToFund > 0) {
            console.info(
              '[x402] ensuring session budget for pay-test:',
              budgetToFund,
              'USDC',
            );
            await ensureSessionBudgetFundedUSDC(budgetToFund);
            budgetEnsured = true;
          }
        };

        await ensureWalletDialogOpen();
        console.info('[x402] pay-test initiating (wrapped):', url, 'on', chain);

        const proxySigner: Signer = {
          ...(client as unknown as Signer),
          // @ts-ignore
          signTypedData: async (parameters: any): Promise<Hex> => {
            console.info('[x402] signTypedData called');
            const tmp = await client.signTypedData(parameters);
            // console.info('[x402] signTypedData result:', tmp);
            return tmp;
          },
        };

        const fetchWithPayment = wrapFetchWithPayment(
          globalThis.fetch,
          proxySigner,
        );
        const fundedFetch = (async (input: RequestInfo, init?: RequestInit) => {
          await ensureBudgetOnce();
          return fetchWithPayment(input, init);
        }) as unknown as typeof fetch;
        console.info('[x402] wrapper created; sending request…');
        const res: Response = await fundedFetch(url, { method: 'GET' });
        console.info('[x402] wrapped response status:', res.status);

        const header = res.headers.get('x-payment-response');
        if (header) {
          const decoded = decodeXPaymentResponse(header);
          console.info(
            '[x402] decoded payment response:',
            JSON.stringify(decoded),
          );
        } else {
          console.info('[x402] no x-payment-response header present');
        }
        // Body: prefer JSON, fallback to text
        let bodyText = '';
        try {
          bodyText = await res.text();
        } catch {
          bodyText = '(no body)';
        }

        const preview =
          bodyText.length > 800 ? bodyText.slice(0, 800) + '…' : bodyText;
        let paymentInfo = '';
        if (header) {
          try {
            const decoded = decodeXPaymentResponse(header);
            paymentInfo =
              '\n\nPayment Response (decoded):\n' +
              '```json\n' +
              JSON.stringify(decoded, null, 2) +
              '\n```';
          } catch {}
        }
        return {
          type: 'message',
          messageType: 'info',
          content: `Paid request completed. Status: ${res.status}\nPreview:\n${preview}${paymentInfo}`,
        } as const;
      },
    },
  ],
};
