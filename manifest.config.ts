import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "BGAV: Better GitHub Actions Visualizer",
  short_name: "BGAV",
  description: pkg.description,
  version: pkg.version,
  content_scripts: [
    {
      // GitHub navigates between pages without full reloads, so a run page can be
      // reached from any repository page. The script matches all of github.com and
      // does nothing until the URL is an Actions run page (see src/content/route.ts).
      matches: ["https://github.com/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
});
