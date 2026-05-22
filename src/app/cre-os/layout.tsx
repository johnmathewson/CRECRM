import { Space_Grotesk, DM_Sans, Inter, JetBrains_Mono } from "next/font/google";
import { ContactDrawerProvider } from "@/components/cre-os/ContactDrawer";

/**
 * CRE OS layout — loads brand fonts and pins them to CSS variables that the
 * Tailwind config consumes (font-display / font-heading / font-body / font-mono).
 *
 * Loading is scoped to /cre-os/* during the rebuild. When the rebuild becomes
 * the default, this moves to the root layout.
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

export default function CreOsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${spaceGrotesk.variable} ${dmSans.variable} ${inter.variable} ${jetbrains.variable} h-[100dvh] w-screen overflow-hidden`}
    >
      {/* ContactDrawerProvider lets any lead row (Inbox card, Command
          worklist, etc.) open the universal slide-over in-context instead
          of navigating to /cre-os/inbox/[id]. */}
      <ContactDrawerProvider>{children}</ContactDrawerProvider>
    </div>
  );
}
