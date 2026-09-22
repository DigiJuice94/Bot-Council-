import type { Metadata } from "next";
import "./globals.css";
import "./diagnostics.css";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "Bot War Room V3",
  description: "Autonomous multi-chain Runner Genome research council with fresh-coin paper trading, Filing Cabinet learning and Code Deciphered graduation.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
