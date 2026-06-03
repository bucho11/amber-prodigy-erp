import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node20",
  clean: true,
  // Bundle workspace packages from source; keep node_modules deps (express, pg) external.
  noExternal: [/^@prodigy\//],
});
