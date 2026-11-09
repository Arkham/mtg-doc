import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the static export works from any sub-path (e.g. GitHub Pages project sites).
export default defineConfig({ base: "./", plugins: [react()] });
