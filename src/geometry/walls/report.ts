import { ExperimentalWall, Wall } from './types';
import { buildExperimentalWalls } from './index';
import { isCurvedWall } from './curve';

export type WallGeometryReport = {
  totalWalls: number;
  exactWallCount: number;
  invalidWallCount: number;
  selfIntersectingCount: number;
  miterOutlierCount: number;
  curveCount: number;
  byLevel: Record<string, Omit<WallGeometryReport, 'byLevel'>>;
};

const summary = (walls: ExperimentalWall[], sourceWalls: Wall[]): Omit<WallGeometryReport, 'byLevel'> => ({
  totalWalls: walls.length,
  exactWallCount: walls.filter((wall) => wall.validation.valid).length,
  invalidWallCount: walls.filter((wall) => !wall.validation.valid).length,
  selfIntersectingCount: walls.filter((wall) => wall.validation.codes.includes('wall_self_intersection')).length,
  miterOutlierCount: walls.filter((wall) => wall.validation.codes.includes('wall_miter_outlier')).length,
  curveCount: sourceWalls.filter(isCurvedWall).length,
});

/**
 * Generates the acceptance statistics without relying on project-specific IDs.
 * Callers supply already-separated Pascal level walls, so parent traversal stays
 * outside the geometry kernel.
 */
export function buildWallGeometryReport(wallsByLevel: Record<string, Wall[]>): WallGeometryReport {
  const groups = Object.entries(wallsByLevel).map(([levelId, walls]) => [levelId, summary(buildExperimentalWalls(walls), walls)] as const);
  const byLevel = Object.fromEntries(groups);
  return {
    totalWalls: groups.reduce((total, [, group]) => total + group.totalWalls, 0),
    exactWallCount: groups.reduce((total, [, group]) => total + group.exactWallCount, 0),
    invalidWallCount: groups.reduce((total, [, group]) => total + group.invalidWallCount, 0),
    selfIntersectingCount: groups.reduce((total, [, group]) => total + group.selfIntersectingCount, 0),
    miterOutlierCount: groups.reduce((total, [, group]) => total + group.miterOutlierCount, 0),
    curveCount: groups.reduce((total, [, group]) => total + group.curveCount, 0),
    byLevel,
  };
}
