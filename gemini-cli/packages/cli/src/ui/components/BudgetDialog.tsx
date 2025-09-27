/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { Colors } from '../colors.js';
import type { BudgetPromptState } from '../../wallet/porto.js';
import {
  RadioButtonSelect,
  type RadioSelectItem,
} from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';

const DEFAULT_BUDGETS = [0.5, 1, 2, 5, 10];
const USDC_DECIMALS = 1_000_000n;

function formatBudget(value: number): string {
  const maximumFractionDigits = value >= 1 || value === 0 ? 2 : 4;
  const minimumFractionDigits = value >= 1 || value === 0 ? 0 : 2;
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits,
    maximumFractionDigits,
  })} USDC`;
}

function formatBalance(balance: bigint): string {
  const whole = balance / USDC_DECIMALS;
  const fraction = balance % USDC_DECIMALS;
  const fractionStr = fraction.toString().padStart(6, '0').replace(/0+$/, '');
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fractionStr ? `${wholeStr}.${fractionStr}` : wholeStr;
}

type BudgetOptionValue = number | 'custom';

interface BudgetDialogProps {
  prompt: BudgetPromptState;
  currentBudget?: number;
  onSelect: (budget: number) => void;
  onClose: () => void;
}

export const BudgetDialog = ({
  prompt,
  currentBudget,
  onSelect,
  onClose,
}: BudgetDialogProps) => {
  const isDefaultBudget = (value: number | undefined) =>
    value !== undefined &&
    DEFAULT_BUDGETS.some((preset) => Math.abs(preset - value) < 1e-6);

  const [customAmount, setCustomAmount] = useState<string>(() =>
    !isDefaultBudget(currentBudget) && currentBudget !== undefined
      ? String(currentBudget)
      : '',
  );
  const [error, setError] = useState<string | null>(null);

  const budgetOptions: Array<RadioSelectItem<BudgetOptionValue>> =
    useMemo(() => {
      const options: Array<RadioSelectItem<BudgetOptionValue>> =
        DEFAULT_BUDGETS.map((value) => ({
          label:
            value === 0 ? 'Disable paid fetch (0 USDC)' : formatBudget(value),
          value,
        }));
      options.push({
        label: customAmount
          ? `${customAmount} USDC (custom)`
          : 'Custom amount…',
        value: 'custom',
      });
      return options;
    }, [customAmount]);

  const initialIndex = useMemo(() => {
    if (currentBudget === undefined) return 0;
    const idx = DEFAULT_BUDGETS.findIndex(
      (value) => Math.abs(value - currentBudget) < 1e-6,
    );
    return idx >= 0 ? idx : budgetOptions.length - 1;
  }, [budgetOptions.length, currentBudget]);

  const [highlightedValue, setHighlightedValue] = useState<BudgetOptionValue>(
    budgetOptions[initialIndex]?.value ?? 0,
  );

  useEffect(() => {
    setHighlightedValue(budgetOptions[initialIndex]?.value ?? 0);
  }, [budgetOptions, initialIndex]);

  useEffect(() => {
    if (
      currentBudget !== undefined &&
      !DEFAULT_BUDGETS.some((preset) => Math.abs(preset - currentBudget) < 1e-6)
    ) {
      setCustomAmount(String(currentBudget));
    }
  }, [currentBudget]);

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onClose();
        return;
      }
      if (highlightedValue !== 'custom') return;

      const sequence = key.sequence ?? '';
      if (key.name === 'return') {
        if (!customAmount.trim()) {
          setError('Enter a custom amount before confirming.');
          return;
        }
        const parsed = Number.parseFloat(customAmount);
        if (!Number.isFinite(parsed) || parsed < 0) {
          setError('Enter a non-negative numeric amount.');
          return;
        }
        setError(null);
        onSelect(parsed);
        return;
      }

      if (key.name === 'backspace') {
        setCustomAmount((prev) => prev.slice(0, -1));
        setError(null);
        return;
      }

      if (/^[0-9]$/.test(sequence)) {
        setCustomAmount((prev) => (prev === '0' ? sequence : prev + sequence));
        setError(null);
        return;
      }

      if (sequence === '.') {
        setCustomAmount((prev) => {
          if (prev.includes('.')) return prev;
          return prev ? prev + '.' : '0.';
        });
        setError(null);
      }
    },
    { isActive: true },
  );

  const balanceDisplay = formatBalance(prompt.balance);
  const hasBalance = prompt.balance > 0n;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentGreen}
      paddingX={1}
      paddingY={1}
      width="80%"
    >
      <Text color={Colors.AccentGreen}>Set x402 session budget</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          Wallet balance:{' '}
          <Text color={Colors.AccentBlue}>{balanceDisplay}</Text>{' '}
          {prompt.tokenSymbol}
        </Text>
        <Text color={Colors.Gray}>
          This limit applies to all x402 searches for the current Gemini CLI session.
        </Text>
        {prompt.balanceError ? (
          <Text color={Colors.AccentYellow}>
            {`Balance lookup failed: ${prompt.balanceError}. Values may be stale.`}
          </Text>
        ) : !hasBalance ? (
          <Text color={Colors.AccentYellow}>
            No {prompt.tokenSymbol} detected. Choose a lower budget or top up.
          </Text>
        ) : null}
        {currentBudget !== undefined && (
          <Text>
            Current budget:{' '}
            <Text color={Colors.AccentGreen}>
              {formatBudget(currentBudget)}
            </Text>
          </Text>
        )}
      </Box>
      <Box marginTop={1}>
        <RadioButtonSelect
          items={budgetOptions}
          initialIndex={initialIndex}
          onSelect={(value) => {
            if (value === 'custom') {
              return;
            }
            onSelect(value);
          }}
          onHighlight={setHighlightedValue}
          showNumbers={false}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        {highlightedValue === 'custom' ? (
          <Box flexDirection="column">
            <Text>
              Custom amount:{' '}
              <Text color={Colors.AccentBlue}>{customAmount || '0'}</Text> USDC
            </Text>
            <Text color={Colors.Gray}>
              Type digits/decimal, Enter to confirm, Esc to cancel.
            </Text>
          </Box>
        ) : (
          <Text color={Colors.Gray}>
            ↑/↓ to navigate, Enter to confirm, Esc to keep the existing budget.
          </Text>
        )}
        {error && <Text color={Colors.AccentRed}>{error}</Text>}
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          Tip: this budget is the total spend available for all x402 searches
          during this session.
        </Text>
      </Box>
    </Box>
  );
};
