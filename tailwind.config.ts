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
        // Brand backgrounds — charcoal-anchored (dropped green tint per
        // brand evolution; mirrors the editorial financial-terminal feel
        // closer than the teal-base did).
        // Semantic surface tokens are CSS-variable channels so a single
        // `.canvas-light` scope can flip the main content area to the light
        // "slate glass" theme while the nav chrome (sidebar/topbar/rail)
        // keeps the dark defaults. Channel form ("13 13 13") preserves
        // Tailwind opacity modifiers (bg-steward-base/80 still works).
        steward: {
          base: "rgb(var(--bg) / <alpha-value>)",        // page / canvas background
          dark: "rgb(var(--surface) / <alpha-value>)",   // alt bg / sticky overlays
          mid: "rgb(var(--surface-hi) / <alpha-value>)", // raised surface (cards, panels)
          panel: "rgb(var(--surface-panel) / <alpha-value>)", // active / selected panel
          ink: "rgb(var(--bg) / <alpha-value>)",
          surface: "rgb(var(--surface) / <alpha-value>)",
          surfaceHi: "rgb(var(--surface-hi) / <alpha-value>)",
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
        // "cream" is the INK/text color. Variable-channel so text flips to
        // slate-black inside `.canvas-light` and stays cream on dark chrome.
        // (Numeric shades stay literal — used as fixed bright accents.)
        cream: {
          50:  "#FFFFFF",
          100: "#FAF8F5",
          200: "#F0EDE8",
          300: "#E5E0D8",
          400: "#D4CEC4",
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          muted: "rgb(var(--ink) / 0.50)",
          subtle: "rgb(var(--ink) / 0.30)",
          dim: "rgb(var(--ink) / 0.65)",
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
        // Brand voice: Space Grotesk display, DM Sans heading, Inter body,
        // JetBrains Mono mono. Loaded via next/font (CSS variable indirection).
        // Display swapped from Cinzel — wanted modern editorial / financial-
        // terminal energy, not luxury-invitation.
        display: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
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
