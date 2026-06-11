import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kleurboek - Foto naar Kleurplaat",
  description: "Zet je foto's om in kleurplaten met AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
