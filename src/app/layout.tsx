import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stewardship CRM — CRE Intelligence Platform",
  description:
    "Commercial real estate intelligence platform for Stewardship Asset Group",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans">
        {/* Ambient background orbs — gives the glass something to frost over */}
        <div className="bg-orb-coral" />
        <div className="bg-orb-teal" />
        <div className="bg-orb-green" />
        <div className="bg-mesh" />

        {/* App shell */}
        <div className="relative z-[1]">{children}</div>
      </body>
    </html>
  );
}
