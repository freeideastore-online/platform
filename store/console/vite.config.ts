import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiOrigin = process.env.FIS_API_ORIGIN || "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/console/",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "index.vite.html",
      output: {
        entryFileNames: "assets/bundle.js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  },
  server: {
    proxy: {
      "/api": apiOrigin,
      "/.fis": apiOrigin
    }
  }
});
