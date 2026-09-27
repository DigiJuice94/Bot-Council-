import type { Metadata } from "next";
import "./globals.css";
import "./dashboard.css";
import "../components/council-room.css";

export const metadata: Metadata = {
  title: "Bot Council — Live Council Room",
  description: "Live council session: the eight-bot trading council reviewing coins in real time, with paper portfolio and trade log.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
