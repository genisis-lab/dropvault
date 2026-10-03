import type { Config } from "tailwindcss"

// The accent scale is driven by CSS variables (see index.css) so it can flip
// between Drive's light and dark blues without per-component dark classes.
const accent = (step: number) => `rgb(var(--drift-${step}) / <alpha-value>)`

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: {
        xs: "400px",
      },
      colors: {
        drift: {
          50: accent(50),
          100: accent(100),
          200: accent(200),
          300: accent(300),
          400: accent(400),
          500: accent(500),
          600: accent(600),
          700: accent(700),
          800: accent(800),
          900: accent(900),
        },
        app: "rgb(var(--c-app) / <alpha-value>)",
        sheet: "rgb(var(--c-card) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        outline: "rgb(var(--c-outline) / <alpha-value>)",
        strong: "rgb(var(--c-strong) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        faint: "rgb(var(--c-faint) / <alpha-value>)",
        hover: "rgb(var(--c-hover) / <alpha-value>)",
        field: "rgb(var(--c-subtle) / <alpha-value>)",
        selected: "rgb(var(--c-selected) / <alpha-value>)",
        "on-selected": "rgb(var(--c-on-selected) / <alpha-value>)",
        primary: "rgb(var(--c-primary) / <alpha-value>)",
        "on-primary": "rgb(var(--c-on-primary) / <alpha-value>)",
        menu: "rgb(var(--c-menu) / <alpha-value>)",
        fab: "rgb(var(--c-fab) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          '"Google Sans Text"',
          '"Google Sans"',
          "Roboto",
          '"Segoe UI"',
          "system-ui",
          "sans-serif",
        ],
        display: [
          '"Google Sans"',
          '"Google Sans Text"',
          "Roboto",
          '"Segoe UI"',
          "system-ui",
          "sans-serif",
        ],
      },
      backdropBlur: { xs: "2px" },
    },
  },
  plugins: [],
} satisfies Config
