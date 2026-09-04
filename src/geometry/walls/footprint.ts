import {Point2,Wall,WallMiterData} from './types';
import {getWallSurfacePolygon,isCurvedWall} from './curve';
import {getWallMiterBoundaryPoints,pointToKey} from './miter';
import {resolveWallThickness} from './thickness';
/** Pascal wall-footprint.ts: getWallPlanFootprint, including end left/right swap. */
export function getWallPlanFootprint(w:Wall,data:WallMiterData):Point2[]{const a={x:w.start[0],y:w.start[1]},b={x:w.end[0],y:w.end[1]},dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);if(l<1e-9)return[];if(isCurvedWall(w)){const p=getWallMiterBoundaryPoints(w,data);return getWallSurfacePolygon(w,24,p)}const h=resolveWallThickness(w).resolvedPhysicalThickness/2,n={x:-dy/l,y:dx/l},sj=data.junctionData.get(pointToKey(a))?.get(w.id),ej=data.junctionData.get(pointToKey(b))?.get(w.id),sl=sj?.left??{x:a.x+n.x*h,y:a.y+n.y*h},sr=sj?.right??{x:a.x-n.x*h,y:a.y-n.y*h},el=ej?.right??{x:b.x+n.x*h,y:b.y+n.y*h},er=ej?.left??{x:b.x-n.x*h,y:b.y-n.y*h},polygon=[sr,er];if(ej)polygon.push(b);polygon.push(el,sl);if(sj)polygon.push(a);return polygon}
