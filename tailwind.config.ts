// tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx,js,jsx}", "./components/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#4F46E5",
          primaryDark: "#4338CA",
          bg: "#0B1220",
          card: "#0F172A",
          border: "#1F2937",
        },
      },
      boxShadow: {
        card: "0 10px 25px -10px rgba(0,0,0,0.35)",
      },
      borderRadius: {
        xl: "14px",
      },
    },
  },
  plugins: [],
} satisfies Config;
