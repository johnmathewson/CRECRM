import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stewardship CRE OS",
  description:
    "Commercial real estate operating system for Stewardship Asset Group",
  // PWA + iOS "Add to Home Screen" treatment so the app feels chromeless
  // when launched from the home screen, with a matching splash color.
  applicationName: "Stewardship CRE OS",
  appleWebApp: {
    capable: true,
    title: "CRE OS",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false, // don't auto-link phone numbers (we render them deliberately)
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Allow the broker to pinch-zoom for accessibility — capped at 5x.
  maximumScale: 5,
  themeColor: "#0D0D0D",
  // viewport-fit=cover lets us paint into the iOS notch area
  viewportFit: "cover",
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
