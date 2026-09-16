import type { Metadata } from "next";
import "./globals.css";
import "./v213.css";
import "./v214.css";

export const metadata: Metadata = {
  title: "Bot War Room V2.28.1 — Paper Reset",
  description: "Autonomous multi-chain Runner Genome research council with chronological live group chat, fresh-coin paper trading, Filing Cabinet learning and Code Deciphered graduation.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
