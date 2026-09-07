import React from 'react';
import { buildAlignedDimensionDisplay, dimensionDisplayGeometry, EXTENSION_OVERSHOOT_M, INNER_CHAIN_OFFSET_M, OVERALL_CHAIN_OFFSET_M, uprightDimensionAngle, type DimensionSegment, type ExteriorDimensionReport } from '../geometry/exterior-dimensions';
import { formatMeasurement, type MeasurementUnit } from '../geometry/manual-measurement';

export function ExteriorDimensions({report,viewRotation,unit,onSelect}: {report:ExteriorDimensionReport;viewRotation:number;unit:MeasurementUnit;onSelect:(d:DimensionSegment)=>void}) {
  const color='#626262';
  return <g className="exterior-dimensions">{buildAlignedDimensionDisplay(report).map(dimension=>{
    const value=formatMeasurement(dimension.valueMeters,unit),display=dimensionDisplayGeometry(report,dimension),offset=dimension.dimensionLayer==='inner-chain'?INNER_CHAIN_OFFSET_M:OVERALL_CHAIN_OFFSET_M,
      start:[number,number]=[display.faceStart[0]+dimension.outwardNormal[0]*offset,display.faceStart[1]+dimension.outwardNormal[1]*offset],end:[number,number]=[display.faceEnd[0]+dimension.outwardNormal[0]*offset,display.faceEnd[1]+dimension.outwardNormal[1]*offset],
      midpoint:[number,number]=[(start[0]+end[0])/2,(start[1]+end[1])/2],textWidth=Math.max(.24,value.length*.105),fits=dimension.valueMeters>textWidth+.16,
      label:[number,number]=fits?midpoint:[end[0]+dimension.direction[0]*(textWidth/2+.14),end[1]+dimension.direction[1]*(textWidth/2+.14)],gap=Math.min(textWidth/2+.05,dimension.valueMeters*.4),
      before:[number,number]=[midpoint[0]-dimension.direction[0]*gap,midpoint[1]-dimension.direction[1]*gap],after:[number,number]=[midpoint[0]+dimension.direction[0]*gap,midpoint[1]+dimension.direction[1]*gap],
      extensionStart:[number,number]=[start[0]+dimension.outwardNormal[0]*EXTENSION_OVERSHOOT_M,start[1]+dimension.outwardNormal[1]*EXTENSION_OVERSHOOT_M],extensionEnd:[number,number]=[end[0]+dimension.outwardNormal[0]*EXTENSION_OVERSHOOT_M,end[1]+dimension.outwardNormal[1]*EXTENSION_OVERSHOOT_M],
      tick:[number,number]=[(dimension.direction[0]+dimension.outwardNormal[0])*.065,(dimension.direction[1]+dimension.outwardNormal[1])*.065],angle=uprightDimensionAngle(dimension.direction,viewRotation);
    return <g data-selectable key={dimension.id} onClick={()=>onSelect(dimension)} style={{cursor:'pointer'}}>
      <line x1={display.edgeStart[0]} y1={display.edgeStart[1]} x2={extensionStart[0]} y2={extensionStart[1]} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/><line x1={display.edgeEnd[0]} y1={display.edgeEnd[1]} x2={extensionEnd[0]} y2={extensionEnd[1]} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/>
      {fits?<><line x1={start[0]} y1={start[1]} x2={before[0]} y2={before[1]} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/><line x1={after[0]} y1={after[1]} x2={end[0]} y2={end[1]} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/></>:<line x1={start[0]} y1={start[1]} x2={label[0]+dimension.direction[0]*textWidth/2} y2={label[1]+dimension.direction[1]*textWidth/2} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/>}
      {[start,end].map((point,index)=><line key={index} x1={point[0]-tick[0]} y1={point[1]-tick[1]} x2={point[0]+tick[0]} y2={point[1]+tick[1]} stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke"/>)}
      <text x={label[0]} y={label[1]} transform={`rotate(${angle} ${label[0]} ${label[1]})`} textAnchor="middle" dominantBaseline="middle" fontFamily="DM Mono, monospace" fontSize=".18" fill={color} stroke="#fdfdfc" strokeWidth=".04" paintOrder="stroke"><title>{`外围尺寸；来源墙体 ${dimension.sourceWallIds.join(', ')}；${dimension.method}`}</title>{value}</text>
    </g>;
  })}</g>;
}
