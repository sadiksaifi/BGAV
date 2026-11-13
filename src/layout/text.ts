/** GitHub's system font stack. The panel sets the same font so measurements match. */
export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

let context: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

/** Width of `text` in pixels at the given font weight and size. */
export function textWidth(text: string, weight: number, size: number): number {
  const key = `${weight}|${size}|${text}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  if (context === undefined) {
    try {
      context = document.createElement("canvas").getContext("2d");
    } catch {
      context = null;
    }
  }
  let width = 0;
  if (context && typeof context.measureText === "function") {
    context.font = `${weight} ${size}px ${FONT_STACK}`;
    width = context.measureText(text).width;
  }
  // Without canvas (tests), estimate from the average glyph width.
  if (!(width > 0)) width = text.length * size * 0.56;
  cache.set(key, width);
  return width;
}
