import type { Config } from "tailwindcss";

// Tailwind v4 uses @theme inline in src/app/globals.css as the source of truth.
// This file is kept minimal for tooling compatibility.
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {},
  plugins: [],
};

export default config;
