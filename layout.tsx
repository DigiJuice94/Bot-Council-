import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bot War Room",
  description: "Eight AI agents. One crypto decision room.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
