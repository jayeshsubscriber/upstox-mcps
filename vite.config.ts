import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = Number(process.env.PORT ?? 8787);

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: { "/api": { target: `http://localhost:${API_PORT}`, changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
