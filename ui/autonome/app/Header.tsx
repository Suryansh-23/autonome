"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export function Header() {
  const pathname = usePathname();
  const isApp = pathname?.startsWith("/app");

  if (isApp) return null;

  return (
    <header className="w-full flex items-center justify-between px-4 sm:px-6 py-5 sticky top-0 z-20 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-zinc-900/40">
      <Link href="/" className="inline-flex items-center gap-2.5">
        <Image src="/autonome.png" alt="autotone" width={44} height={44} className="h-11 w-11" />
        <span className="font-black tracking-tight text-xl sm:text-2xl bg-clip-text text-transparent bg-gradient-to-r from-zinc-900 via-zinc-700 to-zinc-400 dark:from-zinc-100 dark:via-zinc-300 dark:to-zinc-500">Autonome</span>
      </Link>
      <Link
        href="/app"
        className="inline-flex items-center gap-2.5 rounded-full border border-zinc-300/80 dark:border-zinc-700/80 px-5 sm:px-6 py-2.5 text-base sm:text-lg font-semibold shadow-sm hover:shadow transition bg-white/70 dark:bg-zinc-900/60"
      >
        Launch App
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 17L17 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M8 7H17V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </Link>
    </header>
  );
}
