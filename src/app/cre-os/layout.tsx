import { Archivo } from "next/font/google";
import { ContactDrawerProvider } from "@/components/cre-os/ContactDrawer";

/**
 * CRE OS layout — loads the brand face and pins it to the CSS variable the
 * Tailwind config consumes. Brand Guide v1.0 (2026): Archivo only —
 * 800 headlines, 700 labels, 600 key figures, 400 body.
 *
 * Loading is scoped to /cre-os/*. When the rebuild becomes the default,
 * this moves to the root layout.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});

export default function CreOsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${archivo.variable} font-body h-[100dvh] w-screen overflow-hidden`}>
      {/* ContactDrawerProvider lets any lead row open the universal
          slide-over in-context instead of navigating to /cre-os/inbox/[id]. */}
      <ContactDrawerProvider>{children}</ContactDrawerProvider>
    </div>
  );
}
