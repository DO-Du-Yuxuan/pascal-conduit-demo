import React, { useEffect, useMemo, useState, type RefObject } from 'react';
import type { NodeData } from '../types';
import type { ConduitOverlayDocument, RoutingSystem } from '../domain/overlay';
import type { ViewBox } from '../geometry/transform';
import type { ManualMeasurement, MeasurementUnit } from '../geometry/manual-measurement';
import type { ExteriorDimensionReport } from '../geometry/exterior-dimensions';
import { buildPlanAnnotations, buildPointPositionDimensions, createPlanContext, type Point } from './model';
import { annotationRuleSide, layoutExteriorAnnotations, rotatePoint } from './layout';
import { useOverlayStore } from '../domain/store';

export function useConstructionPlan({ nodes, overlay, levelId, hiddenNodeIds, unit, rotation, viewBox, planRef, selectedId, exterior, dimensionsVisible, measurements, systemVisibility, devicesVisible, annotationScale }: {
  nodes: Record<string,NodeData>; overlay: ConduitOverlayDocument | null; levelId: string; hiddenNodeIds: ReadonlySet<string>; unit: MeasurementUnit; rotation: number; viewBox: ViewBox;
  planRef: RefObject<HTMLDivElement | null>; selectedId: string | null; exterior: ExteriorDimensionReport; dimensionsVisible: boolean; measurements: ManualMeasurement[];
  systemVisibility?: Readonly<Record<RoutingSystem, boolean>>; devicesVisible?: boolean; annotationScale: number;
}) {
  const [size,setSize] = useState({width:800,height:600});
  useEffect(()=>{
    const el=planRef.current; if(!el) return;
    let frame=0;
    const update=()=>{ cancelAnimationFrame(frame); frame=requestAnimationFrame(()=>{const r=el.getBoundingClientRect(); if(r.width && r.height) setSize(old=>old.width===r.width && old.height===r.height ? old : {width:r.width,height:r.height});});};
    update(); const observer=typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update); observer?.observe(el);
    return ()=>{observer?.disconnect();cancelAnimationFrame(frame);};
  },[planRef]);
  const scale=Math.max(.001,Math.min(size.width/viewBox.width,size.height/viewBox.height));
  const context=useMemo(()=>overlay ? createPlanContext(nodes,overlay,hiddenNodeIds,systemVisibility) : null,[nodes,overlay,hiddenNodeIds,systemVisibility]);
  const report=useMemo(()=>overlay && context && devicesVisible !== false ? buildPlanAnnotations(nodes,overlay,levelId,unit,context) : {annotations:[],notices:[]},[nodes,overlay,levelId,unit,context,devicesVisible]);
  const positionDimensions=useMemo(()=>overlay&&context&&devicesVisible!==false?buildPointPositionDimensions(nodes,overlay,levelId,context):[],[nodes,overlay,levelId,context,devicesVisible]);
  const layout=useMemo(()=>layoutExteriorAnnotations(report.annotations,exterior,annotationScale),[report.annotations,exterior,annotationScale]);
  return {context,scale,report,layout,positionDimensions,annotationScale};
}
export type ConstructionPlan = ReturnType<typeof useConstructionPlan>;
export function ConstructionAnnotations({plan,rotation,onSelect}: {plan:ConstructionPlan;rotation:number;onSelect:(id:string|null)=>void}) {
  const overlay=useOverlayStore(state=>state.overlay),commit=useOverlayStore(state=>state.commit),[editing,setEditing]=useState<{ids:string[];value:string}|null>(null),lineHeight=.3*plan.annotationScale,fontSize=.2*plan.annotationScale;
  const rename=(ids:string[],value:string)=>{const name=value.trim();if(overlay&&name)commit({...overlay,devices:overlay.devices.map(device=>ids.includes(device.id)?{...device,name}:device)});setEditing(null);};
  return <g className="construction-annotations" aria-label="施工标注">
    {plan.layout.placed.map(({annotation:a,innerBend,boundary,label,textWidth,textHeight,outwardNormal})=>{
      const ruleSide=annotationRuleSide(outwardNormal,rotation);
      const commonHeight=a.rows.every(row=>row.height===a.rows[0]?.height),sharedHeight=a.arrangement==='horizontal'&&commonHeight,edgeX=ruleSide==='left'?-textWidth/2:textWidth/2,edgeOffset=rotatePoint([edgeX,0],-rotation),end:[number,number]=[label[0]+edgeOffset[0],label[1]+edgeOffset[1]],horizontalSide=Math.abs(outwardNormal[0])>=Math.abs(outwardNormal[1]),routeBend:[number,number]=horizontalSide?[end[0],boundary[1]]:[boundary[0],end[1]];
      const lines=a.rows.flatMap(row=>sharedHeight?[{kind:'label' as const,row}]:[{kind:'label' as const,row},{kind:'height' as const,row}]);if(sharedHeight&&a.rows[0])lines.push({kind:'height',row:a.rows[0]});
      return <g key={a.id} data-annotation={a.kind} data-source-id={a.sourceId} data-rule-side={ruleSide} onClick={e=>{e.stopPropagation();onSelect(a.sourceId);}}>
        <polyline points={[a.anchor,innerBend,boundary,routeBend,end].map(point=>point.join(',')).join(' ')} fill="none" stroke="#858585" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
        <g transform={`translate(${label[0]} ${label[1]}) rotate(${-rotation})`}>
          <title>{[a.text,`来源：${a.relatedIds.join(', ')}`,`依据：${a.measurementBasis}；置信度：${a.confidence}`,...a.assumptions].join('\n')}</title>
          <rect x={-textWidth/2-.04} y={-textHeight/2-.08} width={textWidth+.08} height={textHeight+.16} fill="#fff" fillOpacity=".96"/>
          <line data-callout-rule x1={edgeX} y1={-textHeight/2} x2={edgeX} y2={textHeight/2} stroke="#343434" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
          {lines.map((line,index)=>{const y=-textHeight/2+lineHeight*(index+.5),isEditing=line.kind==='label'&&editing?.ids.join('|')===line.row.sourceIds.join('|');return <g key={`${line.row.editableSourceId}:${line.kind}:${index}`}>
            {index>0&&<line x1={-textWidth/2} y1={y-lineHeight/2} x2={textWidth/2} y2={y-lineHeight/2} stroke="#343434" strokeWidth="1" vectorEffect="non-scaling-stroke"/>}
            {isEditing?<foreignObject x={-textWidth/2+.06} y={y-lineHeight*.42} width={textWidth-.12} height={lineHeight*.84}><input autoFocus value={editing.value} onChange={event=>setEditing({...editing,value:event.target.value})} onBlur={()=>rename(editing.ids,editing.value)} onKeyDown={event=>{if(event.key==='Enter')rename(editing.ids,editing.value);if(event.key==='Escape')setEditing(null);}} style={{width:'100%',height:'100%',border:'none',padding:0,background:'#fff',fontSize:`${fontSize}px`}}/></foreignObject>:<text x={edgeX<0?-.0:0} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fill="#343434" fontFamily="system-ui, sans-serif" onDoubleClick={event=>{event.stopPropagation();if(line.kind==='label')setEditing({ids:line.row.sourceIds,value:line.row.label});}}>{line.kind==='height'?`H=${line.row.height}`:<>{line.row.label}{line.row.count>1?` × ${line.row.count}`:''}{line.row.position?`    ${line.row.position}`:''}</>}</text>}
          </g>;})}
        </g>
      </g>;
    })}
  </g>;
}
export function ConstructionNotices({plan,onFocus}: {plan:ConstructionPlan;onFocus:(id:string,anchor?:Point)=>void}) {
  const hidden=plan.layout.hidden;
  if(!plan.report.notices.length&&!hidden.length) return null;
  const objects=new Map<string,{text:string;anchor?:Point}>();
  for(const a of hidden) {const old=objects.get(a.sourceId);objects.set(a.sourceId,{text:old?`${old.text}；${a.text}`:a.text,anchor:a.anchor});}
  for(const n of plan.report.notices) {const old=objects.get(n.sourceId);objects.set(n.sourceId,{text:old?`${old.text}；${n.text}`:n.text,anchor:n.anchor??old?.anchor});}
  return <div className="construction-notices" onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
    {objects.size>0&&<details><summary>未显示点位 {objects.size}</summary><ul>{[...objects].map(([id,n])=><li key={id}><button onClick={()=>onFocus(id,n.anchor)}>{n.text}{!n.anchor?'（无法定位楼层）':''}</button></li>)}</ul></details>}
  </div>;
}
