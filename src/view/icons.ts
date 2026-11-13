import { s } from "../lib/dom";
import type { Status } from "../model/types";
import { OCTICONS, type OcticonName } from "./octicons";

export function icon(name: OcticonName, className = "", size = 16): SVGSVGElement {
  return s(
    "svg",
    {
      class: `octicon ${className}`.trim(),
      viewBox: "0 0 16 16",
      width: size,
      height: size,
      "aria-hidden": "true",
      fill: "currentColor",
    },
    ...OCTICONS[name].map((d) => s("path", { d })),
  );
}

const STATUS_ICON: Record<Exclude<Status, "running">, OcticonName> = {
  success: "check-circle-fill",
  failure: "x-circle-fill",
  cancelled: "stop",
  skipped: "skip",
  queued: "clock",
  waiting: "hourglass",
  pending: "circle",
  neutral: "circle",
  unknown: "circle",
};

/** Status icon in GitHub's style. Running uses GitHub's rotating ring. */
export function statusIcon(status: Status, size = 16): SVGSVGElement {
  if (status === "running") {
    return s(
      "svg",
      {
        class: "status-icon s-running spin",
        viewBox: "0 0 16 16",
        width: size,
        height: size,
        "aria-hidden": "true",
        fill: "none",
      },
      s("path", {
        stroke: "currentColor",
        "stroke-width": 2,
        opacity: 0.5,
        d: "M3.05 3.05a7 7 0 1 1 9.9 9.9 7 7 0 0 1-9.9-9.9Z",
      }),
      s("path", {
        fill: "currentColor",
        "fill-rule": "evenodd",
        d: "M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
      }),
      s("path", { fill: "currentColor", d: "M14 8a6 6 0 0 0-6-6V0a8 8 0 0 1 8 8h-2Z" }),
    );
  }
  return icon(STATUS_ICON[status], `status-icon s-${status}`, size);
}
