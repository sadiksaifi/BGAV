import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./manifest.config.ts";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    // The layout engine (ELK) is about 1.5 MB. It loads only on run pages.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    cors: { origin: [/chrome-extension:\/\//] },
  },
});
