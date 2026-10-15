import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = Number(process.env.PORT ?? 8787);

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // xfwd: the API sees the address you opened (for the Upstox redirect URL).
    proxy: { "/api": { target: `http://localhost:${API_PORT}`, changeOrigin: true, xfwd: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
