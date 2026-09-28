import React from 'react';
import type { BendArc, ConduitOverlayDocument, NetworkDevice, Vec3 } from '../domain/overlay';
import { levelElevation } from '../domain/building';
import { DEVICE_DEFAULTS } from '../domain/devices';
import { useOverlayStore } from '../domain/store';
import { planFittingDisplay } from '../domain/network-plan';
import { isFloorSocket, PLAN_COLORS, SENSOR_PLAN_COLOR, type PlanContext } from './model';
import { DeviceSymbol } from './DeviceSymbol';
import { HvacPlan } from './HvacPlan';
function planArcPoints(arc: BendArc): Vec3[] {
  const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], center = arc.center, start = subtract(arc.start, center), radius = Math.hypot(...start), normalLength = Math.max(1e-9, Math.hypot(...arc.normal)), normal = arc.normal.map((value) => value / normalLength) as Vec3;
  const tangent: Vec3 = [(normal[1] * start[2] - normal[2] * start[1]) / Math.max(1e-9, radius), (normal[2] * start[0] - normal[0] * start[2]) / Math.max(1e-9, radius), (normal[0] * start[1] - normal[1] * start[0]) / Math.max(1e-9, radius)];
  return Array.from({ length: 17 }, (_, index) => { const angle = arc.sweepRadians * index / 16; return [center[0] + start[0] * Math.cos(angle) + tangent[0] * radius * Math.sin(angle), center[1] + start[1] * Math.cos(angle) + tangent[1] * radius * Math.sin(angle), center[2] + start[2] * Math.cos(angle) + tangent[2] * radius * Math.sin(angle)]; });
}
const WALL_ORIENTED_TYPES=new Set(['socket','switch','network-outlet','strong-panel','weak-panel','rfid-reader']);
const NETWORK_CONDUIT_OUTLINE='#00a6a0';
const NETWORK_CONDUIT_CORE='#ffffff';
function conduitStrokeLayers(system:keyof typeof PLAN_COLORS,scale:number,override?:string,widthPx=1.8){
  if(system!=='network'||override)return [{role:'color',stroke:override??PLAN_COLORS[system],strokeWidth:widthPx/scale}] as const;
  return [{role:'outline',stroke:NETWORK_CONDUIT_OUTLINE,strokeWidth:(widthPx+2.2)/scale},{role:'core',stroke:NETWORK_CONDUIT_CORE,strokeWidth:widthPx/scale}] as const;
}
/** Dashed lines identify overhead free-space runs, not low open ends at floor level. */
function suspendedConduit(start: { position: Vec3; attachment?: { hostKind: string; surface: string } }, end: { position: Vec3; attachment?: { hostKind: string; surface: string } }, context: PlanContext, levelId: string) {
  const attachments = [start.attachment, end.attachment].filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment));
  if (attachments.some(attachment => attachment.hostKind === 'ceiling' && /back/i.test(attachment.surface))) return true;
  const midpointY = (start.position[1] + end.position[1]) / 2;
  const aboveFloor = midpointY - levelElevation(context.scene, levelId) >= 1.8;
  return aboveFloor && attachments.length < 2;
}
function suspendedFitting(attachment: { hostKind: string; surface: string } | undefined, points: readonly Vec3[], context: PlanContext, levelId: string) {
  if (attachment?.hostKind === 'ceiling' && /back/i.test(attachment.surface)) return true;
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / Math.max(1, points.length);
  return !attachment && meanY - levelElevation(context.scene, levelId) >= 1.8;
}
export function devicePlanRotation(device:NetworkDevice,canvasRotation:number){
  if(!WALL_ORIENTED_TYPES.has(device.deviceType))return -canvasRotation;
  const direction=device.position.attachment?.normal??device.frame?.front??device.orientation,[x,,z]=direction;
  return Number.isFinite(x)&&Number.isFinite(z)&&Math.hypot(x,z)>1e-6?Math.atan2(x,-z)*180/Math.PI:-canvasRotation;
}

const ConduitPlanPermanent = React.memo(function ConduitPlanPermanent({ overlay, levelId, selectedId, onSelect, context, scale, rotation, devicesVisible, conduitsVisible, hvacVisible, annotationScale, deviceVariants }: { overlay: ConduitOverlayDocument; levelId: string; selectedId: string | null; onSelect: (id: string | null) => void; context: PlanContext; scale: number; rotation: number; devicesVisible: boolean; conduitsVisible: boolean; hvacVisible: boolean; annotationScale: number; deviceVariants: Readonly<Record<string, string>> }) {
  const color = (id: string, system: keyof typeof PLAN_COLORS) => id === selectedId ? '#f36b00' : PLAN_COLORS[system];
  const select = (id: string) => (event: React.MouseEvent) => { event.stopPropagation(); onSelect(id); };
  return <g className="conduit-plan-permanent" fill="none" strokeWidth={1.8 / scale} strokeLinecap="round" strokeLinejoin="round">
    {hvacVisible && <HvacPlan overlay={overlay} levelId={levelId} selectedId={selectedId} onSelect={onSelect} scale={scale} rotation={rotation} floorElevation={levelElevation(context.scene,levelId)} />}
    {conduitsVisible && overlay.segments.filter(s => context.segmentVisible(s) && context.segmentLevels.get(s.id)?.includes(levelId)).map(s => { const suspended=suspendedConduit(s.start,s.end,context,levelId); return <g key={s.id} data-conduit-segment={s.id} data-suspended={suspended || undefined} onClick={select(s.id)}><line x1={s.start.position[0]} y1={s.start.position[2]} x2={s.end.position[0]} y2={s.end.position[2]} stroke="transparent" strokeWidth={10 / scale}/>{conduitStrokeLayers(s.system,scale,s.id===selectedId?'#f36b00':undefined).map(layer=><line key={layer.role} data-conduit-stroke={layer.role} x1={s.start.position[0]} y1={s.start.position[2]} x2={s.end.position[0]} y2={s.end.position[2]} stroke={layer.stroke} strokeWidth={layer.strokeWidth} strokeDasharray={suspended?'.12 .08':undefined}/>)}</g>; })}
    {conduitsVisible && overlay.fittings.filter(f => context.systemVisibility[f.system] && !context.hidden.has(f.id) && !context.hostHidden(f.position.attachment) && context.linkedLevel(f.segmentIds,f.position.attachment) === levelId).map(f => {
      const d = planFittingDisplay(f), layers=conduitStrokeLayers(f.system,scale,f.id===selectedId?'#f36b00':undefined);
      if(d.kind === 'arc' || d.kind === 'bridge') { const pathPoints=d.kind === 'arc' ? planArcPoints(f.arc!) : d.points, suspended=suspendedFitting(f.position.attachment,pathPoints,context,levelId); return <g key={f.id} data-conduit-fitting={f.id} data-suspended={suspended || undefined} onClick={select(f.id)}>{layers.map(layer=><polyline key={layer.role} data-conduit-stroke={layer.role} points={pathPoints.map(p=>`${p[0]},${p[2]}`).join(' ')} stroke={layer.stroke} strokeWidth={layer.strokeWidth} strokeDasharray={d.kind === 'bridge' ? `${4/scale} ${3/scale}` : suspended ? '.12 .08' : undefined}/>)}</g>; }
      if(d.kind === 'connectors') { const points=d.lines.flatMap(line=>[line.start,line.end]), suspended=suspendedFitting(f.position.attachment,points,context,levelId); return <g key={f.id} data-conduit-fitting={f.id} data-suspended={suspended || undefined} onClick={select(f.id)}>{layers.map(layer=><g key={layer.role} data-conduit-stroke={layer.role} stroke={layer.stroke} strokeWidth={layer.strokeWidth} strokeDasharray={suspended?'.12 .08':undefined}>{d.lines.map((l,i)=><line key={i} x1={l.start[0]} y1={l.start[2]} x2={l.end[0]} y2={l.end[2]}/>)}</g>)}</g>; }
      return null;
    })}
    {devicesVisible && overlay.devices.filter(d => context.deviceVisible(d) && context.deviceLevel(d) === levelId).map(d => {
      const symbolRotation=devicePlanRotation(d,rotation),anchor=context.devicePlanAnchor(d),variant=deviceVariants[d.id],sprinklerDirection=d.deviceType==='sprinkler-head'?(d.sprinklerDirection==='pendent'?'pendent':'upright'):undefined,floorSocket=isFloorSocket(d),system=d.systems.find(s=>context.systemVisibility[s]) ?? d.systems[0],isPanel=d.deviceType==='strong-panel'||d.deviceType==='weak-panel',panelWidth=d.sizeMm[0]/1000,panelDepth=d.sizeMm[2]/1000;
      return <g key={d.id} data-device-symbol={d.deviceType} data-floor-socket={floorSocket||undefined} data-sprinkler-direction={sprinklerDirection} data-panel-width-m={isPanel?panelWidth:undefined} data-panel-depth-m={isPanel?panelDepth:undefined} transform={`translate(${anchor[0]} ${anchor[1]}) rotate(${symbolRotation})${isPanel?'':` scale(${.018*annotationScale})`}`} stroke={d.deviceType==='sensor'?(d.id===selectedId?'#f36b00':SENSOR_PLAN_COLOR):color(d.id,system!)} strokeWidth={isPanel?1.5/scale:1.5} fill="#fff" onClick={select(d.id)}>
        {isPanel?<>
          <rect data-panel-real-size x={-panelWidth/2} y={-panelDepth/2} width={panelWidth} height={panelDepth}/>
          {d.deviceType==='strong-panel'?<path d={`M${-panelWidth*.32} ${panelDepth*.3}L${panelWidth*.32} ${-panelDepth*.3}M${-panelWidth*.32} ${-panelDepth*.3}L${panelWidth*.32} ${panelDepth*.3}`} />:<path d={`M${-panelWidth*.3} 0H${panelWidth*.3}`} />}
          {variant&&<g transform={`scale(${.018*annotationScale}) rotate(${-symbolRotation-rotation} 14 -10)`}><rect x="8" y="-16" width="12" height="12" rx="2" stroke="none" fill="#fff" fillOpacity=".92"/><text data-device-variant={variant} x="14" y="-10" textAnchor="middle" dominantBaseline="middle" fontSize="10" fontWeight="700" stroke="none" fill="#343434">{variant}</text></g>}
        </>:<><rect x="-11" y="-11" width="22" height="22" fill="transparent" stroke="none"/><DeviceSymbol type={d.deviceType} sprinklerDirection={sprinklerDirection} floorSocket={floorSocket}/>{variant&&<g transform={`rotate(${-symbolRotation-rotation} 14 -10)`}><rect x="8" y="-16" width="12" height="12" rx="2" stroke="none" fill="#fff" fillOpacity=".92"/><text data-device-variant={variant} x="14" y="-10" textAnchor="middle" dominantBaseline="middle" fontSize="10" fontWeight="700" stroke="none" fill="#343434">{variant}</text></g>}</>}
      </g>;
    })}
    {devicesVisible && overlay.junctionBoxes.filter(b => context.systemVisibility[b.system] && !context.hidden.has(b.id) && !context.hostHidden(b.position.attachment) && context.linkedLevel(b.segmentIds,b.position.attachment) === levelId).map(b=><g key={b.id} transform={`translate(${b.position.position[0]} ${b.position.position[2]}) rotate(${-rotation}) scale(${.018*annotationScale})`} stroke={color(b.id,b.system)} fill="#fff" strokeWidth="1.5" onClick={select(b.id)}><DeviceSymbol type="junction-box"/></g>)}
    {conduitsVisible && overlay.penetrations.filter(p => overlay.segments.some(s=>s.id===p.segmentId && context.segmentVisible(s)) && !context.hidden.has(p.id) && context.hostLevel(p.entry.attachment) === levelId).map(p=><g key={p.id} transform={`translate(${p.entry.position[0]} ${p.entry.position[2]}) scale(${1/scale})`} stroke="#9a6c39" strokeWidth="1" onClick={select(p.id)}><circle r="5"/><path d="M-7 0H7M0-7V7"/></g>)}
  </g>;
});
export function ConduitPlanOverlay({ overlay, levelId, selectedId, onSelect, context, scale, rotation, devicesVisible = true, conduitsVisible = true, hvacVisible = true, annotationScale = 1, deviceVariants = {} }: { overlay: ConduitOverlayDocument | null; levelId: string; selectedId: string | null; onSelect: (id: string | null) => void; context: PlanContext | null; scale: number; rotation: number; devicesVisible?: boolean; conduitsVisible?: boolean; hvacVisible?: boolean; annotationScale?: number; deviceVariants?: Readonly<Record<string, string>> }) {
  const sharedPreview = useOverlayStore((state) => state.preview);
  if (!overlay || !context) return null;
  const preview = sharedPreview?.sourceSha === overlay.source.sha256 && (sharedPreview.levelId === levelId) ? sharedPreview : null;
  return <g className="conduit-plan-overlay" aria-label="只读管线平面图">
    <ConduitPlanPermanent overlay={overlay} levelId={levelId} selectedId={selectedId} onSelect={onSelect} context={context} scale={scale} rotation={rotation} devicesVisible={devicesVisible} conduitsVisible={conduitsVisible} hvacVisible={hvacVisible} annotationScale={annotationScale} deviceVariants={deviceVariants} />
    {conduitsVisible && preview && context.systemVisibility[preview.system] && <g className="conduit-plan-preview" pointerEvents="none" opacity=".78">
      {(() => { const invalid=preview.plan?.canCommit === false,layers=conduitStrokeLayers(preview.system,scale,invalid?'#ef4444':undefined,2); if (preview.plan) return <>{preview.plan.segments.map((segment) => <React.Fragment key={segment.id}>{layers.map(layer=><line key={layer.role} data-conduit-stroke={layer.role} x1={segment.start.position[0]} y1={segment.start.position[2]} x2={segment.end.position[0]} y2={segment.end.position[2]} stroke={layer.stroke} strokeWidth={layer.strokeWidth} strokeLinecap="round" strokeDasharray=".12 .07" />)}</React.Fragment>)}{preview.plan.fittings.filter((fitting) => Boolean(fitting.arc)).flatMap((fitting) => layers.map(layer=><polyline key={`${fitting.id}:${layer.role}`} data-conduit-stroke={layer.role} points={planArcPoints(fitting.arc!).map((point) => `${point[0]},${point[2]}`).join(" ")} fill="none" stroke={layer.stroke} strokeWidth={layer.strokeWidth} strokeLinecap="round" strokeLinejoin="round" strokeDasharray=".12 .07" />))}{preview.plan.fittings.filter((fitting) => Boolean(fitting.bridge)).flatMap((fitting) => layers.map(layer=><polyline key={`${fitting.id}:${layer.role}`} data-conduit-stroke={layer.role} points={[fitting.bridge!.entry, fitting.bridge!.crestStart, fitting.bridge!.crestEnd, fitting.bridge!.exit].map((point) => `${point[0]},${point[2]}`).join(" ")} fill="none" stroke={layer.stroke} strokeWidth={layer.strokeWidth} strokeLinecap="round" strokeDasharray=".04 .03" />))}</>; if (preview.points.length >= 2) return <>{layers.map(layer=><polyline key={layer.role} data-conduit-stroke={layer.role} points={preview.points.map((point) => `${point.position[0]},${point.position[2]}`).join(" ")} fill="none" stroke={layer.stroke} strokeWidth={layer.strokeWidth} strokeLinecap="round" strokeLinejoin="round" strokeDasharray=".12 .07" />)}</>; return null; })()}
      {preview.points.length > 0 && <circle cx={preview.points[preview.points.length - 1].position[0]} cy={preview.points[preview.points.length - 1].position[2]} r={.09*annotationScale} fill={preview.plan?.canCommit === false ? "#ef4444" : preview.system==='network'?NETWORK_CONDUIT_CORE:PLAN_COLORS[preview.system]} stroke={preview.plan?.canCommit === false?undefined:preview.system==='network'?NETWORK_CONDUIT_OUTLINE:undefined} strokeWidth={preview.system==='network'?2/scale:undefined}/>}
      {devicesVisible && preview.branchNode?.kind === "junction-box" && <g transform={`translate(${preview.branchNode.position[0]} ${preview.branchNode.position[2]}) rotate(${-rotation}) scale(${.018*annotationScale})`} stroke={PLAN_COLORS[preview.system]} fill="#fff" strokeWidth="1.5"><DeviceSymbol type="junction-box"/></g>}
      {devicesVisible && preview.deviceNode && (()=>{const type=preview.deviceNode.deviceType,isPanel=type==='strong-panel'||type==='weak-panel',size=DEVICE_DEFAULTS[type].sizeMm,stroke=preview.deviceNode.valid?PLAN_COLORS[DEVICE_DEFAULTS[type].systems[0]]:'#ef4444';return <g data-device-preview-symbol={type} transform={`translate(${preview.deviceNode.position.position[0]} ${preview.deviceNode.position.position[2]}) rotate(${-rotation})${isPanel?'':` scale(${.018*annotationScale})`}`} stroke={stroke} fill="#fff" strokeWidth={isPanel?1.5/scale:1.5}>{isPanel?<><rect data-panel-real-size x={-size[0]/2000} y={-size[2]/2000} width={size[0]/1000} height={size[2]/1000}/>{type==='strong-panel'?<path d={`M${-size[0]*.32/1000} ${size[2]*.3/1000}L${size[0]*.32/1000} ${-size[2]*.3/1000}M${-size[0]*.32/1000} ${-size[2]*.3/1000}L${size[0]*.32/1000} ${size[2]*.3/1000}`}/>:<path d={`M${-size[0]*.3/1000} 0H${size[0]*.3/1000}`}/>}</>:<DeviceSymbol type={type}/>}</g>;})()}
    </g>}
  </g>;
}
