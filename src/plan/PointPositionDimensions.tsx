import React from 'react';
import { formatMeasurement, type MeasurementUnit } from '../geometry/manual-measurement';
import { uprightDimensionAngle } from '../geometry/exterior-dimensions';
import type { Point, PointPositionDimension } from './model';

type DimensionPosition = { label: number; lineOffset: number };
const dot = (left: Point, right: Point) => left[0] * right[0] + left[1] * right[1];
const POINT_DIMENSION_SNAP_ENTER_METERS = .05;
const POINT_DIMENSION_SNAP_EXIT_METERS = .07;
const lineDirection = (dimension: PointPositionDimension): Point => {
  const x = dimension.center[0] - dimension.reference[0], y = dimension.center[1] - dimension.reference[1], length = Math.hypot(x, y);
  return length > .000001 ? [x / length, y / length] : dimension.direction;
};

export function PointPositionDimensions({dimensions,unit,viewRotation,annotationScale,onSelect,labelPositions={},lineOffsets={},onPositionChange,onLabelPositionChange,toPlanPoint}:{dimensions:PointPositionDimension[];unit:MeasurementUnit;viewRotation:number;annotationScale:number;onSelect:(id:string)=>void;labelPositions?:Readonly<Record<string,number>>;lineOffsets?:Readonly<Record<string,number>>;onPositionChange?:(id:string,labelPosition:number,lineOffset:number)=>void;onLabelPositionChange?:(id:string,position:number)=>void;toPlanPoint?:(clientX:number,clientY:number)=>Point|null}){
  const baseOffset=.28*annotationScale,overshoot=.06*annotationScale,tick=.055*annotationScale;
  const [draftPositions,setDraftPositions]=React.useState<Record<string,DimensionPosition>>({});
  const dragRef=React.useRef<{id:string;pointerId:number;start:Point;origin:DimensionPosition;position:DimensionPosition;mode:'label'|'line'|null;snapTargetId?:string}|null>(null);
  const [activeSnap,setActiveSnap]=React.useState<{sourceId:string;targetId:string}|null>(null);
  const automaticOffset=(dimension:PointPositionDimension)=>baseOffset+dimension.lane*.18*annotationScale;
  const resolvedPosition=(dimension:PointPositionDimension):DimensionPosition=>draftPositions[dimension.id]??{label:labelPositions[dimension.id]??.5,lineOffset:lineOffsets[dimension.id]??automaticOffset(dimension)};
  const snapLineOffset=(dimension:PointPositionDimension, offset:number):{offset:number;targetId?:string}=>{
    const coordinate=dot(dimension.reference,dimension.normal)+offset;
    const candidates=dimensions.filter(other=>other.id!==dimension.id&&Math.abs(dot(lineDirection(dimension),lineDirection(other)))>.99).map(other=>{
      const otherPosition=resolvedPosition(other), point:Point=[other.reference[0]+other.normal[0]*otherPosition.lineOffset,other.reference[1]+other.normal[1]*otherPosition.lineOffset];
      return {id:other.id,coordinate:dot(point,dimension.normal)};
    });
    const locked=dragRef.current?.snapTargetId?candidates.find(candidate=>candidate.id===dragRef.current?.snapTargetId):undefined;
    const target=locked&&Math.abs(locked.coordinate-coordinate)<=POINT_DIMENSION_SNAP_EXIT_METERS?locked:candidates.filter(candidate=>Math.abs(candidate.coordinate-coordinate)<=POINT_DIMENSION_SNAP_ENTER_METERS).sort((left,right)=>Math.abs(left.coordinate-coordinate)-Math.abs(right.coordinate-coordinate))[0];
    return target?{offset:target.coordinate-dot(dimension.reference,dimension.normal),targetId:target.id}:{offset};
  };
  return <g className="point-position-dimensions" aria-label="点位定位尺寸">{dimensions.map(d=>{
    const position=resolvedPosition(d),offset=position.lineOffset,start:[number,number]=[d.reference[0]+d.normal[0]*offset,d.reference[1]+d.normal[1]*offset],end:[number,number]=[d.center[0]+d.normal[0]*offset,d.center[1]+d.normal[1]*offset],axis=lineDirection(d),length=Math.max(.000001,Math.hypot(end[0]-start[0],end[1]-start[1])),labelPoint:[number,number]=[start[0]+(end[0]-start[0])*position.label,start[1]+(end[1]-start[1])*position.label],extension=(point:Point):Point=>[point[0]+d.normal[0]*(offset+overshoot),point[1]+d.normal[1]*(offset+overshoot)],tickVector:[number,number]=[(axis[0]+d.normal[0])*tick,(axis[1]+d.normal[1])*tick],angle=uprightDimensionAngle(axis,viewRotation),label=formatMeasurement(d.valueMeters,unit)+(unit==='millimeters'?' mm':''),isSnapped=activeSnap?.sourceId===d.id||activeSnap?.targetId===d.id;
    const finish=(event:React.PointerEvent,save:boolean)=>{const drag=dragRef.current;if(!drag||drag.id!==d.id||drag.pointerId!==event.pointerId)return;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);dragRef.current=null;setActiveSnap(null);const next=drag.position;if(save){onPositionChange?.(d.id,next.label,next.lineOffset);onLabelPositionChange?.(d.id,next.label);}setDraftPositions(current=>{const {[d.id]:_,...rest}=current;return rest;});};
    return <g key={d.id} data-point-position-dimension={d.sourceId} onClick={event=>{event.stopPropagation();onSelect(d.sourceId);}} style={{cursor:'pointer'}}>
      <line x1={d.referenceWitness[0]} y1={d.referenceWitness[1]} x2={extension(d.reference)[0]} y2={extension(d.reference)[1]} stroke="#626262" strokeWidth="1" vectorEffect="non-scaling-stroke"/><line x1={d.centerWitness[0]} y1={d.centerWitness[1]} x2={extension(d.center)[0]} y2={extension(d.center)[1]} stroke="#626262" strokeWidth="1" vectorEffect="non-scaling-stroke"/><line data-point-position-dimension-line={d.id} data-point-position-dimension-snap={isSnapped||undefined} x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} stroke={isSnapped?'#167d80':'#626262'} strokeWidth={isSnapped?'1.5':'1'} vectorEffect="non-scaling-stroke"/>
      {[start,end].map((point,index)=><line key={index} x1={point[0]-tickVector[0]} y1={point[1]-tickVector[1]} x2={point[0]+tickVector[0]} y2={point[1]+tickVector[1]} stroke="#626262" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}
      <text data-point-position-dimension-label={d.id} x={labelPoint[0]} y={labelPoint[1]} transform={`rotate(${angle} ${labelPoint[0]} ${labelPoint[1]})`} textAnchor="middle" dominantBaseline="middle" fontFamily="DM Mono, monospace" fontSize={.18*annotationScale} fill="#404040" stroke="#fdfdfc" strokeWidth=".04" paintOrder="stroke" onPointerDown={event=>{event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);const start=toPlanPoint?.(event.clientX,event.clientY);if(start)dragRef.current={id:d.id,pointerId:event.pointerId,start,origin:position,position,mode:null};}} onPointerMove={event=>{const drag=dragRef.current;if(!drag||drag.id!==d.id||drag.pointerId!==event.pointerId)return;const point=toPlanPoint?.(event.clientX,event.clientY);if(!point)return;const delta:Point=[point[0]-drag.start[0],point[1]-drag.start[1]],along=dot(delta,axis),across=dot(delta,d.normal),mode=drag.mode??(Math.abs(along)>=Math.abs(across)?'label':'line');let next:DimensionPosition;if(mode==='label'){next={...drag.origin,label:Math.max(.08,Math.min(.92,drag.origin.label+along/length))};setActiveSnap(null);}else{const snapped=snapLineOffset(d,drag.origin.lineOffset+across);next={...drag.origin,lineOffset:snapped.offset};drag.snapTargetId=snapped.targetId;setActiveSnap(snapped.targetId?{sourceId:d.id,targetId:snapped.targetId}:null);}dragRef.current={...drag,mode,position:next};setDraftPositions(current=>({...current,[d.id]:next}));}} onPointerUp={event=>finish(event,true)} onPointerCancel={event=>finish(event,false)} onLostPointerCapture={event=>finish(event,false)}><title>{`点位中心定位尺寸；${d.referenceKind==='opening-edge'?'洞口边':d.referenceKind==='wall-face'?'模型墙面':d.referenceKind==='device-center'?'同类点位中心':'墙端'}至设备中心；来源 ${d.relatedIds.join(', ')}`}</title>{label}</text>
    </g>;
  })}</g>;
}
