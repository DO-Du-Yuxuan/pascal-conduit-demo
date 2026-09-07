import { buildAlignedDimensionDisplay, dimensionDisplayGeometry, INNER_CHAIN_OFFSET_M, OVERALL_CHAIN_OFFSET_M, type ExteriorDimensionReport } from '../geometry/exterior-dimensions';
import { formatMeasurement, type MeasurementUnit } from '../geometry/manual-measurement';
import { overlaps, rotatePoint, textWidth, type Rect } from './layout';
import type { Point } from './model';
/** Only presentation changes: every original DimensionSegment and value is retained. */
export function exteriorGraphics(report: ExteriorDimensionReport, unit: MeasurementUnit, scale: number, rotation: number) {
  const occupied: Rect[]=[];
  return buildAlignedDimensionDisplay(report).map(dimension=>{
    const display=dimensionDisplayGeometry(report,dimension),offset=dimension.dimensionLayer==='inner-chain'?INNER_CHAIN_OFFSET_M:OVERALL_CHAIN_OFFSET_M;
    const start:Point=[display.faceStart[0]+dimension.outwardNormal[0]*offset,display.faceStart[1]+dimension.outwardNormal[1]*offset],end:Point=[display.faceEnd[0]+dimension.outwardNormal[0]*offset,display.faceEnd[1]+dimension.outwardNormal[1]*offset];
    const midpoint:Point=[(start[0]+end[0])/2,(start[1]+end[1])/2], value=formatMeasurement(dimension.valueMeters,unit),width=textWidth(value);
    const center=rotatePoint(midpoint,rotation,scale),normal=rotatePoint(dimension.outwardNormal,rotation);
    let step=0,box:Rect;
    do { const distance=14+step++*24;box={x:center[0]+normal[0]*distance-width/2,y:center[1]+normal[1]*distance-10,width,height:20}; } while(occupied.some(o=>overlaps(box,o)) && step<=occupied.length+1);
    occupied.push(box);
    const label=rotatePoint([(box.x+width/2)/scale,(box.y+10)/scale],-rotation);
    return {dimension,display,start,end,midpoint,label,box,value};
  });
}
