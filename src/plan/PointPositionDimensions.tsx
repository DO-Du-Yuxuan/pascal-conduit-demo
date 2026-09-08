import React from 'react';
import { formatMeasurement, type MeasurementUnit } from '../geometry/manual-measurement';
import { uprightDimensionAngle } from '../geometry/exterior-dimensions';
import type { PointPositionDimension } from './model';
import { layoutPointDimensionLabels } from './collision-layout';

export function PointPositionDimensions({dimensions,unit,viewRotation,annotationScale,onSelect}:{dimensions:PointPositionDimension[];unit:MeasurementUnit;viewRotation:number;annotationScale:number;onSelect:(id:string)=>void}){
  const overshoot=.06*annotationScale,tick=.055*annotationScale,layouts=layoutPointDimensionLabels(dimensions,unit,annotationScale);
  return <g className="point-position-dimensions" aria-label="点位定位尺寸">{layouts.map(({dimension:d,offset,start,end,label:mid,lane})=>{const extension=(point:[number,number]):[number,number]=>[point[0]+d.normal[0]*(offset+overshoot),point[1]+d.normal[1]*(offset+overshoot)],tickVector:[number,number]=[(d.direction[0]+d.normal[0])*tick,(d.direction[1]+d.normal[1])*tick],angle=uprightDimensionAngle(d.direction,viewRotation),text=formatMeasurement(d.valueMeters,unit)+(unit==='millimeters'?' mm':'');return <g key={d.id} data-point-position-dimension={d.sourceId} data-dimension-lane={lane} onClick={event=>{event.stopPropagation();onSelect(d.sourceId);}} style={{cursor:'pointer'}}>
    <line x1={d.referenceWitness[0]} y1={d.referenceWitness[1]} x2={extension(d.reference)[0]} y2={extension(d.reference)[1]} stroke="#626262" strokeWidth="1" vectorEffect="non-scaling-stroke"/><line x1={d.centerWitness[0]} y1={d.centerWitness[1]} x2={extension(d.center)[0]} y2={extension(d.center)[1]} stroke="#626262" strokeWidth="1" vectorEffect="non-scaling-stroke"/><line x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} stroke="#626262" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
    {[start,end].map((point,index)=><line key={index} x1={point[0]-tickVector[0]} y1={point[1]-tickVector[1]} x2={point[0]+tickVector[0]} y2={point[1]+tickVector[1]} stroke="#626262" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}
    <text x={mid[0]} y={mid[1]} transform={`rotate(${angle} ${mid[0]} ${mid[1]})`} textAnchor="middle" dominantBaseline="middle" fontFamily="DM Mono, monospace" fontSize={.18*annotationScale} fill="#404040" stroke="#fdfdfc" strokeWidth=".07" paintOrder="stroke"><title>{`点位中心定位尺寸；${d.referenceKind==='opening-edge'?'洞口边':d.referenceKind==='wall-face'?'模型墙面':d.referenceKind==='device-center'?'同类点位中心':'墙端'}至设备中心；来源 ${d.relatedIds.join(', ')}`}</title>{text}</text>
  </g>;})}</g>;
}
