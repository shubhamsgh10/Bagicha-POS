import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

/** Relative asset paths when the UI is loaded via file:// in the Electron package. */
const electronBuild = process.env.ELECTRON_BUILD === "1";

export default defineConfig({
  base: electronBuild ? "./" : "/",
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      "@api-client": path.resolve(import.meta.dirname, "packages", "api-client"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    hmr: {
      ...(process.env.REPL_ID ? { clientPort: 5000 } : {}),
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // When using `npm run dev:client` alone, proxy API to Express on :5000
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:5000",
        changeOrigin: true,
      },
      "/ws": {
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:5000",
        ws: true,
      },
    },
  },
});
