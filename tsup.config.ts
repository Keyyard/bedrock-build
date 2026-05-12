import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    dts: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    outDir: "dist",
    sourcemap: true,
    clean: false,
    dts: true,
  },
]);
