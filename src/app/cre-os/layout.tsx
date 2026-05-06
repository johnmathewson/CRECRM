import { Cinzel, DM_Sans, Inter, JetBrains_Mono } from "next/font/google";

/**
 * CRE OS layout — loads brand fonts and pins them to CSS variables that the
 * Tailwind config consumes (font-display / font-heading / font-body / font-mono).
 *
 * Loading is scoped to /cre-os/* during the rebuild. When the rebuild becomes
 * the default, this moves to the root layout.
 */
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cinzel",
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

export default function CreOsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${cinzel.variable} ${dmSans.variable} ${inter.variable} ${jetbrains.variable} h-screen w-screen overflow-hidden`}
    >
      {children}
    </div>
  );
}
