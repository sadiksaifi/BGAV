import { MatrixLoader } from "../github/matrix";
import { STATUS_LABEL } from "../github/status";
import { type Box, type Layout, layoutGraph, measure } from "../layout/layout";
import { h, s } from "../lib/dom";
import { formatDuration } from "../lib/duration";
import { type Prefs, savePrefs } from "../lib/prefs";
import type { Job, RunGraph, Status } from "../model/types";
import {
  buildView,
  criticalPath,
  lineage,
  nodeSeconds,
  type ViewGraph,
  type ViewNode,
} from "../model/view";
import { icon, statusIcon } from "./icons";
import { Minimap } from "./minimap";
import type { OcticonName } from "./octicons";
import { bundleElement, clusterElement, edgeElement, jobTitle, nodeElement } from "./render";
import css from "./styles.css?inline";
import {
  attachGestures,
  centerOn,
  centered,
  clampPan,
  fitScale,
  isVisible,
  OPEN_SCALE,
  READABLE_SCALE,
  type Transform,
  zoomAround,
} from "./viewport";

const MIN_HEIGHT = 200;
/** Smallest panel height the automatic sizing picks. */
const MIN_INLINE_HEIGHT = 360;
/** Space left below the panel when it is sized to the window. */
const PAGE_MARGIN = 16;
const ZOOM_STEP = 1.25;
const MATRIX_POLL_MS = 10_000;
const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
/** Statuses the header calls out. Finished-and-fine jobs need no chip. */
const CHIP_STATUSES: Status[] = ["failure", "running", "waiting", "queued", "cancelled"];

interface NodeEntry {
  el: HTMLElement;
  sig: string;
}

export interface AppHooks {
  /** Called when the user switches between BGAV and GitHub's graph. */
  onModeChange: (mode: Prefs["mode"]) => void;
  /** Called when BGAV cannot draw the graph, so GitHub's graph can show instead. */
  onError: (error: unknown) => void;
}

export class BgavApp {
  readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private readonly panel: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly world: HTMLElement;
  private readonly backLayer: HTMLElement;
  private readonly edgeLayer: SVGSVGElement;
  private readonly nodeLayer: HTMLElement;
  private readonly minimap: Minimap;
  private readonly nativeBar: HTMLElement;
  private readonly brand: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly search: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly hits: HTMLElement;
  private readonly zoomLevel: HTMLButtonElement;
  private readonly fullscreenButton: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly menuItems: Record<"simplify" | "critical" | "minimap", HTMLButtonElement>;

  private run?: RunGraph;
  private view?: ViewGraph;
  private layout?: Layout;
  private layoutSig = "";
  private layoutToken = 0;
  private nodeEls = new Map<string, NodeEntry>();
  private collapsed = new Map<string, boolean>();
  private transform: Transform = { x: 0, y: 0, k: 1 };
  private placed = false;
  private userMoved = false;
  private hoverId: string | undefined;
  private query = "";
  private statusFilter: Status | undefined;
  private critical = false;
  private fullscreen = false;
  private matches: string[] = [];
  private matchIndex = -1;
  private focusId: string | undefined;
  private refreshQueued = false;
  private readonly loader: MatrixLoader;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private prefs: Prefs,
    private readonly hooks: AppHooks,
  ) {
    this.host = h("div", { id: "bgav-root" });
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.loader = new MatrixLoader(() => this.scheduleRefresh());

    this.brand = h("div", { class: "brand" });
    this.chips = h("div", {
      class: "chips",
      role: "group",
      "aria-label": "Highlight jobs by status",
    });

    this.searchInput = h("input", {
      type: "search",
      placeholder: "Find a job",
      "aria-label": "Find a job",
      spellcheck: "false",
      autocomplete: "off",
    });
    this.hits = h("span", { class: "hits", "aria-live": "polite" });
    const searchButton = this.button({
      icon: "search",
      title: "Find a job (/)",
      onClick: () => this.openSearch(),
    });
    this.search = h(
      "div",
      { class: "search" },
      searchButton,
      h("label", { class: "field" }, this.searchInput, this.hits),
    );

    this.zoomLevel = this.button({
      text: "100%",
      title: "Reset zoom to 100% (1)",
      className: "zoom-level",
      onClick: () => this.zoomTo(1),
    });
    this.fullscreenButton = this.button({
      icon: "screen-full",
      title: "Full screen (F)",
      onClick: () => this.toggleFullscreen(),
    });

    this.menuItems = {
      simplify: this.menuItem(
        "git-merge",
        "Simplify edges",
        "Hide edges already implied by a longer path",
        () => this.setPref({ simplifyEdges: !this.prefs.simplifyEdges }),
      ),
      critical: this.menuItem(
        "zap",
        "Critical path",
        "Highlight the chain of jobs that decided the run time",
        () => this.toggleCritical(),
      ),
      minimap: this.menuItem(
        "graph",
        "Overview map",
        "Show a map of the whole graph when it does not fit",
        () => this.setPref({ showMinimap: !this.prefs.showMinimap }),
      ),
    };
    this.menu = h(
      "div",
      { class: "menu", role: "menu", hidden: true },
      this.menuItems.simplify,
      this.menuItems.critical,
      this.menuItems.minimap,
      h("div", { class: "sep", role: "separator" }),
      this.menuItem("unfold", "Expand all groups", "Shortcut: E", () =>
        this.setAllCollapsed(false),
      ),
      this.menuItem("fold", "Collapse large groups", "Shortcut: C", () =>
        this.setAllCollapsed(true),
      ),
      h("div", { class: "sep", role: "separator" }),
      this.menuItem("arrow-switch", "Show GitHub's graph", "Switch back to GitHub's graph", () =>
        this.setMode("native"),
      ),
      h(
        "div",
        { class: "keys" },
        `Drag to pan · ${MOD_KEY} + scroll to zoom · / find · F full screen · 0 fit · Esc clear`,
      ),
    );
    this.menuButton = this.button({
      icon: "kebab-horizontal",
      title: "More options",
      onClick: () => this.toggleMenu(),
    });
    this.menuButton.setAttribute("aria-haspopup", "menu");
    this.menuButton.setAttribute("aria-expanded", "false");

    const toolbar = h(
      "div",
      { class: "toolbar" },
      this.brand,
      this.chips,
      h("div", { class: "spacer" }),
      this.search,
      h(
        "div",
        { class: "controls" },
        h(
          "div",
          { class: "joined" },
          this.button({
            icon: "dash",
            title: "Zoom out (-)",
            onClick: () => this.zoomBy(1 / ZOOM_STEP),
          }),
          this.zoomLevel,
          this.button({
            icon: "plus",
            title: "Zoom in (+)",
            onClick: () => this.zoomBy(ZOOM_STEP),
          }),
        ),
        this.button({
          icon: "focus-center",
          title: "Fit the graph to the view (0)",
          onClick: () => this.fit(true),
        }),
        this.fullscreenButton,
        h("div", { class: "menu-wrap" }, this.menuButton, this.menu),
      ),
    );

    this.backLayer = h("div", { class: "back" });
    this.edgeLayer = s("svg", { class: "edges", "aria-hidden": "true" });
    this.nodeLayer = h("div", { class: "nodes" });
    this.world = h("div", { class: "world" }, this.backLayer, this.edgeLayer, this.nodeLayer);
    this.minimap = new Minimap(this.host, (x, y) => this.moveCenterTo(x, y));
    this.viewport = h(
      "div",
      { class: "viewport", tabindex: "0", role: "group", "aria-label": "Workflow run graph" },
      this.world,
      this.minimap.el,
    );
    const resize = h("div", {
      class: "resize",
      title: "Drag to resize. Double-click to fit the graph.",
      "aria-hidden": "true",
    });
    this.panel = h("div", { class: "panel" }, toolbar, this.viewport, resize);
    this.nativeBar = h(
      "div",
      { class: "native-bar", hidden: true },
      this.button({
        icon: "arrow-switch",
        text: "Show BGAV graph",
        title: "Switch to the BGAV graph",
        onClick: () => this.setMode("bgav"),
      }),
    );
    this.shadow.append(h("style", {}, css), this.panel, this.nativeBar);

    this.cleanups.push(
      attachGestures(this.viewport, {
        get: () => this.transform,
        set: (t, animate) => {
          this.userMoved = true;
          this.setTransform(t, animate);
        },
        wheelPans: () => this.fullscreen,
      }),
    );
    this.bindEvents(resize);
    this.applyMode();
    this.syncControls();

    const ticker = window.setInterval(() => this.tick(), 1000);
    const poller = window.setInterval(() => this.syncMatrices(), MATRIX_POLL_MS);
    const observer = new ResizeObserver(() => this.onResize());
    observer.observe(this.viewport);
    this.cleanups.push(
      () => window.clearInterval(ticker),
      () => window.clearInterval(poller),
      () => observer.disconnect(),
    );
  }

  /** Feeds a freshly parsed run graph. Cheap to call often: layout reruns only when the structure changes. */
  update(run: RunGraph): void {
    this.run = run;
    this.renderBrand();
    this.syncMatrices();
    this.scheduleRefresh();
  }

  destroy(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.loader.clear();
    this.setFullscreen(false);
    this.host.remove();
  }

  // ---------------------------------------------------------------- state

  private setPref(patch: Partial<Prefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    void savePrefs(this.prefs);
    this.syncControls();
    this.scheduleRefresh();
  }

  private setMode(mode: Prefs["mode"]): void {
    this.closeMenu();
    if (mode === "native") this.setFullscreen(false);
    this.setPref({ mode });
    this.applyMode();
    this.hooks.onModeChange(mode);
  }

  private applyMode(): void {
    const native = this.prefs.mode === "native";
    this.panel.hidden = native;
    this.nativeBar.hidden = !native;
  }

  /** Falls back to GitHub's graph with a note when BGAV cannot draw this run. */
  showError(): void {
    this.panel.hidden = true;
    this.nativeBar.hidden = false;
    this.nativeBar.replaceChildren(
      h("span", { class: "error" }, "BGAV could not draw this graph, so GitHub's graph is shown."),
    );
  }

  private toggleCritical(): void {
    this.critical = !this.critical;
    this.syncControls();
    this.applyHighlights();
    this.renderChips();
  }

  private toggleNode(id: string): void {
    // Keep the toggled node in place instead of refitting the view.
    this.userMoved = true;
    // Expanded clusters are not nodes; they are listed in view.clusters.
    const node = this.view?.nodes.find((n) => n.id === id);
    const current = node ? node.collapsed : false;
    this.collapsed.set(id, !current);
    void this.refresh(id);
  }

  private setAllCollapsed(collapsed: boolean): void {
    this.closeMenu();
    for (const node of this.view?.nodes ?? []) {
      if (node.kind === "cluster") {
        if (!collapsed) this.collapsed.set(node.id, false);
      } else if (node.collapsible) {
        this.collapsed.set(node.id, collapsed);
      }
    }
    void this.refresh();
  }

  private syncMatrices(): void {
    for (const card of this.run?.cards ?? []) {
      if (card.matrix) {
        this.loader.sync(
          card.id,
          card.matrix.url,
          `${card.matrix.summaryStatus}|${card.matrix.summary}`,
        );
      }
    }
  }

  private syncControls(): void {
    check(this.menuItems.simplify, this.prefs.simplifyEdges);
    check(this.menuItems.critical, this.critical);
    check(this.menuItems.minimap, this.prefs.showMinimap);
    const title = this.fullscreen ? "Exit full screen (F or Esc)" : "Full screen (F)";
    this.fullscreenButton.replaceChildren(icon(this.fullscreen ? "screen-normal" : "screen-full"));
    this.fullscreenButton.title = title;
    this.fullscreenButton.setAttribute("aria-label", title);
    this.updateMinimap();
  }

  // ---------------------------------------------------------------- menu and search

  private toggleMenu(): void {
    if (this.menu.hidden) this.openMenu();
    else this.closeMenu();
  }

  private openMenu(): void {
    this.menu.hidden = false;
    this.menuButton.setAttribute("aria-expanded", "true");
    this.menu.querySelector<HTMLButtonElement>("button")?.focus();
  }

  private closeMenu(): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.menuButton.setAttribute("aria-expanded", "false");
  }

  private openSearch(): void {
    this.search.classList.add("open");
    this.searchInput.focus();
    this.searchInput.select();
  }

  private closeSearchIfEmpty(): void {
    if (this.searchInput.value === "") this.search.classList.remove("open");
  }

  // ---------------------------------------------------------------- refresh and layout

  private scheduleRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      void this.refresh();
    });
  }

  private async refresh(anchorId?: string): Promise<void> {
    const run = this.run;
    if (!run) return;
    const view = buildView(run, {
      collapsed: this.collapsed,
      simplifyEdges: this.prefs.simplifyEdges,
      matrixJobs: (id) => this.loader.jobs(id),
      matrixFailed: (id) => this.loader.failed(id),
    });
    this.view = view;

    const sig = layoutSignature(view);
    if (sig !== this.layoutSig || !this.layout) {
      this.layoutSig = sig;
      const token = ++this.layoutToken;
      let layout: Layout;
      try {
        layout = await layoutGraph(view);
      } catch (error) {
        console.error("[BGAV] Layout failed", error);
        this.showError();
        this.hooks.onError(error);
        return;
      }
      if (token !== this.layoutToken) return;
      this.applyLayout(layout, anchorId);
    } else {
      // Same structure: refresh node contents in place.
      const layout = this.layout;
      const fresh = new Map(view.nodes.map((n) => [n.id, n]));
      for (const placed of layout.nodes.values())
        placed.node = fresh.get(placed.node.id) ?? placed.node;
      this.renderNodes(layout);
      this.renderBack(layout);
      if (!this.minimap.el.hidden) this.minimap.draw(this.transform, this.viewSize());
    }
    this.updateMatches();
    this.renderChips();
    this.applyHighlights();
  }

  private applyLayout(layout: Layout, anchorId?: string): void {
    const previous = this.layout;
    const before = anchorId && previous ? boxOf(previous, anchorId) : undefined;
    this.layout = layout;

    const animate = previous !== undefined && anchorId !== undefined;
    if (animate) this.world.classList.add("animate");

    this.world.style.width = `${layout.width}px`;
    this.world.style.height = `${layout.height}px`;
    this.edgeLayer.setAttribute("width", String(layout.width));
    this.edgeLayer.setAttribute("height", String(layout.height));
    this.renderBack(layout);
    this.renderEdges(layout);
    this.renderNodes(layout);
    this.minimap.setLayout(layout);

    if (!this.placed || !this.userMoved) {
      // Until the user moves the view, keep it fitted as matrices load and the graph grows.
      this.placed = false;
      this.placeInitially();
    } else if (before) {
      const after = boxOf(layout, anchorId ?? "");
      if (after) {
        const t = this.transform;
        this.setTransform({
          k: t.k,
          x: t.x + (before.x - after.x) * t.k,
          y: t.y + (before.y - after.y) * t.k,
        });
      }
    } else {
      this.setTransform(this.transform);
    }

    if (animate) window.setTimeout(() => this.world.classList.remove("animate"), 300);
  }

  // ---------------------------------------------------------------- rendering

  private renderBrand(): void {
    const run = this.run;
    const name = run?.workflowName ?? "Workflow";
    const title = run?.workflowHref
      ? h("a", { class: "workflow", href: run.workflowHref, title: "View workflow file" }, name)
      : h("span", { class: "workflow" }, name);
    const sig = `${name}|${run?.workflowHref ?? ""}|${run?.trigger ?? ""}`;
    if (this.brand.dataset.sig === sig) return;
    this.brand.dataset.sig = sig;
    this.brand.replaceChildren(
      title,
      run?.trigger ? h("span", { class: "trigger" }, run.trigger) : "",
    );
  }

  private allJobs(): Job[] {
    return this.view?.nodes.flatMap((n) => n.jobs) ?? [];
  }

  private renderChips(): void {
    const counts = new Map<Status, number>();
    for (const job of this.allJobs()) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
    const chips: HTMLElement[] = [];
    for (const status of CHIP_STATUSES) {
      const count = counts.get(status) ?? 0;
      if (count === 0) continue;
      const pressed = this.statusFilter === status;
      const label = STATUS_LABEL[status].toLowerCase();
      const chip = this.button({
        className: `chip s-${status}`,
        title: pressed ? `Stop highlighting ${label} jobs` : `Highlight ${label} jobs (N for next)`,
        onClick: () => this.setStatusFilter(pressed ? undefined : status),
      });
      chip.append(statusIcon(status, 14), `${count} ${label}`);
      chip.setAttribute("aria-pressed", String(pressed));
      chips.push(chip);
    }
    if (this.critical && this.view) {
      const now = Date.now();
      const path = criticalPath(this.view, now);
      const byId = new Map(this.view.nodes.map((n) => [n.id, n]));
      let total = 0;
      for (const id of path.nodes) {
        const node = byId.get(id);
        if (node) total += nodeSeconds(node, now);
      }
      chips.push(
        h(
          "span",
          { class: "chip crit", title: "Sum of the longest job in each step of the critical path" },
          icon("zap", "", 14),
          `Critical path ${formatDuration(total)}`,
        ),
      );
    }
    this.chips.replaceChildren(...chips);
  }

  private renderBack(layout: Layout): void {
    const clusters = new Map(this.view?.clusters.map((c) => [c.id, c]));
    const els: HTMLElement[] = [];
    for (const placed of layout.clusters.values()) {
      const cluster = clusters.get(placed.id);
      if (cluster) els.push(clusterElement(placed, cluster));
    }
    for (const bundle of layout.bundles.values()) els.push(bundleElement(bundle));
    this.backLayer.replaceChildren(...els);
  }

  private renderEdges(layout: Layout): void {
    this.edgeLayer.replaceChildren(...layout.edges.map(edgeElement));
  }

  private renderNodes(layout: Layout): void {
    const next = new Map<string, NodeEntry>();
    const ordered: HTMLElement[] = [];
    for (const placed of layout.nodes.values()) {
      const sig = nodeSignature(placed.node, placed);
      const existing = this.nodeEls.get(placed.node.id);
      let el: HTMLElement;
      if (existing && existing.sig === sig) {
        el = existing.el;
      } else {
        const fresh = nodeElement(placed);
        if (existing && existing.el.tagName === fresh.tagName) {
          // Keep the element so position changes animate.
          el = existing.el;
          // Copy first: removing attributes while iterating the live map skips entries.
          const stale = Array.from(el.attributes, (attr) => attr.name).filter(
            (name) => !fresh.hasAttribute(name),
          );
          for (const name of stale) el.removeAttribute(name);
          for (const attr of fresh.attributes) el.setAttribute(attr.name, attr.value);
          el.replaceChildren(...fresh.childNodes);
        } else {
          el = fresh;
        }
      }
      next.set(placed.node.id, { el, sig });
      ordered.push(el);
    }
    this.nodeEls = next;
    const current = [...this.nodeLayer.children];
    if (current.length !== ordered.length || current.some((el, i) => el !== ordered[i])) {
      this.nodeLayer.replaceChildren(...ordered);
    }
  }

  /** Classes for hover lineage, search matches, focus and the critical path. */
  private applyHighlights(): void {
    const view = this.view;
    const layout = this.layout;
    if (!view || !layout) return;

    const hovered =
      this.hoverId && layout.nodes.has(this.hoverId)
        ? lineage(this.hoverId, view.allEdges)
        : undefined;
    const filtering = this.isFiltering();
    const matchSet = new Set(this.matches);
    const crit = this.critical ? criticalPath(view, Date.now()) : undefined;

    for (const [id, { el }] of this.nodeEls) {
      const dim = hovered
        ? !hovered.has(id)
        : filtering
          ? !matchSet.has(id)
          : crit
            ? !crit.nodes.has(id)
            : false;
      el.classList.toggle("dim", dim);
      el.classList.toggle("hl", hovered !== undefined && id === this.hoverId);
      el.classList.toggle("match", !hovered && filtering && matchSet.has(id));
      el.classList.toggle("crit", !hovered && !filtering && (crit?.nodes.has(id) ?? false));
      el.classList.toggle("focus", id === this.focusId);
      if (!el.classList.contains("job")) {
        for (const pill of el.querySelectorAll<HTMLElement>(".pill[data-job]")) {
          const job = this.jobByKey(pill.dataset.job ?? "");
          pill.classList.toggle("match", filtering && job !== undefined && this.jobMatches(job));
        }
      }
    }

    const edgeInfo = new Map(layout.edges.map((e) => [`${e.from}\n${e.to}`, e]));
    for (const path of this.edgeLayer.querySelectorAll<SVGPathElement>(".edge")) {
      const info = edgeInfo.get(`${path.dataset.from ?? ""}\n${path.dataset.to ?? ""}`);
      if (!info) continue;
      const hl = hovered !== undefined && any(info.fromIds, hovered) && any(info.toIds, hovered);
      const onCrit =
        !hovered &&
        crit !== undefined &&
        info.fromIds.some((f) => info.toIds.some((t) => crit.edges.has(`${f}\n${t}`)));
      const matched = any(info.fromIds, matchSet) && any(info.toIds, matchSet);
      path.classList.toggle("hl", hl);
      path.classList.toggle("crit", onCrit);
      path.classList.toggle("dim", hovered ? !hl : filtering ? !matched : crit ? !onCrit : false);
    }
    // Draw highlighted edges last so they sit on top.
    for (const path of this.edgeLayer.querySelectorAll(".edge.hl, .edge.crit"))
      this.edgeLayer.append(path);
  }

  private jobByKey(key: string): Job | undefined {
    for (const node of this.view?.nodes ?? []) {
      const job = node.jobs.find((j) => j.key === key);
      if (job) return job;
    }
    return undefined;
  }

  private tick(): void {
    const now = Date.now();
    for (const el of this.shadow.querySelectorAll<HTMLElement>(".dur.live[data-started]")) {
      const text = formatDuration((now - Number(el.dataset.started)) / 1000);
      if (el.textContent !== text) el.textContent = text;
    }
    for (const el of this.shadow.querySelectorAll<HTMLElement>("[data-job]")) {
      const job = this.jobByKey(el.dataset.job ?? "");
      if (job?.startedAt !== undefined) el.title = jobTitle(job);
    }
  }

  // ---------------------------------------------------------------- search and filters

  private isFiltering(): boolean {
    return this.query.trim() !== "" || this.statusFilter !== undefined;
  }

  private tokens(): string[] {
    return this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  private jobMatches(job: Job): boolean {
    if (this.statusFilter && job.status !== this.statusFilter) return false;
    const tokens = this.tokens();
    if (tokens.length === 0) return true;
    const text = [...job.path, job.name, job.jobId].join(" ").toLowerCase();
    return tokens.every((t) => text.includes(t));
  }

  private nodeMatches(node: ViewNode): boolean {
    if (node.jobs.some((j) => this.jobMatches(j))) return true;
    const tokens = this.tokens();
    if (this.statusFilter || tokens.length === 0) return false;
    const text = `${node.subtitle} ${node.title}`.toLowerCase();
    return tokens.every((t) => text.includes(t));
  }

  private updateMatches(): void {
    const layout = this.layout;
    if (!this.isFiltering() || !layout || !this.view) {
      this.matches = [];
      this.matchIndex = -1;
      this.hits.textContent = "";
      return;
    }
    const previous = this.matches[this.matchIndex];
    this.matches = this.view.nodes
      .filter((n) => this.nodeMatches(n))
      .map((n) => n.id)
      .toSorted((a, b) => {
        const pa = layout.nodes.get(a);
        const pb = layout.nodes.get(b);
        return (pa?.y ?? 0) - (pb?.y ?? 0) || (pa?.x ?? 0) - (pb?.x ?? 0);
      });
    this.matchIndex = previous ? this.matches.indexOf(previous) : -1;
    this.hits.textContent =
      this.matches.length === 0
        ? "0"
        : this.matchIndex >= 0
          ? `${this.matchIndex + 1}/${this.matches.length}`
          : String(this.matches.length);
  }

  private setQuery(query: string): void {
    this.query = query;
    this.focusId = undefined;
    this.updateMatches();
    this.applyHighlights();
  }

  private setStatusFilter(status: Status | undefined): void {
    this.statusFilter = status;
    this.focusId = undefined;
    this.updateMatches();
    this.renderChips();
    this.applyHighlights();
    if (status) void this.focusMatch(1);
  }

  private clearFilters(): void {
    this.searchInput.value = "";
    this.query = "";
    this.search.classList.remove("open");
    this.setStatusFilter(undefined);
  }

  /** Moves to the next (1) or previous (-1) match, expanding a collapsed group that contains it. */
  private async focusMatch(direction: 1 | -1): Promise<void> {
    if (this.matches.length === 0) return;
    const count = this.matches.length;
    this.matchIndex =
      this.matchIndex < 0
        ? direction === 1
          ? 0
          : count - 1
        : (this.matchIndex + direction + count) % count;
    let id = this.matches[this.matchIndex];
    if (!id) return;
    const node = this.view?.nodes.find((n) => n.id === id);
    if (node?.collapsed && node.jobs.some((j) => this.jobMatches(j))) {
      // Collapsed nodes already list failed, running and waiting jobs.
      const shownWhenCollapsed =
        this.statusFilter === "failure" ||
        this.statusFilter === "running" ||
        this.statusFilter === "waiting";
      if (!shownWhenCollapsed || node.kind === "cluster") {
        this.userMoved = true;
        this.collapsed.set(id, false);
        await this.refresh(id);
        if (node.kind === "cluster") {
          id =
            this.matches.find(
              (m) => this.view?.nodes.find((n) => n.id === m)?.parent === node.id,
            ) ?? id;
          this.matchIndex = Math.max(0, this.matches.indexOf(id));
        }
      }
    }
    this.focusId = id;
    this.hits.textContent = `${this.matchIndex + 1}/${this.matches.length}`;
    this.applyHighlights();
    const box = this.layout?.nodes.get(id);
    if (box && !isVisible(this.transform, box, this.viewSize())) {
      this.setTransform(centerOn(this.transform, box, this.viewSize()), true);
    }
  }

  // ---------------------------------------------------------------- viewport

  private viewSize(): { width: number; height: number } {
    return { width: this.viewport.clientWidth, height: this.viewport.clientHeight };
  }

  private setTransform(t: Transform, animate = false): void {
    const layout = this.layout;
    this.transform = layout ? clampPan(t, layout, this.viewSize()) : t;
    const { x, y, k } = this.transform;
    if (animate) {
      this.world.style.transition = "transform 0.25s ease";
      window.setTimeout(() => {
        this.world.style.transition = "";
      }, 260);
    }
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    this.zoomLevel.textContent = `${Math.round(k * 100)}%`;
    this.updateMinimap();
  }

  private updateMinimap(): void {
    const layout = this.layout;
    if (!layout) return;
    const view = this.viewSize();
    const t = this.transform;
    const overflows =
      layout.width * t.k > view.width * 1.1 || layout.height * t.k > view.height * 1.1;
    this.minimap.el.hidden = !this.prefs.showMinimap || !overflows;
    if (!this.minimap.el.hidden) this.minimap.draw(t, view);
  }

  /** The zoom the panel opens at: the whole graph when that stays readable. */
  private initialScale(view: { width: number; height: number }): number {
    const layout = this.layout;
    if (!layout) return 1;
    const k = fitScale(layout, view);
    if (k >= READABLE_SCALE || this.fullscreen) return k;
    // Too big to fit readably: open at a comfortable zoom and let the user pan.
    return OPEN_SCALE;
  }

  /** Sizes the inline panel to the graph and picks a readable starting zoom. */
  private placeInitially(): void {
    const layout = this.layout;
    if (!layout || this.viewport.clientWidth === 0) return;
    this.placed = true;
    this.applyHeight();
    const view = this.viewSize();
    const k = this.initialScale(view);
    if (layout.width * k <= view.width && layout.height * k <= view.height) {
      this.setTransform(centered(layout, view, k));
    } else {
      this.setTransform({ k, x: (view.width - layout.width * k) / 2, y: 16 });
    }
  }

  /**
   * Tallest inline panel that still fits on screen when the page is scrolled
   * to the top, so its bottom edge and the overview map stay in view. A panel
   * placed far down the page gets a share of the window instead.
   */
  private maxInlineHeight(): number {
    const top = this.viewport.getBoundingClientRect().top + window.scrollY;
    const visible = Math.floor(window.innerHeight - top - PAGE_MARGIN);
    const share = Math.round(window.innerHeight * 0.6);
    return Math.max(MIN_INLINE_HEIGHT, visible >= MIN_INLINE_HEIGHT ? visible : share);
  }

  private applyHeight(): void {
    const layout = this.layout;
    if (this.fullscreen || !layout) return;
    if (this.prefs.height !== null) {
      this.viewport.style.height = `${Math.max(MIN_HEIGHT, this.prefs.height)}px`;
      return;
    }
    const maxHeight = this.maxInlineHeight();
    const width = this.viewport.clientWidth;
    const k = this.initialScale({ width, height: maxHeight });
    const height = Math.round(Math.min(maxHeight, Math.max(MIN_HEIGHT, layout.height * k + 48)));
    this.viewport.style.height = `${height}px`;
  }

  private onResize(): void {
    if (!this.layout) return;
    if (!this.placed || !this.userMoved) {
      this.placed = false;
      this.placeInitially();
    } else {
      this.setTransform(this.transform);
    }
  }

  private fit(animate = false): void {
    const layout = this.layout;
    if (!layout) return;
    // A fitted view stays fitted as the graph changes.
    this.userMoved = false;
    const view = this.viewSize();
    this.setTransform(centered(layout, view, fitScale(layout, view)), animate);
  }

  private zoomBy(factor: number): void {
    const view = this.viewSize();
    this.userMoved = true;
    this.setTransform(
      zoomAround(this.transform, this.transform.k * factor, view.width / 2, view.height / 2),
      true,
    );
  }

  private zoomTo(k: number): void {
    const view = this.viewSize();
    this.userMoved = true;
    this.setTransform(zoomAround(this.transform, k, view.width / 2, view.height / 2), true);
  }

  private moveCenterTo(x: number, y: number): void {
    const view = this.viewSize();
    const k = this.transform.k;
    this.userMoved = true;
    this.setTransform({ k, x: view.width / 2 - x * k, y: view.height / 2 - y * k });
  }

  private panBy(dx: number, dy: number): void {
    const t = this.transform;
    this.userMoved = true;
    this.setTransform({ ...t, x: t.x + dx, y: t.y + dy }, true);
  }

  private toggleFullscreen(): void {
    this.setFullscreen(!this.fullscreen);
  }

  private setFullscreen(on: boolean): void {
    if (this.fullscreen === on) return;
    this.fullscreen = on;
    this.panel.classList.toggle("fullscreen", on);
    document.documentElement.style.overflow = on ? "hidden" : "";
    if (!on) this.applyHeight();
    this.syncControls();
    requestAnimationFrame(() => {
      this.fit();
      this.viewport.focus({ preventScroll: true });
    });
  }

  // ---------------------------------------------------------------- events

  private bindEvents(resize: HTMLElement): void {
    this.world.addEventListener("click", (e) => {
      const target = e.target as Element;
      const toggle = target.closest<HTMLElement>("[data-toggle]");
      if (toggle?.dataset.toggle) {
        e.preventDefault();
        e.stopPropagation();
        this.toggleNode(toggle.dataset.toggle);
        return;
      }
      if (target.closest("a")) return;
      const head = target.closest(".head, .cluster-head");
      const id = head?.querySelector<HTMLElement>("[data-toggle]")?.dataset.toggle;
      if (id) this.toggleNode(id);
    });

    this.nodeLayer.addEventListener("pointerover", (e) => {
      if (this.viewport.classList.contains("panning")) return;
      const id = (e.target as Element).closest<HTMLElement>(".node")?.dataset.id;
      if (id !== this.hoverId) {
        this.hoverId = id;
        this.applyHighlights();
      }
    });
    this.nodeLayer.addEventListener("pointerleave", () => {
      if (this.hoverId === undefined) return;
      this.hoverId = undefined;
      this.applyHighlights();
    });
    this.nodeLayer.addEventListener("focusin", (e) => {
      const id = (e.target as Element).closest<HTMLElement>(".node")?.dataset.id;
      const box = id ? this.layout?.nodes.get(id) : undefined;
      if (box && !isVisible(this.transform, box, this.viewSize())) {
        this.setTransform(centerOn(this.transform, box, this.viewSize(), this.transform.k), true);
      }
    });

    let searchTimer = 0;
    this.searchInput.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => this.setQuery(this.searchInput.value), 80);
    });
    this.searchInput.addEventListener("blur", () => this.closeSearchIfEmpty());
    // Shadow DOM retargets key events to the host, so GitHub's page hotkeys
    // (such as "g u" or "t") would fire while typing here. Keep keys inside.
    for (const type of ["keydown", "keyup", "keypress"] as const) {
      this.searchInput.addEventListener(type, (e) => e.stopPropagation());
    }
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        window.clearTimeout(searchTimer);
        if (this.query !== this.searchInput.value) this.setQuery(this.searchInput.value);
        void this.focusMatch(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.clearFilters();
        this.viewport.focus({ preventScroll: true });
      }
    });

    this.menu.addEventListener("keydown", (e) => {
      const items = [...this.menu.querySelectorAll<HTMLButtonElement>("button")];
      const index = items.indexOf(e.target as HTMLButtonElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const next =
          items[(index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
        next?.focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.closeMenu();
        this.menuButton.focus();
      }
    });
    const onPointerDown = (e: PointerEvent) => {
      if (
        !this.menu.hidden &&
        !e.composedPath().some((el) => el === this.menu || el === this.menuButton)
      ) {
        this.closeMenu();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);

    this.panel.addEventListener("keydown", (e) => this.onKey(e));
    const onDocumentKey = (e: KeyboardEvent) => {
      if (this.fullscreen && e.key === "Escape" && !e.composedPath().includes(this.host))
        this.setFullscreen(false);
    };
    document.addEventListener("keydown", onDocumentKey);
    this.cleanups.push(
      () => document.removeEventListener("keydown", onDocumentKey),
      () => document.removeEventListener("pointerdown", onPointerDown, true),
    );

    // Resize handle for the inline panel.
    resize.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      resize.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startHeight = this.viewport.clientHeight;
      const move = (ev: PointerEvent) => {
        const height = Math.max(MIN_HEIGHT, Math.round(startHeight + ev.clientY - startY));
        this.viewport.style.height = `${height}px`;
      };
      const up = () => {
        resize.removeEventListener("pointermove", move);
        resize.removeEventListener("pointerup", up);
        resize.removeEventListener("pointercancel", up);
        this.setPref({ height: this.viewport.clientHeight });
      };
      resize.addEventListener("pointermove", move);
      resize.addEventListener("pointerup", up);
      resize.addEventListener("pointercancel", up);
    });
    resize.addEventListener("dblclick", () => {
      this.setPref({ height: null });
      this.placed = false;
      this.userMoved = false;
      this.placeInitially();
    });
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as Element;
    if (
      target === this.searchInput ||
      this.menu.contains(target) ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    )
      return;
    const pan = 80;
    const actions: Record<string, () => void> = {
      "/": () => this.openSearch(),
      f: () => this.toggleFullscreen(),
      F: () => this.toggleFullscreen(),
      "0": () => this.fit(true),
      "1": () => this.zoomTo(1),
      "+": () => this.zoomBy(ZOOM_STEP),
      "=": () => this.zoomBy(ZOOM_STEP),
      "-": () => this.zoomBy(1 / ZOOM_STEP),
      e: () => this.setAllCollapsed(false),
      c: () => this.setAllCollapsed(true),
      n: () => void this.focusMatch(1),
      N: () => void this.focusMatch(-1),
      ArrowLeft: () => this.panBy(pan, 0),
      ArrowRight: () => this.panBy(-pan, 0),
      ArrowUp: () => this.panBy(0, pan),
      ArrowDown: () => this.panBy(0, -pan),
      Escape: () => {
        if (this.isFiltering()) this.clearFilters();
        else if (this.fullscreen) this.setFullscreen(false);
      },
    };
    const action = actions[e.key];
    if (!action) return;
    // Arrow keys only pan when the viewport itself has focus, so links keep normal behavior.
    if (e.key.startsWith("Arrow") && target !== this.viewport) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  }

  // ---------------------------------------------------------------- small builders

  private button(options: {
    title: string;
    onClick: () => void;
    text?: string;
    icon?: OcticonName;
    className?: string;
  }): HTMLButtonElement {
    const b = h(
      "button",
      {
        type: "button",
        class: `btn ${options.className ?? ""}`.trim(),
        title: options.title,
        "aria-label": options.title,
      },
      options.icon ? icon(options.icon) : null,
      options.text ?? null,
    );
    b.addEventListener("click", options.onClick);
    return b;
  }

  private menuItem(
    name: OcticonName,
    label: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = h(
      "button",
      { type: "button", class: "item", role: "menuitem", title },
      icon(name),
      h("span", {}, label),
      h("span", { class: "check", "aria-hidden": "true" }, icon("check", "", 14)),
    );
    b.addEventListener("click", onClick);
    return b;
  }
}

function check(item: HTMLButtonElement, on: boolean): void {
  item.setAttribute("aria-checked", String(on));
}

function any(ids: string[], set: Set<string>): boolean {
  return ids.some((id) => set.has(id));
}

function boxOf(layout: Layout, id: string): Box | undefined {
  return layout.nodes.get(id) ?? layout.clusters.get(id);
}

function layoutSignature(view: ViewGraph): string {
  const nodes = view.nodes.map((n) => {
    const size = measure(n);
    return `${n.id}:${n.parent ?? ""}:${size.width}x${size.height}`;
  });
  const edges = view.edges.map((e) => `${e.from}>${e.to}`);
  return `${nodes.join("|")}#${edges.join("|")}#${view.clusters.map((c) => c.id).join("|")}`;
}

function nodeSignature(node: ViewNode, box: Box): string {
  return JSON.stringify([
    box.x,
    box.y,
    box.width,
    box.height,
    node.kind,
    node.status,
    node.title,
    node.subtitle,
    node.collapsed,
    node.matrixState,
    node.matrixSummary,
    node.cardCount,
    node.jobs.map((j) => [j.key, j.status, j.name, j.durationText, j.startedAt]),
  ]);
}
