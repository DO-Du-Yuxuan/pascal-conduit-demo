import { formatMeasurement, type MeasurementUnit } from '../geometry/manual-measurement';
import type { Point, PointPositionDimension } from './model';

export type CollisionBox={minX:number;minY:number;maxX:number;maxY:number};
export type PositionedDimension={dimension:PointPositionDimension;lane:number;offset:number;start:Point;end:Point;mid:Point;label:Point;box:CollisionBox};
const overlaps=(a:CollisionBox,b:CollisionBox)=>a.minX<b.maxX&&a.maxX>b.minX&&a.minY<b.maxY&&a.maxY>b.minY;

export function layoutPointDimensionLabels(dimensions:PointPositionDimension[],unit:MeasurementUnit,annotationScale:number):PositionedDimension[]{
  const placed:PositionedDimension[]=[];
  for(const dimension of dimensions){
    const value=formatMeasurement(dimension.valueMeters,unit)+(unit==='millimeters'?' mm':''),vertical=Math.abs(dimension.direction[1])>Math.abs(dimension.direction[0]),width=(vertical?.22:Math.max(.55,value.length*.105))*annotationScale,height=(vertical?Math.max(.55,value.length*.105):.22)*annotationScale;
    let candidate:PositionedDimension|null=null;
    for(let extraLane=0;extraLane<8;extraLane++){
      const lane=dimension.lane+extraLane,offset=(.28+lane*.22)*annotationScale,start:Point=[dimension.reference[0]+dimension.normal[0]*offset,dimension.reference[1]+dimension.normal[1]*offset],end:Point=[dimension.center[0]+dimension.normal[0]*offset,dimension.center[1]+dimension.normal[1]*offset],mid:Point=[(start[0]+end[0])/2,(start[1]+end[1])/2],label:Point=[mid[0],mid[1]],box={minX:label[0]-width/2,minY:label[1]-height/2,maxX:label[0]+width/2,maxY:label[1]+height/2};
      candidate={dimension,lane,offset,start,end,mid,label,box};
      if(!placed.some(item=>overlaps(item.box,box)))break;
    }
    placed.push(candidate!);
  }
  return placed;
}

export function chooseVariantMarkerOffset(preferred:Point,obstacles:CollisionBox[],size:number):Point{
  const candidates:Point[]=[preferred,[-preferred[0],preferred[1]],[preferred[0],-preferred[1]],[-preferred[0],-preferred[1]],[0,-Math.abs(preferred[1])*1.35],[Math.abs(preferred[0])*1.35,0],[0,Math.abs(preferred[1])*1.35],[-Math.abs(preferred[0])*1.35,0]];
  return candidates.find(([x,y])=>{const box={minX:x-size*.55,minY:y-size*.55,maxX:x+size*.55,maxY:y+size*.55};return !obstacles.some(obstacle=>overlaps(box,obstacle));})??candidates[candidates.length-1]!;
}
