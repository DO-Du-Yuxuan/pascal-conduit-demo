export type ReachableAreaRect = {
  x: number;
  z: number;
  width: number;
  height: number;
};

type GridRun = { start: number; end: number; row: number };

/**
 * Turns room-local grid-cell centers into a small set of display rectangles.
 * The calculation stays anchored to the supplied grid instead of re-rounding
 * world coordinates against the global origin.
 */
export function buildReachableAreaRects(points: Array<[number, number]>, step: number): ReachableAreaRect[] {
  if (!points.length || !Number.isFinite(step) || step <= 0) return [];

  const originX = Math.min(...points.map(([x]) => x));
  const originZ = Math.min(...points.map(([, z]) => z));
  const rows = new Map<number, number[]>();

  for (const [x, z] of points) {
    const row = Math.round((z - originZ) / step);
    const column = Math.round((x - originX) / step);
    rows.set(row, [...(rows.get(row) ?? []), column]);
  }

  const runs: GridRun[] = [];
  for (const [row, columns] of [...rows.entries()].sort(([a], [b]) => a - b)) {
    const sorted = [...new Set(columns)].sort((a, b) => a - b);
    let start = sorted[0];
    let end = sorted[0];
    for (const column of sorted.slice(1)) {
      if (column === end! + 1) end = column;
      else {
        runs.push({ row, start: start!, end: end! });
        start = end = column;
      }
    }
    if (start !== undefined && end !== undefined) runs.push({ row, start, end });
  }

  const active = new Map<string, { start: number; end: number; firstRow: number; lastRow: number }>();
  const rectangles: ReachableAreaRect[] = [];
  const flush = (entry: { start: number; end: number; firstRow: number; lastRow: number }) => {
    rectangles.push({
      x: originX + entry.start * step - step / 2,
      z: originZ + entry.firstRow * step - step / 2,
      width: (entry.end - entry.start + 1) * step,
      height: (entry.lastRow - entry.firstRow + 1) * step,
    });
  };

  const runsByRow = new Map<number, GridRun[]>();
  for (const run of runs) runsByRow.set(run.row, [...(runsByRow.get(run.row) ?? []), run]);
  const minRow = Math.min(...runs.map((run) => run.row));
  const maxRow = Math.max(...runs.map((run) => run.row));

  for (let row = minRow; row <= maxRow; row += 1) {
    const currentKeys = new Set<string>();
    for (const run of runsByRow.get(row) ?? []) {
      const runKey = `${run.start}:${run.end}`;
      currentKeys.add(runKey);
      const existing = active.get(runKey);
      if (existing) existing.lastRow = row;
      else active.set(runKey, { start: run.start, end: run.end, firstRow: row, lastRow: row });
    }
    for (const [runKey, entry] of [...active]) {
      if (!currentKeys.has(runKey)) {
        flush(entry);
        active.delete(runKey);
      }
    }
  }
  for (const entry of active.values()) flush(entry);

  return rectangles;
}
