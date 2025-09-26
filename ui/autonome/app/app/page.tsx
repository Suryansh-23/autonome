"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { type WalletClient } from "viem";
import { readContract, writeContract } from "viem/actions";
import { ABI, CONTRACTS } from "@/lib/contract";
import { BackgroundLines } from "@/components/ui/background-lines";
import { Card, CardHeader, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "motion/react";

export default function AppPage() {
  // store only the URL body (without scheme). We'll render a framed https:// prefix.
  const [urlBody, setUrlBody] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<"unknown" | "checking" | "available" | "taken">("unknown");

  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const contractAddress = useMemo(() => {
    const a = CONTRACTS[chainId]?.address;
    if (!a) return undefined;
    // treat zero address as not configured
    if (/^0x0{40}$/i.test(a)) return undefined;
    return a;
  }, [chainId]);
  const fullUrl = useMemo(() => (urlBody ? `https://${urlBody}` : "https://"), [urlBody]);
  const explorerBase = useMemo(() => {
    switch (chainId) {
      case 1:
        return "https://etherscan.io/tx/";
      case 11155111:
        return "https://sepolia.etherscan.io/tx/";
      case 137:
        return "https://polygonscan.com/tx/";
      default:
        return null;
    }
  }, [chainId]);

  const normalizeUrlBody = (s: string) => {
    let v = s.trim();
    // strip any leading scheme(s)
    while (/^https?:\/\//i.test(v)) v = v.replace(/^https?:\/\//i, "");
    // remove spaces inside
    v = v.replace(/\s+/g, "");
    return v;
  };

  const handleRegister = async () => {
    setError(null);
    setTxHash(null);
    try {
      if (!isConnected || !walletClient) {
        setError("Connect a wallet first.");
        return;
      }
      if (!urlBody || !isValidHttpUrl(fullUrl)) {
        setError("Enter a valid https:// URL.");
        return;
      }
      if (!contractAddress) {
        setError("No contract address configured for this chain.");
        return;
      }
      if (!publicClient) {
        setError("No RPC client available.");
        return;
      }

      // quick availability check
      setAvailability("checking");
      const isAvailable = await readContract(publicClient, {
        address: contractAddress,
        abi: ABI,
        functionName: "available",
        args: [urlBody],
      });
      setAvailability(isAvailable ? "available" : "taken");

      if (!isAvailable) {
        setError("That domain appears to be already registered.");
        return;
      }

      setTxStatus("Preparing transaction...");
      const hash = await writeContract(walletClient as WalletClient, {
        address: contractAddress,
        abi: ABI,
        functionName: "requestRegistration",
        // Registrar.requestRegistration expects a domain like "bob.github.io" (no scheme)
        args: [urlBody],
        account: address!,
        chain: walletClient.chain,
      });
      setTxHash(hash);
      setTxStatus("Transaction sent.");
    } catch (e: any) {
      console.error(e);
      setError(e?.shortMessage || e?.message || "Failed to send transaction");
      setTxStatus(null);
    }
  };

  // Reset availability indicator when the input changes
  useEffect(() => {
    setAvailability("unknown");
  }, [urlBody]);

  return (
  <div className="relative h-[calc(100vh-84px)] flex items-center justify-center px-4 sm:px-6 overflow-hidden">
      <BackgroundLines className="absolute inset-0 -z-10" svgOptions={{ duration: 9 }}>
        <div className="sr-only">bg</div>
      </BackgroundLines>
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2, ease: "easeOut" }} className="w-full max-w-md">
        <Card className="rounded-2xl shadow-lg bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700">
          <CardHeader className="p-5 border-b border-zinc-300 dark:border-zinc-700">
            <CardDescription className="text-center text-2xl sm:text-3xl font-semibold tracking-tight leading-tight text-foreground">
              Register your website URL
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div>
              <label htmlFor="url" className="sr-only">Website URL</label>
              <div className="flex items-center gap-3 rounded-md border-2 border-zinc-400 dark:border-zinc-600 bg-white/90 dark:bg-zinc-800/80 px-4 sm:px-5 py-3 transition focus-within:ring-2 focus-within:ring-zinc-400 dark:focus-within:ring-zinc-500 focus-within:border-zinc-500 dark:focus-within:border-zinc-500">
                <span className="inline-flex items-center rounded-sm border border-zinc-500/80 dark:border-zinc-500/70 bg-zinc-100/80 dark:bg-zinc-900/70 px-3 py-1.5 text-base font-medium text-zinc-800 dark:text-zinc-200 select-none">
                  https://
                </span>
                <input
                  id="url"
                  type="text"
                  value={urlBody}
                  onChange={e => setUrlBody(normalizeUrlBody(e.target.value))}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (text) {
                      e.preventDefault();
                      setUrlBody(normalizeUrlBody(text));
                    }
                  }}
                  placeholder="yourwebsite.com"
                  className="flex-1 bg-transparent outline-none border-0 h-9 sm:h-10 text-base placeholder:text-zinc-500 dark:placeholder:text-zinc-500"
                />
              </div>
            </div>
            <Button
              onClick={handleRegister}
              disabled={!isConnected || !isValidHttpUrl(fullUrl)}
              title={!isConnected ? "Connect wallet before registering your site" : undefined}
              aria-disabled={!isConnected}
              className="w-full py-3 rounded-xl"
            >
              Register
            </Button>
            {availability !== "unknown" && (
              <div className="text-center text-xs text-muted-foreground">
                {availability === "checking" && "Checking availability..."}
                {availability === "available" && "Looks available!"}
                {availability === "taken" && "Already registered."}
              </div>
            )}
            {error && <div className="text-center text-red-600 dark:text-red-400">{error}</div>}
            {txStatus && <div className="text-center text-green-600 dark:text-green-400">{txStatus}</div>}
            {txHash && (
              <div className="text-center text-sm">
                <a className="underline text-zinc-700 dark:text-zinc-300" href={(explorerBase ? `${explorerBase}${txHash}` : `#`)} target="_blank" rel="noreferrer">
                  View on explorer
                </a>
              </div>
            )}
          </CardContent>
          <CardFooter className="px-6 py-4 border-t border-zinc-300 dark:border-zinc-700 justify-center">
            <span className="text-xs text-muted-foreground text-center">Powered by RainbowKit + wagmi + viem</span>
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
