import type { RouteFitting, RouteSegment, Vec3 } from "./overlay";

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Lightweight socket barrels for a tee; no boolean geometry is required. */
export function teeSocketSegments(fitting: RouteFitting): RouteSegment[] {
  if (fitting.fitting !== "tee") return [];
  const center = fitting.position.position, fallbackLength = Math.max(.05, fitting.diameterMm / 1000);
  return fitting.ports.slice(0, 3).map((port, index) => {
    const end: Vec3 = distance(center, port.position.position) > 1e-5
      ? [...port.position.position]
      : [center[0] + port.direction[0] * fallbackLength, center[1] + port.direction[1] * fallbackLength, center[2] + port.direction[2] * fallbackLength];
    return { id: `${fitting.id}:socket:${index}`, type: fitting.type === "sprinkler-fitting" ? "sprinkler-segment" : "conduit-segment", system: fitting.system, diameterMm: fitting.diameterMm * 1.16, start: { position: [...center] }, end: { position: end }, createdAt: "" };
  });
}
