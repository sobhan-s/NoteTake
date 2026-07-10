import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "schemas/index": "src/schemas/index.ts",
    "types/index": "src/types/index.ts",
    "constants/index": "src/constants/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
});
