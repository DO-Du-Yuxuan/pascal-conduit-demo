import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const packageVersion = process.env.npm_package_version ?? "0.1.0";
const revision = process.env.GITHUB_SHA?.slice(0, 7) ?? "local";
const buildTime = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/pascal-conduit-demo/" : "/",
  build: { sourcemap: true },
  plugins: [react()],
  define: {
    "process.env.NEXT_PUBLIC_ASSETS_CDN_URL": JSON.stringify("https://editor.pascal.app"),
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
    __BUILD_LABEL__: JSON.stringify(`v${packageVersion} · ${revision} · ${buildTime}`),
  },
  test: {
    // The published core package uses extensionless internal ESM imports.
    // Transform it with Vite so tests exercise the same resolver as the browser.
    server: { deps: { inline: ["@pascal-app/core", "@pascal-app/viewer"] } },
    exclude: ["node_modules/**", "src/evaluation/**", "src/evaluation-report/**", "src/evaluation-ui/**", "src/parser/evaluation-handoff.test.ts", "src/requirements/**", "src/space-functions/**", "scripts/**"],
  },
});
