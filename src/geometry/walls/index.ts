import {Wall,ExperimentalWall} from './types';
import {calculateLevelMiters} from './miter';
import {getWallPlanFootprint} from './footprint';
import {validateWallFootprint} from './validation';
import {resolveWallThickness} from './thickness';
export * from './types';export * from './thickness';export * from './curve';export * from './miter';export * from './footprint';export * from './validation';
export function buildExperimentalWalls(walls:Wall[]):ExperimentalWall[]{const miters=calculateLevelMiters(walls);return walls.map(w=>{const footprint=getWallPlanFootprint(w,miters);return{wallId:w.id,footprint,validation:validateWallFootprint(w,footprint),thickness:resolveWallThickness(w)}})}
export * from './report';
