import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Phone testing: run `npm run dev` and open http://<your-lan-ip>:5173 on the handset.
    host: true,
    port: 5173,
  },
  test: {
    // Claude Code keeps its worktrees under .claude, each one a full checkout
    // with its own copy of src. Without this the suite runs every file twice —
    // once here and once against whatever that branch last had — and a green
    // run stops meaning the working tree is green.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
    // Only the render smoke tests need a DOM, and they ask for it with a
    // `@vitest-environment jsdom` docblock. Everything else is pure functions
    // over typed arrays, and building a document for those costs more than
    // they take to run.
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
  },
});
