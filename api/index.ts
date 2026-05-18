// Thin Vercel wrapper — re-exports the esbuild-bundled Express handler.
// @vercel/node compiles this file alone; the bundle contains all server code.
// @ts-ignore — esbuild output has no type declarations
export { default } from "../dist/app-bundle.js";
