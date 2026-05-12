import type { MetadataRoute } from "next";

/**
 * PWA manifest — lets users "Add to Home Screen" on iOS / Android and
 * get a standalone chromeless launch, instead of opening in the browser
 * with the URL bar. Theme + background colors match our app shell so the
 * splash + chrome feel native.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stewardship CRE OS",
    short_name: "CRE OS",
    description: "Commercial real estate operating system for Stewardship Asset Group",
    start_url: "/cre-os",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0D0D0D",
    theme_color: "#0D0D0D",
    icons: [
      { src: "/icon.png", sizes: "any", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    categories: ["business", "productivity"],
  };
}
