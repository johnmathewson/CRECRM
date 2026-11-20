import localFont from "next/font/local";

/**
 * /print/* layout — loads the brand fonts (self-hosted in src/app/fonts; see
 * src/app/layout.tsx for why not next/font/google) so PDFs render with the same
 * typography as the rest of the platform, but does NOT impose the
 * viewport-lock styling that /cre-os/* uses for the app shell. Pages
 * under /print/ scroll naturally on the body, which is what print routes
 * need so the broker can preview the document before saving as PDF.
 */
const spaceGrotesk = localFont({
  src: "../fonts/space-grotesk-latin.woff2",
  weight: "300 700",
  variable: "--font-space-grotesk",
  display: "swap",
});
const dmSans = localFont({
  src: "../fonts/dm-sans-latin.woff2",
  weight: "100 1000",
  variable: "--font-dm-sans",
  display: "swap",
});
const inter = localFont({
  src: "../fonts/inter-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});
const jetbrains = localFont({
  src: "../fonts/jetbrains-mono-latin.woff2",
  weight: "100 800",
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
