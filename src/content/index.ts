import { isRunPage } from "./route";

const MARKER = "data-bgav";

function sync(): void {
  if (isRunPage(location.pathname)) {
    document.documentElement.setAttribute(MARKER, "active");
  } else {
    document.documentElement.removeAttribute(MARKER);
  }
}

sync();
// GitHub uses Turbo for in-app navigation; these fire after each soft page change.
document.addEventListener("turbo:load", sync);
document.addEventListener("turbo:render", sync);
