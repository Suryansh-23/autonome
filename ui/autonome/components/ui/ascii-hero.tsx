"use client";
import Link from "next/link";

export function AsciiHero() {
  const ascii = String.raw`
 █████╗ ██╗   ██╗████████╗ ██████╗ ███╗   ██╗ ██████╗ ███╗   ███╗███████╗
██╔══██╗██║   ██║╚══██╔══╝██╔═══██╗████╗  ██║██╔═══██╗████╗ ████║██╔════╝
███████║██║   ██║   ██║   ██║   ██║██╔██╗ ██║██║   ██║██╔████╔██║█████╗  
██╔══██║██║   ██║   ██║   ██║   ██║██║╚██╗██║██║   ██║██║╚██╔╝██║██╔══╝  
██║  ██║╚██████╔╝   ██║   ╚██████╔╝██║ ╚████║╚██████╔╝██║ ╚═╝ ██║███████╗
╚═╝  ╚═╝ ╚═════╝    ╚═╝    ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝
                                                                         `;

  return (
    <div className="w-full flex flex-col items-center justify-center gap-8">
      <pre
        aria-label="Autonome banner"
        className="max-w-full overflow-auto whitespace-pre leading-[1.15] px-4 py-6"
      >
        <code className="block font-mono text-[10px] xs:text-xs sm:text-sm md:text-base tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-fuchsia-400 via-pink-400 to-sky-400 drop-shadow-[0_0_0.35rem_rgba(0,0,0,0.25)]">
          {ascii}
        </code>
      </pre>

      <p className="text-center text-sm sm:text-base text-zinc-600 dark:text-zinc-300 max-w-2xl">
        {/* Placeholder statement — replace with your final tagline */}
        Coming soon: product statement placeholder.
      </p>

      <div className="flex items-center gap-3">
        <Link href="/app" className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold shadow hover:opacity-95 transition">
        Launch App
          <span className="opacity-70 group-hover:opacity-90 transition"></span>
        </Link>
      </div>
    </div>
  );
}
