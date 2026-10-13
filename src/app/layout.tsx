import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
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
  themeColor: "#191D21",
  // viewport-fit=cover lets us paint into the iOS notch area
  viewportFit: "cover",
};

// Brand face for the whole app (Brand Guide v1.0: Archivo only). Pinned
// on <body> so every page — login, legacy routes, CRE OS — resolves the
// --font-archivo variable; before this it was only set inside /cre-os and
// the font stack fell through to Times everywhere else.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="font-sans">
        {/* App shell */}
        <div className="relative z-[1]">{children}</div>
      </body>
    </html>
  );
}
