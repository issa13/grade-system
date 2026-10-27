import type { Config } from "tailwindcss";
export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', "system-ui", "sans-serif"] },
      colors: {
        brand: { 50: "#eef6f4", 100: "#d5ebe5", 500: "#1f7a68", 600: "#18614f", 700: "#134d3f" },
      },
    },
  },
  plugins: [],
} satisfies Config;
