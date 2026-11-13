import { isRunPage } from "./route";

// This script runs on every github.com page, so it stays tiny. The graph code,
// including the layout engine, loads only when a workflow run page opens.
let main: Promise<typeof import("./main")> | undefined;

function sync(): void {
  if (!main && !isRunPage(location.pathname)) return;
  main ??= import("./main");
  void main.then((m) => m.sync());
}

sync();
// GitHub navigates with Turbo, which swaps the page without a full load.
document.addEventListener("turbo:load", sync);
document.addEventListener("turbo:render", sync);
window.addEventListener("popstate", sync);
