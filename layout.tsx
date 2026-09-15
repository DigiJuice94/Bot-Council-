import type { Metadata } from "next";
import "./globals.css";
import "./v213.css";
import "./v214.css";

export const metadata: Metadata = {
  title: "Bot War Room V2.14 — Runner Genome",
  description: "Autonomous meme-launch research council that studies runner-vs-dumper patterns, paper trades fresh launches, files lessons and tracks Code Deciphered graduation toward live eligibility.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
