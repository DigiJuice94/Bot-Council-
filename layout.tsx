import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bot War Room V2.10",
  description: "Fast multi-agent trading council with deterministic risk, reasoning replay and persistent position monitoring.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
