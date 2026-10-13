/** @type {import('tailwindcss').Config} */
export default {
  content: ["./web/index.html", "./web/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', "Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      colors: {
        // Tokens live in web/src/styles.css; screens never name a raw colour.
        bg: "rgb(var(--bg) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        sunk: "rgb(var(--sunk) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-2": "rgb(var(--ink-2) / <alpha-value>)",
        "ink-3": "rgb(var(--ink-3) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        "brand-soft": "rgb(var(--brand-soft) / <alpha-value>)",
        "on-brand": "rgb(var(--on-brand) / <alpha-value>)",
        pos: "rgb(var(--pos) / <alpha-value>)",
        neg: "rgb(var(--neg) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
      },
      borderRadius: { card: "16px" },
      boxShadow: { float: "0 12px 32px rgb(20 10 40 / 0.18)" },
    },
  },
  plugins: [],
};
