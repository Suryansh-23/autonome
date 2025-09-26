/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, type SlashCommand } from './types.js';
import {
  clearStoredWalletIdentity,
  readStoredWalletIdentity,
  connectPortoWallet,
  type WalletIdentityRecord,
} from '../../wallet/porto.js';
import open from 'open';

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
        const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
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
          const identity: WalletIdentityRecord | null = await connectPortoWallet(
            chain,
            (url: string) => {
              context.ui.addItem(
                {
                  type: 'info',
                  text: `Opening browser to complete wallet login…\n${url}`,
                },
                Date.now(),
              );
            },
          );
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
  ],
};
