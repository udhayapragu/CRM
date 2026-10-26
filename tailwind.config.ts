import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        "surface-2": v("surface-2"),
        "surface-3": v("surface-3"),
        line: v("line"),
        fg: v("fg"),
        muted: v("muted"),
        subtle: v("subtle"),
        brand: { DEFAULT: v("brand"), soft: v("brand-soft"), strong: v("brand-strong") },
        gold: { DEFAULT: v("gold"), soft: v("gold-soft") },
        success: v("success"),
        warning: v("warning"),
        danger: v("danger"),
        info: v("info"),
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ['"Cormorant Garamond"', "ui-serif", "Georgia", "serif"],
      },
      borderRadius: { xl: "0.9rem", "2xl": "1.15rem" },
      boxShadow: {
        card: "0 1px 0 0 rgb(var(--line) / 0.6) inset, 0 10px 30px -12px rgb(0 0 0 / 0.35)",
        glow: "0 0 0 1px rgb(var(--brand) / 0.35), 0 8px 30px -8px rgb(var(--brand) / 0.45)",
        gold: "0 0 0 1px rgb(var(--gold) / 0.4), 0 8px 24px -10px rgb(var(--gold) / 0.5)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-dot": { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
        "slide-in": { from: { transform: "translateX(-100%)" }, to: { transform: "none" } },
      },
      animation: {
        "fade-in": "fade-in .35s ease-out both",
        shimmer: "shimmer 1.6s infinite",
        "pulse-dot": "pulse-dot 1.8s ease-in-out infinite",
        "slide-in": "slide-in .25s ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
