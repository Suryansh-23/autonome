import type { Address } from "viem";

// Minimal ABI fragment for Registrar.requestRegistration(string)
export const ABI = [
  {
    type: "function",
    name: "requestRegistration",
    stateMutability: "nonpayable",
    inputs: [{ name: "url", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "available",
    stateMutability: "view",
    inputs: [{ name: "fullDomain", type: "string" }],
    outputs: [{ name: "available", type: "bool" }],
  },
] as const;

export const CONTRACTS: Record<number, { address: Address }> = {
  // mainnet (replace with real address when ready)
  1: { address: "0x0000000000000000000000000000000000000000" },
  // polygon
  137: { address: "0x0000000000000000000000000000000000000000" },
  // sepolia testnet (default for testing)
  11155111: { address: "0x0000000000000000000000000000000000000000" },
};
