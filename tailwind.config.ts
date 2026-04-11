import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        steward: {
          base: "#0A1615",
          dark: "#0D1F1E",
          mid: "#142827",
          panel: "#1A2726",
        },
        coral: {
          DEFAULT: "#E07A5F",
          muted: "rgba(224,122,95,0.22)",
          glow: "rgba(224,122,95,0.35)",
        },
        cream: {
          DEFAULT: "#F0EDE4",
          muted: "rgba(240,237,228,0.50)",
          subtle: "rgba(240,237,228,0.30)",
        },
        teal: {
          DEFAULT: "#4ECDC4",
          muted: "rgba(78,205,196,0.22)",
        },
        emerald: {
          DEFAULT: "#6BCB77",
          muted: "rgba(107,203,119,0.20)",
        },
        amber: {
          DEFAULT: "#F2C94C",
          muted: "rgba(242,201,76,0.20)",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "SF Pro Display",
          "SF Pro Text",
          "Inter",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      backdropBlur: {
        glass: "24px",
        "glass-heavy": "30px",
      },
      borderRadius: {
        panel: "6px",
        inner: "4px",
      },
    },
  },
  plugins: [],
};
export default config;
