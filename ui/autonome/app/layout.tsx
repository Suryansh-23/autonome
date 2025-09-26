import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Autonome",
  description: "Autonome is a minimal protocol. Clean. Fast. On-chain.",
  icons: {
    icon: "/autonome.png",
    shortcut: "/autonome.png",
    apple: "/autonome.png",
  },
};

import { Header } from "./Header";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
  <body className={`antialiased bg-zinc-50 dark:bg-zinc-950`}>        
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
