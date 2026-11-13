import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    environmentOptions: { happyDOM: { url: "https://github.com/" } },
  },
});
