type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

const SVG_NS = "http://www.w3.org/2000/svg";

function apply(el: Element, attrs: Attrs | undefined, children: Child[]): void {
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        el.setAttribute(key, value === true ? "" : String(value));
      }
    }
  }
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    el.append(typeof child === "number" ? String(child) : child);
  }
}

/** Creates an HTML element. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs, children);
  return el;
}

/** Creates an SVG element. */
export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs, children);
  return el;
}
