"use client";
import { ReactNode } from "react";
import { getDefaultConfig, RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider } from "wagmi";
import { mainnet, sepolia, polygon, baseSepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || process.env.NEXT_PUBLIC_RAINBOWKIT_APP_ID;

const config = getDefaultConfig({
  appName: "x0x0",
  projectId: projectId ?? "demo",
  chains: [polygon, baseSepolia],
  ssr: true,
});

const queryClient = new QueryClient();

export function RainbowProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={config}>
        <RainbowKitProvider modalSize="compact" theme={lightTheme({ accentColor: "#18181b", borderRadius: "large" })}>
          {children}
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
