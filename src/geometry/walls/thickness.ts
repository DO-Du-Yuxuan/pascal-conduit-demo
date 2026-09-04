import {Wall,ThicknessInfo} from './types';

/** Pascal wall-footprint.ts: DEFAULT_WALL_THICKNESS / getWallThickness. */
export const DEFAULT_WALL_THICKNESS=.1;
export function resolveWallThickness(wall:Wall):ThicknessInfo{return wall.thickness===undefined?{rawThickness:null,resolvedPhysicalThickness:DEFAULT_WALL_THICKNESS,thicknessSource:'pascal-default'}:{rawThickness:wall.thickness,resolvedPhysicalThickness:wall.thickness,thicknessSource:'explicit'}}
