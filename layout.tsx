import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bot War Room V2",
  description: "Eight AI agents, six chains, deterministic risk and paper execution.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
