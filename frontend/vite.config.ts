import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies the API so the browser stays same-origin, which the
// backend's Origin check and SameSite=Strict cookie require.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } },
  },
  // Fonts are never inlined as data: URIs, so the server's CSP can stay font-src 'self'.
  build: { outDir: "dist", sourcemap: false, assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined) },
});
