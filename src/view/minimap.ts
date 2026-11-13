import type { Layout } from "../layout/layout";
import { h } from "../lib/dom";
import type { Status } from "../model/types";
import type { Transform } from "./viewport";

const MAX_W = 200;
const MAX_H = 140;

const STATUS_VAR: Record<Status, string> = {
  success: "--bgav-success",
  failure: "--bgav-danger",
  cancelled: "--bgav-fg-muted",
  running: "--bgav-attention",
  waiting: "--bgav-attention",
  queued: "--bgav-fg-muted",
  pending: "--bgav-fg-muted",
  neutral: "--bgav-fg-muted",
  skipped: "--bgav-fg-muted",
  unknown: "--bgav-fg-muted",
};

/** Overview of the whole graph with the visible area outlined. Click or drag to move there. */
export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private layout?: Layout;
  private scale = 1;
  private size = { width: 0, height: 0 };

  constructor(
    private readonly styleSource: HTMLElement,
    private readonly moveTo: (x: number, y: number) => void,
  ) {
    this.canvas = h("canvas", { "aria-hidden": "true" });
    this.el = h("div", { class: "minimap", title: "Overview: click or drag to move" }, this.canvas);
    let dragging = false;
    const move = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      this.moveTo((e.clientX - rect.left) / this.scale, (e.clientY - rect.top) / this.scale);
    };
    this.el.addEventListener("pointerdown", (e) => {
      dragging = true;
      this.el.setPointerCapture(e.pointerId);
      move(e);
      e.preventDefault();
      e.stopPropagation();
    });
    this.el.addEventListener("pointermove", (e) => dragging && move(e));
    this.el.addEventListener("pointerup", () => {
      dragging = false;
    });
    this.el.addEventListener("pointercancel", () => {
      dragging = false;
    });
  }

  setLayout(layout: Layout): void {
    this.layout = layout;
    this.scale = Math.min(MAX_W / Math.max(1, layout.width), MAX_H / Math.max(1, layout.height));
    this.size = {
      width: Math.round(layout.width * this.scale),
      height: Math.round(layout.height * this.scale),
    };
  }

  draw(t: Transform, view: { width: number; height: number }): void {
    const layout = this.layout;
    if (!layout) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = this.size;
    if (
      this.canvas.width !== Math.round(width * ratio) ||
      this.canvas.height !== Math.round(height * ratio)
    ) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(this.styleSource);
    const color = (name: string) => css.getPropertyValue(name).trim() || "#888";

    ctx.setTransform(ratio * this.scale, 0, 0, ratio * this.scale, 0, 0);
    ctx.clearRect(0, 0, layout.width, layout.height);

    ctx.lineWidth = 2 / this.scale;
    ctx.strokeStyle = color("--bgav-border");
    for (const c of layout.clusters.values()) ctx.strokeRect(c.x, c.y, c.width, c.height);

    for (const n of layout.nodes.values()) {
      ctx.fillStyle = color(STATUS_VAR[n.node.status]);
      ctx.globalAlpha = n.node.status === "skipped" || n.node.status === "pending" ? 0.35 : 0.8;
      ctx.fillRect(n.x, n.y, n.width, n.height);
    }
    ctx.globalAlpha = 1;

    const vx = -t.x / t.k;
    const vy = -t.y / t.k;
    ctx.lineWidth = 2 / this.scale;
    ctx.strokeStyle = color("--bgav-accent");
    ctx.fillStyle = color("--bgav-accent-bg");
    ctx.globalAlpha = 0.35;
    ctx.fillRect(vx, vy, view.width / t.k, view.height / t.k);
    ctx.globalAlpha = 1;
    ctx.strokeRect(vx, vy, view.width / t.k, view.height / t.k);
  }
}
