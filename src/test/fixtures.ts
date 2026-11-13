import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGraph } from "../github/parse";
import type { RunGraph } from "../model/types";

export function fixture(name: string): string {
  return readFileSync(join(process.cwd(), "test/fixtures", name), "utf8");
}

export function graphFixture(name: string): RunGraph {
  document.body.innerHTML = fixture(name);
  const region = document.querySelector('[role="region"][aria-label="Workflow run graph"]');
  if (!region) throw new Error(`No graph region in ${name}`);
  return parseGraph(region);
}
