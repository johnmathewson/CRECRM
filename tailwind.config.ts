import type { Config } from "tailwindcss";

/**
 * Stewardship CRE Brand Guide v1.0 (2026) — Ink & Copper, Archivo only,
 * zero radius, no shadows, no gradients. See CLAUDE.md "Brand".
 *
 * The old token NAMES (coral / teal / amber / cream / steward-*) are kept so
 * ~3,400 existing class usages keep working; their VALUES now resolve to the
 * brand ramps:
 *   coral → Copper (the one accent)
 *   teal  → Ink neutrals (there is no second accent; "positive" is quiet)
 *   amber → Copper 500/700 (attention, still copper)
 *   cream → Bone / Ink text channel
 */
const INK = {
  100: "#F7F6F4",
  200: "#E7E4DE",
  300: "#D5D2CC",
  400: "#B6B8B9",
  500: "#9AA0A6",
  600: "#6B7076",
  700: "#4A5056",
  800: "#2E353B",
  900: "#191D21",
};
const COPPER = {
  100: "#FDF1EB",
  200: "#F8DFD2",
  300: "#EFC0A6",
  400: "#E2966F",
  500: "#CE6E42",
  600: "#B4552F",
  700: "#7E361B",
  800: "#5C2614",
  900: "#3D1D12",
};

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // Zero radius everywhere (brand). `rounded-full` stays for avatars.
    borderRadius: {
      none: "0",
      sm: "0",
      DEFAULT: "0",
      md: "0",
      lg: "0",
      xl: "0",
      "2xl": "0",
      "3xl": "0",
      panel: "0",
      inner: "0",
      full: "9999px",
    },
    extend: {
      colors: {
        // Semantic surface tokens are CSS-variable channels so `.canvas-light`
        // (the content area) runs Bone/White while the nav chrome stays Ink.
        steward: {
          base: "rgb(var(--bg) / <alpha-value>)",
          dark: "rgb(var(--surface) / <alpha-value>)",
          mid: "rgb(var(--surface-hi) / <alpha-value>)",
          panel: "rgb(var(--surface-panel) / <alpha-value>)",
          ink: "rgb(var(--bg) / <alpha-value>)",
          surface: "rgb(var(--surface) / <alpha-value>)",
          surfaceHi: "rgb(var(--surface-hi) / <alpha-value>)",
        },
        ink: INK,
        copper: { ...COPPER, DEFAULT: COPPER[600] },
        bone: "#F0EDE7",
        // Legacy accent names → brand values.
        coral: {
          50: COPPER[100],
          100: COPPER[100],
          200: COPPER[200],
          300: COPPER[400], // light accent text on Ink chrome
          400: COPPER[600], // the accent
          500: COPPER[700],
          600: COPPER[800],
          700: COPPER[900],
          800: COPPER[900],
          900: COPPER[900],
          DEFAULT: COPPER[600],
          muted: "rgba(180,85,47,0.18)",
          glow: "rgba(180,85,47,0.18)",
        },
        teal: {
          50: INK[100],
          100: INK[200],
          200: INK[300],
          300: INK[400], // quiet "done" text on Ink chrome
          400: INK[500],
          500: INK[600],
          600: INK[700],
          700: INK[800],
          800: INK[900],
          900: INK[900],
          DEFAULT: INK[500],
          muted: "rgba(107,112,118,0.18)",
        },
        cream: {
          50: "#FFFFFF",
          100: INK[100],
          200: "#F0EDE7",
          300: INK[200],
          400: INK[300],
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          // Readability tiers (unchanged contract): dim = secondary, muted =
          // supporting, subtle = captions. Ink 600 is the lightest text the
          // brand allows on Bone; 0.62 of Ink lands there.
          muted: "rgb(var(--ink) / 0.72)",
          subtle: "rgb(var(--ink) / 0.62)",
          dim: "rgb(var(--ink) / 0.86)",
        },
        charcoal: {
          50: INK[100],
          100: INK[200],
          200: INK[300],
          300: INK[400],
          400: INK[500],
          500: INK[600],
          600: INK[700],
          700: INK[800],
          800: INK[800],
          900: INK[900],
          950: INK[900],
        },
        emerald: {
          DEFAULT: INK[600],
          muted: "rgba(107,112,118,0.18)",
        },
        amber: {
          DEFAULT: COPPER[500],
          muted: "rgba(206,110,66,0.18)",
        },
      },
      fontFamily: {
        // Archivo only. The four roles stay as names so existing classes work;
        // weight does the differentiation (800 headlines, 700 labels, 600 key
        // figures, 400 body).
        display: ["var(--font-archivo)", "system-ui", "Helvetica", "sans-serif"],
        heading: ["var(--font-archivo)", "system-ui", "Helvetica", "sans-serif"],
        body: ["var(--font-archivo)", "system-ui", "Helvetica", "sans-serif"],
        mono: ["var(--font-archivo)", "system-ui", "Helvetica", "sans-serif"],
        sans: ["var(--font-archivo)", "-apple-system", "system-ui", "Helvetica", "sans-serif"],
      },
      backdropBlur: {
        glass: "0px",
        "glass-heavy": "0px",
      },
      boxShadow: {
        "panel-flat": "none",
        "panel-soft": "none",
        "coral-glow": "none",
      },
      letterSpacing: {
        eyebrow: "0.16em",
      },
    },
  },
  plugins: [],
};
export default config;
