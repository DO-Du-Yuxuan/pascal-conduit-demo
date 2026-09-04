/** Keeps rear building meshes from overwriting the visible host candidate. */
export function isFrontmostSurfaceEvent(event: { object: unknown; intersections?: Array<{ object: unknown }> }): boolean {
  const nearest = event.intersections?.[0]?.object;
  return nearest === undefined || nearest === event.object;
}
