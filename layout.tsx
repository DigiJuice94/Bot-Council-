import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bot War Room V2.12",
  description: "Autonomous real-market eight-bot trading council with a persistent $1,000 paper wallet, live new-listing discovery, deterministic risk and Guardian position management.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
