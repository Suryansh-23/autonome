import type { ReactNode } from "react";
import { RainbowProvider } from "./RainbowProvider";
import { AppHeader } from "./AppHeader";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RainbowProvider>
      <AppHeader />
      {children}
    </RainbowProvider>
  );
}
