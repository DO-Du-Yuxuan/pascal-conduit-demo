import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/",
  plugins: [react()],
  define: {
    "process.env.NEXT_PUBLIC_ASSETS_CDN_URL": JSON.stringify("https://editor.pascal.app"),
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
  },
  test: {
    exclude: ["node_modules/**", "src/evaluation/**", "src/evaluation-report/**", "src/evaluation-ui/**", "src/parser/evaluation-handoff.test.ts", "src/requirements/**", "src/space-functions/**", "scripts/**"],
  },
});
