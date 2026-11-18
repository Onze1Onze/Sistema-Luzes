import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    emptyOutDir: true,
      rollupOptions: { input: { main: resolve(process.cwd(), "index.html"), background: resolve(process.cwd(), "background.html"), modal: resolve(process.cwd(), "modal.html") } }
  }
});
