/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class", // Enable dark mode via class
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        primary: {
          50: "rgb(var(--color-primary-50, 239 246 255) / <alpha-value>)",
          100: "rgb(var(--color-primary-100, 219 234 254) / <alpha-value>)",
          200: "rgb(var(--color-primary-200, 191 219 254) / <alpha-value>)",
          300: "rgb(var(--color-primary-300, 147 197 253) / <alpha-value>)",
          400: "rgb(var(--color-primary-400, 96 165 250) / <alpha-value>)",
          500: "rgb(var(--color-primary-500, 59 130 246) / <alpha-value>)",
          600: "rgb(var(--color-primary-600, 37 99 235) / <alpha-value>)",
          700: "rgb(var(--color-primary-700, 29 78 216) / <alpha-value>)",
          800: "rgb(var(--color-primary-800, 30 64 175) / <alpha-value>)",
          900: "rgb(var(--color-primary-900, 30 58 138) / <alpha-value>)",
          950: "rgb(var(--color-primary-950, 23 37 84) / <alpha-value>)",
        },
        finary: {
          bg: '#0a0a0a',
          surface: '#111111',
          'surface-hover': '#1a1a1a',
          'surface-elevated': '#161616',
          gold: '#c8a55e',
          'gold-soft': 'rgba(200, 165, 94, 0.15)',
          green: '#22c55e',
          red: '#ef4444',
        },
        success: {
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
        },
        danger: {
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
        },
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-in-out",
        "slide-up": "slideUp 0.3s ease-out",
        "fade-in-up": "fadeInUp 0.4s ease-out both",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
      },
    },
  },
  plugins: [],
};
