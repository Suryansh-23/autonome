import type { Address, Hex } from "viem";

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
  // polygon
  137: { address: process.env.CONTRACT_ADDRESS_POLYGON as Hex },
  // sepolia testnet (default for testing)
  84532: { address: process.env.CONTRACT_ADDRESS_BASE_SEPOLIA as Hex},
};
