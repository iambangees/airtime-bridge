import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Airtime Bridge — a fresh account number for every top-up",
  description: "Get a one-time bank account number, transfer the exact amount, and your airtime lands the moment the money does. Powered by Monnify + VTpass.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
