"use client";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import Image from "next/image";

export function AppHeader() {
  return (
    <header className="w-full flex items-center justify-between px-4 sm:px-6 py-5 sticky top-0 z-20 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-zinc-900/40">
      <Link href="/" className="inline-flex items-center gap-3">
        <Image src="/autonome.png" alt="autonome" width={44} height={44} className="h-11 w-11" />
        <span className="font-black tracking-tight text-xl sm:text-2xl bg-clip-text text-transparent bg-gradient-to-r from-zinc-900 via-zinc-700 to-zinc-400 dark:from-zinc-100 dark:via-zinc-300 dark:to-zinc-500">Autonome</span>
      </Link>
      <ConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openChainModal,
          openConnectModal,
          authenticationStatus,
          mounted,
        }) => {
          const ready = mounted && authenticationStatus !== "loading";
          const connected = ready && account && chain;
          return (
            <div
              aria-hidden={!ready}
              className={!ready ? "opacity-0 pointer-events-none select-none" : undefined}
            >
              {!connected ? (
                <button
                  onClick={openConnectModal}
                  className="inline-flex items-center gap-2 rounded-full border-2 border-zinc-400/80 dark:border-zinc-600/80 px-4 py-2 text-sm font-semibold bg-white/70 dark:bg-zinc-900/60 shadow-sm hover:bg-white/80 dark:hover:bg-zinc-900/70 transition"
                >
                  Connect Wallet
                </button>
              ) : chain?.unsupported ? (
                <button
                  onClick={openChainModal}
                  className="inline-flex items-center gap-2 rounded-full border-2 border-red-400/80 px-4 py-2 text-sm font-semibold bg-white/70 dark:bg-zinc-900/60 text-red-600 dark:text-red-400 shadow-sm hover:bg-white/80 dark:hover:bg-zinc-900/70 transition"
                >
                  Wrong network
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={openChainModal}
                    className="inline-flex items-center gap-2 rounded-full border-2 border-zinc-400/80 dark:border-zinc-600/80 px-3 py-2 text-sm font-semibold bg-white/70 dark:bg-zinc-900/60 shadow-sm hover:bg-white/80 dark:hover:bg-zinc-900/70 transition"
                    type="button"
                  >
                    {chain?.iconUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={chain.name ?? "Chain icon"} src={chain.iconUrl} className="h-4 w-4 rounded-full" />
                    )}
                    <span>{chain?.name ?? "Network"}</span>
                  </button>
                  <button
                    onClick={openAccountModal}
                    className="inline-flex items-center gap-2 rounded-full border-2 border-zinc-400/80 dark:border-zinc-600/80 px-3 py-2 text-sm font-semibold bg-white/70 dark:bg-zinc-900/60 shadow-sm hover:bg-white/80 dark:hover:bg-zinc-900/70 transition"
                    type="button"
                  >
                    <span>{account?.displayName}</span>
                  </button>
                </div>
              )}
            </div>
          );
        }}
      </ConnectButton.Custom>
    </header>
  );
}
