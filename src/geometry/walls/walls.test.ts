import { describe, expect, it } from 'vitest';
import referenceProject from '../../../sample-data/Bellevue demo.json';
import { resolveAncestorLevelId } from '../transform';
import {
  buildExperimentalWalls,
  buildWallGeometryReport,
  calculateLevelMiters,
  getWallCurveFrameAt,
  getWallPlanFootprint,
  resolveWallThickness,
  Wall,
} from '.';

const wall = (id: string, start: [number, number], end: [number, number], extras: Partial<Wall> = {}): Wall => ({
  id,
  type: 'wall',
  start,
  end,
  ...extras,
});

const polygonArea = (points: Array<{ x: number; y: number }>) => Math.abs(points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length];
  return sum + point.x * next.y - point.y * next.x;
}, 0) / 2);

describe('experimental Pascal wall geometry', () => {
  it('uses the Pascal 0.1 m default only when thickness is omitted', () => {
    expect(resolveWallThickness(wall('default', [0, 0], [2, 0]))).toMatchObject({
      rawThickness: null,
      resolvedPhysicalThickness: 0.1,
      thicknessSource: 'pascal-default',
    });
    expect(resolveWallThickness(wall('explicit', [0, 0], [2, 0], { thickness: 0.28 }))).toMatchObject({
      rawThickness: 0.28,
      resolvedPhysicalThickness: 0.28,
      thicknessSource: 'explicit',
    });
  });

  it('creates physical straight footprints for horizontal, vertical, diagonal, and reversed walls', () => {
    const horizontal = getWallPlanFootprint(wall('horizontal', [0, 0], [4, 0], { thickness: 0.2 }), calculateLevelMiters([]));
    const vertical = getWallPlanFootprint(wall('vertical', [0, 0], [0, 4], { thickness: 0.2 }), calculateLevelMiters([]));
    const diagonal = getWallPlanFootprint(wall('diagonal', [0, 0], [3, 4], { thickness: 0.2 }), calculateLevelMiters([]));
    const reversed = getWallPlanFootprint(wall('reversed', [4, 0], [0, 0], { thickness: 0.2 }), calculateLevelMiters([]));
    expect(polygonArea(horizontal)).toBeCloseTo(0.8);
    expect(polygonArea(vertical)).toBeCloseTo(0.8);
    expect(polygonArea(diagonal)).toBeCloseTo(1);
    expect(polygonArea(reversed)).toBeCloseTo(polygonArea(horizontal));
    expect(horizontal.map((point) => point.y)).toEqual([-.1, -.1, .1, .1]);
  });

  it('calculates bounded joins for L, reverse-L, T, cross, and near-parallel configurations', () => {
    const configurations: Wall[][] = [
      [wall('a', [0, 0], [2, 0], { thickness: .2 }), wall('b', [2, 0], [2, 2], { thickness: .2 })],
      [wall('a', [0, 0], [2, 0], { thickness: .2 }), wall('b', [2, 0], [2, -2], { thickness: .2 })],
      [wall('a', [-2, 0], [2, 0], { thickness: .2 }), wall('b', [0, 0], [0, 2], { thickness: .2 })],
      [wall('a', [-2, 0], [2, 0], { thickness: .2 }), wall('b', [0, -2], [0, 2], { thickness: .2 })],
      [wall('a', [0, 0], [4, 0], { thickness: .2 }), wall('b', [4, 0], [8, .001], { thickness: .2 })],
    ];
    for (const walls of configurations) {
      const result = buildExperimentalWalls(walls);
      expect(result.every((entry) => entry.validation.valid)).toBe(true);
      expect(result.every((entry) => !entry.validation.codes.includes('wall_miter_outlier'))).toBe(true);
    }
  });

  it('builds positive and negative curved surfaces with stable endpoint frames', () => {
    for (const curveOffset of [.5, -.5]) {
      const curved = wall(`curve-${curveOffset}`, [0, 0], [4, 0], { thickness: .2, curveOffset });
      const footprint = getWallPlanFootprint(curved, calculateLevelMiters([curved]));
      const start = getWallCurveFrameAt(curved, 0);
      const end = getWallCurveFrameAt(curved, 1);
      expect(footprint).toHaveLength(50);
      expect(polygonArea(footprint)).toBeGreaterThan(.7);
      expect(start.point.x).toBeCloseTo(0);
      expect(end.point.x).toBeCloseTo(4);
      expect(buildExperimentalWalls([curved])[0].validation.valid).toBe(true);
    }
  });

  it('reports zero-length walls explicitly instead of producing a fallback shape', () => {
    const result = buildExperimentalWalls([wall('zero', [1, 1], [1, 1])])[0];
    expect(result.footprint).toEqual([]);
    expect(result.validation).toMatchObject({ valid: false, codes: ['wall_zero_length'] });
  });

  it('keeps non-wall project data byte-for-byte unchanged while generating a generic per-level reference report', () => {
    const nodes: Record<string, any> = referenceProject.nodes;
    const before = JSON.stringify(nodes);
    const wallsByLevel: Record<string, Wall[]> = {};
    for (const node of Object.values(nodes)) {
      if (node.type !== 'wall') continue;
      const levelId = resolveAncestorLevelId(node.id, nodes).levelId;
      if (!levelId) continue;
      (wallsByLevel[levelId] ??= []).push(node as Wall);
    }
    const report = buildWallGeometryReport(wallsByLevel);
    const sourceWalls = Object.values(nodes).filter((node) => node.type === "wall"), sourceZeroLengthWalls = sourceWalls.filter((node) => Array.isArray(node.start) && Array.isArray(node.end) && node.start[0] === node.end[0] && node.start[1] === node.end[1]);
    expect(report.totalWalls).toBe(sourceWalls.length);
    expect(report.invalidWallCount).toBeGreaterThanOrEqual(sourceZeroLengthWalls.length);
    expect(report.exactWallCount + report.invalidWallCount).toBe(report.totalWalls);
    expect(report.selfIntersectingCount).toBe(0);
    expect(report.miterOutlierCount).toBe(0);
    expect(Object.keys(report.byLevel).length).toBeGreaterThan(0);
    expect(JSON.stringify(nodes)).toBe(before);
  });
});
