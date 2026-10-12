import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    setupFiles: ["./src/test/setup.ts"],
    // Database tests share one database, so files run one at a time.
    fileParallelism: false,
  },
});
