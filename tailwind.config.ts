import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        display: ["Cormorant Garamond", "Georgia", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        green: "var(--shadow-green)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar-background)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },

        /* ── Bagicha design-system scales (namespaced — no Tailwind collisions) ── */
        garden: {
          50: "var(--green-50)", 100: "var(--green-100)", 200: "var(--green-200)",
          300: "var(--green-300)", 400: "var(--green-400)", 500: "var(--green-500)",
          600: "var(--green-600)", 700: "var(--green-700)", 800: "var(--green-800)",
          900: "var(--green-900)", 950: "var(--green-950)",
          DEFAULT: "var(--green-800)",
        },
        ink: {
          500: "var(--ink-500)", 600: "var(--ink-600)", 700: "var(--ink-700)",
          800: "var(--ink-800)", 900: "var(--ink-900)",
          DEFAULT: "var(--ink-700)",
        },
        clay: {
          500: "var(--clay-500)", 600: "var(--clay-600)", 700: "var(--clay-700)",
          DEFAULT: "var(--clay-600)",
        },
        gold: {
          400: "var(--amber-400)", 500: "var(--amber-500)", 600: "var(--amber-600)",
          DEFAULT: "var(--amber-500)",
        },
        paper: {
          0: "var(--paper-0)", 50: "var(--paper-50)", 100: "var(--paper-100)", 200: "var(--paper-200)",
          DEFAULT: "var(--paper-50)",
        },
        line: { DEFAULT: "var(--line)", strong: "var(--line-strong)" },
         "text-strong": "var(--text-strong)",
        "text-muted": "var(--text-2)",
        "text-subtle": "var(--text-3)",
        success: { DEFAULT: "var(--success)", bg: "var(--success-bg)" },
        warning: { DEFAULT: "var(--warning)", bg: "var(--warning-bg)" },
        danger: { DEFAULT: "var(--danger)", bg: "var(--danger-bg)" },
        info: { DEFAULT: "var(--info)", bg: "var(--info-bg)" },
        status: {
          pending: "var(--status-pending)", preparing: "var(--status-preparing)",
          ready: "var(--status-ready)", served: "var(--status-served)",
          cancelled: "var(--status-cancelled)",
        },
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
