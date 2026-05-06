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
        // Brand backgrounds (4-stop gradient mirrors the marketing site)
        steward: {
          base: "#0A1615",
          dark: "#0D1F1E",
          mid: "#142827",
          panel: "#1A2726",
          ink: "#0A1615",      // alias for "page"
          surface: "#142827",  // raised panel
          surfaceHi: "#1A2726",// active/selected panel
        },
        coral: {
          50:  "#FCF1EE",
          100: "#F8DBD2",
          200: "#F2BCAB",
          300: "#EA9A82",
          400: "#E07A5F",
          500: "#C66648",
          600: "#A55236",
          700: "#843E27",
          800: "#5F2C1B",
          900: "#3A1A10",
          DEFAULT: "#E07A5F",
          muted: "rgba(224,122,95,0.22)",
          glow: "rgba(224,122,95,0.35)",
        },
        teal: {
          50:  "#EDFAF8",
          100: "#D0F4EE",
          200: "#A3E8DD",
          300: "#6DD8C9",
          400: "#4ECDC4",
          500: "#3CB8AD",
          600: "#2E9A91",
          700: "#247B74",
          800: "#1A5C57",
          900: "#103D3A",
          DEFAULT: "#4ECDC4",
          muted: "rgba(78,205,196,0.22)",
        },
        cream: {
          50:  "#FFFFFF",
          100: "#FAF8F5",
          200: "#F0EDE8",
          300: "#E5E0D8",
          400: "#D4CEC4",
          DEFAULT: "#F0EDE4",
          muted: "rgba(240,237,228,0.50)",
          subtle: "rgba(240,237,228,0.30)",
          dim: "rgba(240,237,228,0.65)",
        },
        charcoal: {
          50:  "#F7F7F7",
          100: "#E3E3E3",
          200: "#C8C8C8",
          300: "#A4A4A4",
          400: "#818181",
          500: "#666666",
          600: "#4D4D4D",
          700: "#383838",
          800: "#282828",
          900: "#1A1A1A",
          950: "#0D0D0D",
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
        // Brand voice: Cinzel display, DM Sans heading, Inter body, JetBrains mono.
        // Loaded via next/font in the cre-os layout (CSS variable indirection).
        display: ["var(--font-cinzel)", "Times New Roman", "serif"],
        heading: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        body:    ["var(--font-inter)", "system-ui", "sans-serif"],
        mono:    ["var(--font-jetbrains)", "ui-monospace", "monospace"],
        // `sans` keeps existing legacy stack so old pages don't change.
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
      boxShadow: {
        "panel-flat": "0 0 0 1px rgba(255,255,255,0.04)",
        "panel-soft": "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
        "coral-glow": "0 0 24px rgba(224,122,95,0.20)",
      },
      letterSpacing: {
        eyebrow: "0.12em",
      },
    },
  },
  plugins: [],
};
export default config;
