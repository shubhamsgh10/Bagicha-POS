// Thin Vercel wrapper — re-exports the esbuild-bundled Express handler.
// @vercel/node compiles this file alone; the bundle contains all server code.
export { default } from "../dist/app-bundle.js";
