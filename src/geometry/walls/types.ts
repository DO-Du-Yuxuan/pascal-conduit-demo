import {NodeData} from '../../types';

export type Point2={x:number;y:number};
export type Wall=NodeData & {start:number[];end:number[]};
export type ThicknessInfo={rawThickness:number|null;resolvedPhysicalThickness:number;thicknessSource:'explicit'|'pascal-default'};
export type Line={a:number;b:number;c:number};
export type WallIntersection={left?:Point2;right?:Point2};
export type WallMiterData={junctionData:Map<string,Map<string,WallIntersection>>;junctions:Map<string,{meetingPoint:Point2;connectedWalls:Array<{wall:Wall;endType:'start'|'end'|'passthrough'}>}>};
export type WallValidation={valid:boolean;codes:string[];area:number;maxVertexDistance:number};
export type ExperimentalWall={wallId:string;footprint:Point2[];validation:WallValidation;thickness:ThicknessInfo};
