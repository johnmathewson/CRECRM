import { Space_Grotesk, DM_Sans, Inter, JetBrains_Mono } from "next/font/google";

/**
 * /print/* layout — loads the brand fonts so PDFs render with the same
 * typography as the rest of the platform, but does NOT impose the
 * viewport-lock styling that /cre-os/* uses for the app shell. Pages
 * under /print/ scroll naturally on the body, which is what print routes
 * need so the broker can preview the document before saving as PDF.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${spaceGrotesk.variable} ${dmSans.variable} ${inter.variable} ${jetbrains.variable}`}
    >
      {children}
    </div>
  );
}
