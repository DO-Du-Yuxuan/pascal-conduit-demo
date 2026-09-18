import React, { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { NodeData } from '../types';
import type { ConduitOverlayDocument, RoutingSystem } from '../domain/overlay';
import type { ViewBox } from '../geometry/transform';
import type { ManualMeasurement, MeasurementUnit } from '../geometry/manual-measurement';
import type { ExteriorDimensionReport } from '../geometry/exterior-dimensions';
import { buildPlanAnnotations, buildPointPositionDimensionReport, createPlanContext, type Point } from './model';
import { buildInstallationSchedule, installationVariantByDeviceId } from './construction-drawings';
import { annotationPlacementSignature, annotationRuleSide, layoutExteriorAnnotations, preserveAnnotationPresentation, rotatePoint } from './layout';
import { useOverlayStore } from '../domain/store';

/**
 * Capture generated drawing layout once. Subsequent model edits change derived
 * dimensions and callout text, but do not make unrelated drawing objects jump
 * back to a newly calculated default lane or panel position.
 */
export function missingConstructionDrawingLayout(overlay: ConduitOverlayDocument, plan: Pick<ConstructionPlan, 'layout' | 'report' | 'positionDimensions' | 'annotationScale'>) {
  const annotationLabels = Object.fromEntries(plan.layout.placed
    .filter(item => !overlay.constructionAnnotationLabelPositions[item.annotation.id])
    .map(item => [item.annotation.id, item.label]));
  const annotationSignatures = Object.fromEntries(plan.report.annotations
    .filter(annotation => !overlay.constructionAnnotationLabelPlacementSignatures[annotation.id])
    .map(annotation => [annotation.id, annotationPlacementSignature(annotation)]));
  const pointLabelPositions = Object.fromEntries(plan.positionDimensions
    .filter(dimension => overlay.pointPositionDimensionLabelPositions[dimension.id] === undefined)
    .map(dimension => [dimension.id, .5]));
  const pointLineOffsets = Object.fromEntries(plan.positionDimensions
    .filter(dimension => overlay.pointPositionDimensionLineOffsets[dimension.id] === undefined)
    .map(dimension => [dimension.id, .28 * plan.annotationScale + dimension.lane * .18 * plan.annotationScale]));
  if (!Object.keys(annotationLabels).length && !Object.keys(annotationSignatures).length && !Object.keys(pointLabelPositions).length && !Object.keys(pointLineOffsets).length) return null;
  return {
    ...overlay,
    constructionAnnotationLabelPositions: { ...overlay.constructionAnnotationLabelPositions, ...annotationLabels },
    constructionAnnotationLabelPlacementSignatures: { ...overlay.constructionAnnotationLabelPlacementSignatures, ...annotationSignatures },
    pointPositionDimensionLabelPositions: { ...overlay.pointPositionDimensionLabelPositions, ...pointLabelPositions },
    pointPositionDimensionLineOffsets: { ...overlay.pointPositionDimensionLineOffsets, ...pointLineOffsets },
  };
}

export function useConstructionPlan({ nodes, overlay, levelId, hiddenNodeIds, unit, rotation, viewBox, planRef, selectedId, exterior, dimensionsVisible, measurements, systemVisibility, sensorVisible, devicesVisible, annotationScale }: {
  nodes: Record<string,NodeData>; overlay: ConduitOverlayDocument | null; levelId: string; hiddenNodeIds: ReadonlySet<string>; unit: MeasurementUnit; rotation: number; viewBox: ViewBox;
  planRef: RefObject<HTMLDivElement | null>; selectedId: string | null; exterior: ExteriorDimensionReport; dimensionsVisible: boolean; measurements: ManualMeasurement[];
  systemVisibility?: Readonly<Record<RoutingSystem, boolean>>; sensorVisible?: boolean; devicesVisible?: boolean; annotationScale: number;
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
  const context=useMemo(()=>overlay ? createPlanContext(nodes,overlay,hiddenNodeIds,systemVisibility,sensorVisible) : null,[nodes,overlay,hiddenNodeIds,systemVisibility,sensorVisible]);
  const annotationReport=useMemo(()=>{
    if (!overlay || !context || devicesVisible === false) return {annotations:[],notices:[]};
    const report=buildPlanAnnotations(nodes,overlay,levelId,unit,context);
    return {...report,annotations:report.annotations.map(annotation=>preserveAnnotationPresentation(annotation,overlay.constructionAnnotationLabelPlacementSignatures[annotation.id]))};
  },[nodes,overlay,levelId,unit,context,devicesVisible]);
  const positionReport=useMemo(()=>overlay&&context&&devicesVisible!==false?buildPointPositionDimensionReport(nodes,overlay,levelId,context):{dimensions:[],notices:[]},[nodes,overlay,levelId,context,devicesVisible]);
  const report=useMemo(()=>({annotations:annotationReport.annotations,notices:[...annotationReport.notices,...positionReport.notices]}),[annotationReport,positionReport]);
  const positionDimensions=positionReport.dimensions;
  const installationSchedule=useMemo(()=>overlay&&context&&devicesVisible!==false?buildInstallationSchedule(nodes,overlay,levelId,unit,context):[],[nodes,overlay,levelId,unit,context,devicesVisible]);
  const deviceVariants=useMemo(()=>installationVariantByDeviceId(installationSchedule),[installationSchedule]);
  const layout=useMemo(()=>layoutExteriorAnnotations(report.annotations,exterior,annotationScale,overlay?.constructionAnnotationLabelPositions,overlay?.constructionAnnotationLabelPlacementSignatures),[report.annotations,exterior,annotationScale,overlay?.constructionAnnotationLabelPositions,overlay?.constructionAnnotationLabelPlacementSignatures]);
  return {context,scale,report,layout,positionDimensions,installationSchedule,deviceVariants,annotationScale};
}
export type ConstructionPlan = ReturnType<typeof useConstructionPlan>;
/** Kept outside individual drawing layers so hidden layers do not lose their stable layout. */
export function ConstructionDrawingLayoutPersistence({plan}: {plan: ConstructionPlan}) {
  const overlay=useOverlayStore(state=>state.overlay),commit=useOverlayStore(state=>state.commit);
  useEffect(()=>{
    if (!overlay) return;
    const updated=missingConstructionDrawingLayout(overlay,plan);
    if (updated) commit(updated);
  },[overlay,plan,commit]);
  return null;
}
export function ConstructionAnnotations({plan,rotation,onSelect,onLabelPositionChange,toPlanPoint}: {plan:ConstructionPlan;rotation:number;onSelect:(id:string|null)=>void;onLabelPositionChange?:(id:string,label:Point,signature:string)=>void;toPlanPoint?:(clientX:number,clientY:number)=>Point|null}) {
  const overlay=useOverlayStore(state=>state.overlay),commit=useOverlayStore(state=>state.commit),[editing,setEditing]=useState<{ids:string[];value:string;left:number;top:number;width:number}|null>(null),[draftLabels,setDraftLabels]=useState<Record<string,Point>>({}),dragRef=useRef<{id:string;pointerId:number}|null>(null),lineHeight=.3*plan.annotationScale,fontSize=.2*plan.annotationScale;
  const rename=(ids:string[],value:string)=>{const selected=overlay?.devices.filter(device=>ids.includes(device.id))??[],trimmed=value.trim(),name=trimmed||(selected.every(device=>device.deviceType==='sensor')?'传感器':'');if(overlay&&name)commit({...overlay,devices:overlay.devices.map(device=>ids.includes(device.id)?{...device,name}:device)});setEditing(null);};
  const editor=editing?createPortal(<input className="construction-annotation-editor" autoFocus value={editing.value} onChange={event=>setEditing({...editing,value:event.target.value})} onBlur={()=>rename(editing.ids,editing.value)} onKeyDown={event=>{event.stopPropagation();if(event.nativeEvent.isComposing)return;if(event.key==='Enter')rename(editing.ids,editing.value);if(event.key==='Escape')setEditing(null);}} style={{position:'fixed',left:editing.left,top:editing.top,zIndex:30,width:editing.width,height:30,border:'1px solid #e75c3c',padding:'3px 6px',background:'#fff',color:'#343434',caretColor:'#343434',fontSize:'14px',fontFamily:'system-ui, sans-serif',lineHeight:'20px'}}/>,document.body):null;
  return <><g className="construction-annotations" aria-label="施工标注">
    {plan.layout.placed.map(({annotation:a,innerBend,boundary,label:placedLabel,textWidth,textHeight,outwardNormal,manual})=>{
      const label=draftLabels[a.id]??placedLabel,isManual=manual||draftLabels[a.id]!==undefined,leaderDirection:Point=isManual?[label[0]-a.anchor[0],label[1]-a.anchor[1]]:outwardNormal,ruleSide=annotationRuleSide(leaderDirection,rotation);
      const commonHeight=a.rows.every(row=>row.height===a.rows[0]?.height),sharedHeight=a.arrangement==='horizontal'&&commonHeight,edgeX=ruleSide==='left'?-textWidth/2:textWidth/2,edgeOffset=rotatePoint([edgeX,0],-rotation),end:[number,number]=[label[0]+edgeOffset[0],label[1]+edgeOffset[1]],horizontalSide=Math.abs(outwardNormal[0])>=Math.abs(outwardNormal[1]),routeBend:[number,number]=horizontalSide?[end[0],boundary[1]]:[boundary[0],end[1]],manualBend:[number,number]=Math.abs(end[0]-a.anchor[0])>=Math.abs(end[1]-a.anchor[1])?[end[0],a.anchor[1]]:[a.anchor[0],end[1]],leader=isManual?[a.anchor,manualBend,end]:[a.anchor,innerBend,boundary,routeBend,end];
      const lines=a.rows.flatMap(row=>sharedHeight?[{kind:'label' as const,row}]:[{kind:'label' as const,row},{kind:'height' as const,row}]);if(sharedHeight&&a.rows[0])lines.push({kind:'height',row:a.rows[0]});
      return <g key={a.id} data-annotation={a.kind} data-source-id={a.sourceId} data-rule-side={ruleSide} onClick={e=>{e.stopPropagation();onSelect(a.sourceId);}}>
        <polyline points={leader.map(point=>point.join(',')).join(' ')} fill="none" stroke="#858585" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
        <g data-construction-annotation-panel={a.id} transform={`translate(${label[0]} ${label[1]}) rotate(${-rotation})`} onPointerDown={event=>{if(!toPlanPoint||!onLabelPositionChange||(event.target as Element).closest('text, input, foreignObject'))return;event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);dragRef.current={id:a.id,pointerId:event.pointerId};}} onPointerMove={event=>{const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;const point=toPlanPoint?.(event.clientX,event.clientY);if(point)setDraftLabels(labels=>({...labels,[drag.id]:point}));}} onPointerUp={event=>{const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;const point=toPlanPoint?.(event.clientX,event.clientY)??draftLabels[drag.id]??label;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);dragRef.current=null;setDraftLabels(labels=>{const next={...labels};delete next[drag.id];return next;});onLabelPositionChange?.(drag.id,point,annotationPlacementSignature(a));}} onPointerCancel={event=>{const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);dragRef.current=null;setDraftLabels(labels=>{const next={...labels};delete next[drag.id];return next;});}}>
          <title>{[a.text,`来源：${a.relatedIds.join(', ')}`,`依据：${a.measurementBasis}；置信度：${a.confidence}`,...a.assumptions].join('\n')}</title>
          <rect x={-textWidth/2-.04} y={-textHeight/2-.08} width={textWidth+.08} height={textHeight+.16} fill="#fff" fillOpacity=".96"/>
          <line data-callout-rule x1={edgeX} y1={-textHeight/2} x2={edgeX} y2={textHeight/2} stroke="#343434" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
          {lines.map((line,index)=>{const y=-textHeight/2+lineHeight*(index+.5),isEditing=line.kind==='label'&&editing?.ids.join('|')===line.row.sourceIds.join('|');return <g key={`${line.row.editableSourceId}:${line.kind}:${index}`}>
            {index>0&&<line x1={-textWidth/2} y1={y-lineHeight/2} x2={textWidth/2} y2={y-lineHeight/2} stroke="#343434" strokeWidth="1" vectorEffect="non-scaling-stroke"/>}
            {!isEditing&&<text x={edgeX<0?-.0:0} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={fontSize} fill="#343434" fontFamily="system-ui, sans-serif" onDoubleClick={event=>{event.stopPropagation();if(line.kind==='label'){const rect=event.currentTarget.getBoundingClientRect();setEditing({ids:line.row.sourceIds,value:line.row.label,left:rect.left,top:rect.top,width:Math.max(120,rect.width+12)});}}}>{line.kind==='height'?`H=${line.row.height}`:<>{line.row.label}{line.row.count>1?` × ${line.row.count}`:''}{line.row.position?`    ${line.row.position}`:''}</>}</text>}
          </g>;})}
        </g>
      </g>;
    })}
  </g>{editor}</>;
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
