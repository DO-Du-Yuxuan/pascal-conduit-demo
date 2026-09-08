import type { NodeData } from '../types';
import type { ConduitOverlayDocument, HostAttachment, NetworkDevice, RouteSegment, RoutingSystem, Vec3 } from '../domain/overlay';
import { parseBuilding, levelForNode } from '../domain/building';
import { formatMeasurement, type MeasurementUnit } from '../geometry/manual-measurement';
import { DEVICE_DEFAULTS } from '../domain/devices';

export type Point = [number, number];
export type PlanAnnotation = {
  id: string; sourceId: string; relatedIds: string[]; levelId: string; anchor: Point;
  kind: 'height'; text: string; arrangement: 'single' | 'horizontal' | 'vertical'; rows: PlanAnnotationRow[];
  measurementBasis: 'explicit' | 'derived'; assumptions: string[]; confidence: 'high' | 'limited';
  witness?: [Point, Point];
};
export type PlanAnnotationRow = { sourceIds: string[]; editableSourceId: string; label: string; count: number; position?: string; height: string };
export type PlanNotice = { sourceId: string; text: string; levelId: string | null; anchor?: Point };
export type PointPositionDimension = { id:string; sourceId:string; levelId:string; wallId:string; reference:Point; center:Point; referenceWitness:Point; centerWitness:Point; direction:Point; normal:Point; lane:number; valueMeters:number; referenceKind:'opening-edge'|'wall-end'|'wall-face'|'device-center'; relatedIds:string[]; measurementBasis:'derived'; confidence:'high'|'limited'; assumptions:string[] };
export const MODEL_DATUM_NOTE = '墙面点位标高按设备下边缘相对当前 3D 模型楼层基准计算，与 3D“下边缘离地”一致；施工前仍需按完成面复核。';
/** Matches PascalScenePreview's numeric(level.level) * 3.2, including basements
 * and non-consecutive levels. Never substitute the sorted array index. */
export function modelLevelBase(nodes: Record<string, NodeData>, levelId: string): number {
  const value = nodes[levelId]?.level;
  return (typeof value === 'number' && Number.isFinite(value) ? value : 0) * 3.2;
}
export function deviceInstallationHeightMeters(device: NetworkDevice, nodes: Record<string, NodeData>, levelId: string): number {
  if (device.mount?.kind === 'reference-plane') return device.mount.elevationMm / 1000;
  return device.position.position[1] - device.sizeMm[1] / 2000 - modelLevelBase(nodes, levelId);
}
export const PLAN_COLORS: Record<RoutingSystem, string> = { receptacle: '#dc3434', lighting: '#2563c7', network: '#535861', sprinkler: '#208348' };
export const point2 = (p: Vec3): Point => [p[0], p[2]];
export function createPlanContext(nodes: Record<string, NodeData>, overlay: ConduitOverlayDocument, hidden: ReadonlySet<string> = new Set(), systemVisibility: Readonly<Record<RoutingSystem, boolean>> = overlay.settings.visibleSystems) {
  const scene = parseBuilding({ nodes });
  const hostLevel = (a?: HostAttachment): string | null => {
    if (!a || !scene.nodes[a.hostId]) return null;
    const resolved = levelForNode(scene, scene.nodes[a.hostId]);
    return resolved && (!a.levelId || a.levelId === resolved) ? resolved : null;
  };
  const hostHidden = (a?: HostAttachment) => Boolean(a && (hidden.has(a.hostId) || nodes[a.hostId]?.visible === false));
  const segmentLevels = new Map(overlay.segments.map(s => [s.id, [...new Set([hostLevel(s.start.attachment), hostLevel(s.end.attachment)].filter((x): x is string => !!x))]]));
  // Resolve unhosted components against all boundary hosts at once. A first-hit
  // propagation would incorrectly assign a suspended run spanning two floors.
  const neighbors = new Map(overlay.segments.map(s => [s.id, new Set<string>()]));
  const boundaryLevels = new Map<string, Set<string>>();
  for (const f of [...overlay.fittings, ...overlay.junctionBoxes]) {
    const ids = f.segmentIds.filter(id => neighbors.has(id));
    for (const id of ids) {
      ids.filter(other => other !== id).forEach(other => neighbors.get(id)!.add(other));
      const own = hostLevel(f.position.attachment);
      if (own) { const levels = boundaryLevels.get(id) ?? new Set<string>(); levels.add(own); boundaryLevels.set(id, levels); }
    }
  }
  const visited = new Set<string>();
  for (const [seed, initial] of segmentLevels) {
    if (initial.length || visited.has(seed)) continue;
    const component: string[] = [], levels = new Set<string>(), queue = [seed];
    while (queue.length) {
      const id = queue.pop()!; if (visited.has(id)) continue;
      visited.add(id); component.push(id);
      boundaryLevels.get(id)?.forEach(level => levels.add(level));
      for (const neighbor of neighbors.get(id) ?? []) {
        const known = segmentLevels.get(neighbor) ?? [];
        if (known.length) known.forEach(level => levels.add(level));
        else if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    component.forEach(id => segmentLevels.set(id, [...levels].sort()));
  }
  const deviceLevel = (d: NetworkDevice): string | null => {
    const own = hostLevel(d.position.attachment) ?? (d.mount?.kind === 'host' ? hostLevel(d.mount.attachment) : null);
    if (own) return own;
    if (d.mount?.kind === 'reference-plane') return scene.nodes[d.mount.levelId]?.type === 'level' ? d.mount.levelId : null;
    if (d.mount?.kind === 'segment') { const levels = segmentLevels.get(d.mount.segmentId) ?? []; return levels.length === 1 ? levels[0] : null; }
    return null;
  };
  const linkedLevel = (ids: string[], a?: HostAttachment) => {
    const own = hostLevel(a); if (own) return own;
    const levels = [...new Set(ids.flatMap(id => segmentLevels.get(id) ?? []))]; return levels.length === 1 ? levels[0] : null;
  };
  const segmentVisible = (s: RouteSegment) => systemVisibility[s.system] && !hidden.has(s.id) && !hostHidden(s.start.attachment) && !hostHidden(s.end.attachment);
  const deviceVisible = (d: NetworkDevice) => d.systems.some(s => systemVisibility[s]) && !hidden.has(d.id) && !hostHidden(d.position.attachment) && !(d.mount?.kind === 'host' && hostHidden(d.mount.attachment)) && !(d.mount?.kind === 'segment' && !d.position.attachment && !overlay.segments.some(s => s.id === (d.mount as { segmentId: string }).segmentId && segmentVisible(s)));
  return { scene, hostLevel, hostHidden, segmentLevels, deviceLevel, linkedLevel, segmentVisible, deviceVisible, hidden, systemVisibility };
}
export type PlanContext = ReturnType<typeof createPlanContext>;
export function buildPlanAnnotations(nodes: Record<string, NodeData>, overlay: ConduitOverlayDocument, levelId: string, unit: MeasurementUnit, context = createPlanContext(nodes, overlay)) {
  const annotations: PlanAnnotation[] = [], notices: PlanNotice[] = [];
  const units = unit === 'millimeters' ? ' mm' : '';
  const length = (m: number) => formatMeasurement(m, unit) + units;
  const devices: NetworkDevice[] = [];
  for (const d of overlay.devices.filter(context.deviceVisible)) {
    const level = context.deviceLevel(d);
    if (!level) { notices.push({ sourceId: d.id, levelId: null, text: '楼层归属不明，未绘制设备' }); continue; }
    const attachment = d.position.attachment ?? (d.mount?.kind === 'host' ? d.mount.attachment : undefined);
    if (level === levelId && attachment?.hostKind === 'wall') devices.push(d);
  }
  const terminal = (d:NetworkDevice)=>!DEVICE_DEFAULTS[d.deviceType].source;
  const remaining=new Set(devices.map(d=>d.id));
  while(remaining.size){
    const seed=devices.find(d=>remaining.has(d.id))!, group:NetworkDevice[]=[], queue=[seed];remaining.delete(seed.id);
    while(queue.length){const current=queue.pop()!;group.push(current);for(const peer of devices){if(!remaining.has(peer.id)||terminal(peer)!==terminal(current))continue;const a=current.position.attachment??(current.mount?.kind==='host'?current.mount.attachment:undefined),b=peer.position.attachment??(peer.mount?.kind==='host'?peer.mount.attachment:undefined);if(!a||!b||a.hostId!==b.hostId)continue;if(Math.hypot(current.position.position[0]-peer.position.position[0],current.position.position[2]-peer.position.position[2])<=.15){remaining.delete(peer.id);queue.push(peer);}}}
    const planPoints=group.map(d=>point2(d.position.position)),planSpread=Math.max(...planPoints.flatMap((p,i)=>planPoints.map(q=>Math.hypot(p[0]-q[0],p[1]-q[1])))),heightSpread=Math.max(...group.map(d=>d.position.position[1]))-Math.min(...group.map(d=>d.position.position[1])),arrangement:PlanAnnotation['arrangement']=group.length===1?'single':planSpread<=.15&&heightSpread>.15?'vertical':'horizontal';
    const wall=nodes[(group[0].position.attachment??(group[0].mount?.kind==='host'?group[0].mount.attachment:undefined))?.hostId??''];const direction:Array<number>=wall?.type==='wall'&&Array.isArray(wall.start)&&Array.isArray(wall.end)?[wall.end[0]-wall.start[0],wall.end[1]-wall.start[1]]:[1,0];
    group.sort((a,b)=>arrangement==='vertical'?b.position.position[1]-a.position.position[1]:(a.position.position[0]*direction[0]+a.position.position[2]*direction[1])-(b.position.position[0]*direction[0]+b.position.position[2]*direction[1]));
    const rawRows=group.map((d,index)=>({sourceIds:[d.id],editableSourceId:d.id,label:d.name.trim()||DEVICE_DEFAULTS[d.deviceType].label,count:1,position:group.length===1?undefined:arrangement==='vertical'?(index===0?'上':index===group.length-1?'下':'中'):(index===0?'左':index===group.length-1?'右':'中'),height:length(deviceInstallationHeightMeters(d,nodes,levelId))}));
    const rows=arrangement==='horizontal'?rawRows.reduce<typeof rawRows>((all,row)=>{const found=all.find(item=>item.label===row.label&&item.height===row.height);if(found){found.count++;found.sourceIds.push(...row.sourceIds);found.position=undefined;}else all.push(row);return all;},[]):rawRows;
    const anchor:[number,number]=[planPoints.reduce((s,p)=>s+p[0],0)/planPoints.length,planPoints.reduce((s,p)=>s+p[1],0)/planPoints.length],text=rows.map(row=>`${row.label}${row.count>1?` × ${row.count}`:''}${row.position?` ${row.position}`:''}\nH=${row.height}`).join('\n');
    annotations.push({id:`group:${group.map(d=>d.id).sort().join(':')}`,sourceId:group[0].id,relatedIds:group.map(d=>d.id),levelId,anchor,kind:'height',text,arrangement,rows,measurementBasis:'derived',confidence:'limited',assumptions:[MODEL_DATUM_NOTE]});
  }
  for (const box of overlay.junctionBoxes) {
    if (!context.systemVisibility[box.system] || context.hidden.has(box.id) || context.hostHidden(box.position.attachment)) continue;
    const level = context.linkedLevel(box.segmentIds, box.position.attachment);
    if (!level) notices.push({ sourceId: box.id, levelId: null, text: '楼层归属不明，未绘制检修盒' });
    else if (level === levelId && box.position.attachment?.hostKind === 'wall') { const height=length(box.position.position[1]-box.sizeMm[1]/2000-modelLevelBase(nodes,level)); annotations.push({id:`${box.id}:height`,sourceId:box.id,relatedIds:[box.id],levelId,anchor:point2(box.position.position),kind:'height',text:`检修盒\nH=${height}`,arrangement:'single',rows:[{sourceIds:[box.id],editableSourceId:box.id,label:'检修盒',count:1,height}],measurementBasis:'derived',confidence:'limited',assumptions:[MODEL_DATUM_NOTE]}); }
  }
  return { annotations, notices };
}

/** Derived, read-only centre positioning dimensions for reliable straight wall hosts. */
export function buildPointPositionDimensions(nodes:Record<string,NodeData>,overlay:ConduitOverlayDocument,levelId:string,context=createPlanContext(nodes,overlay)):PointPositionDimension[]{
  const dimensions:PointPositionDimension[]=[];
  const straightWalls=Object.values(nodes).filter((node):node is NodeData=>node.type==='wall'&&node.curveOffset===undefined&&Array.isArray(node.start)&&Array.isArray(node.end)&&context.hostLevel({hostId:node.id,hostKind:'wall',surface:'interior',normal:[0,0,1],levelId})===levelId);
  const wallEntries:Array<{device:NetworkDevice;wall:NodeData;start:Point;direction:Point;length:number;scalar:number;center:Point;normal:Point}>=[];
  for(const device of overlay.devices){
    if(!context.deviceVisible(device)||context.deviceLevel(device)!==levelId)continue;
    const attachment=device.position.attachment??(device.mount?.kind==='host'?device.mount.attachment:undefined),wall=attachment&&nodes[attachment.hostId];
    if(!attachment||attachment.hostKind!=='wall'||wall?.type!=='wall'||!Array.isArray(wall.start)||!Array.isArray(wall.end)||wall.curveOffset!==undefined)continue;
    const start:Point=[Number(wall.start[0]),Number(wall.start[1])],end:Point=[Number(wall.end[0]),Number(wall.end[1])],dx=end[0]-start[0],dz=end[1]-start[1],length=Math.hypot(dx,dz);
    if(!Number.isFinite(length)||length<1e-6)continue;
    const direction:Point=[dx/length,dz/length],center=point2(device.position.position),scalar=Math.max(0,Math.min(length,(center[0]-start[0])*direction[0]+(center[1]-start[1])*direction[1]));
    const normal:Point=attachment.normal?[attachment.normal[0],attachment.normal[2]]:[-direction[1],direction[0]],normalLength=Math.hypot(...normal),unitNormal:Point=normalLength>1e-6?[normal[0]/normalLength,normal[1]/normalLength]:[-direction[1],direction[0]];
    wallEntries.push({device,wall,start,direction,length,scalar,center,normal:unitNormal});
  }
  const wallGroups=new Map<string,typeof wallEntries>();
  wallEntries.forEach(entry=>{const key=`${entry.wall.id}:${entry.device.deviceType}`;wallGroups.set(key,[...(wallGroups.get(key)??[]),entry]);});
  [...wallGroups.values()].sort((a,b)=>a[0]!.wall.id.localeCompare(b[0]!.wall.id)||a[0]!.device.deviceType.localeCompare(b[0]!.device.deviceType)).forEach((group,lane)=>{
    const first=group[0]!,openings=Object.values(nodes).flatMap(node=>{if((node.type!=='door'&&node.type!=='window')||(node.wallId??node.parentId)!==first.wall.id||!Array.isArray(node.position)||!Number.isFinite(node.position[0])||!Number.isFinite(node.width))return [];const half=Number(node.width)/2;return [{scalar:Number(node.position[0])-half,kind:'opening-edge' as const},{scalar:Number(node.position[0])+half,kind:'opening-edge' as const}];}),candidates=[...openings,{scalar:0,kind:'wall-end' as const},{scalar:first.length,kind:'wall-end' as const}],reference=candidates.sort((a,b)=>Math.min(...group.map(item=>Math.abs(item.scalar-a.scalar)))-Math.min(...group.map(item=>Math.abs(item.scalar-b.scalar)))||a.scalar-b.scalar)[0]!,ordered=[...group].sort((a,b)=>(reference.scalar<=Math.min(...group.map(item=>item.scalar))?a.scalar-b.scalar:b.scalar-a.scalar)||a.device.id.localeCompare(b.device.id));
    let previousPoint:Point=[first.start[0]+first.direction[0]*reference.scalar,first.start[1]+first.direction[1]*reference.scalar],previousWitness=previousPoint,previousId:string|undefined;
    ordered.forEach((entry,index)=>{const center:[number,number]=[entry.start[0]+entry.direction[0]*entry.scalar,entry.start[1]+entry.direction[1]*entry.scalar];dimensions.push({id:`${entry.device.id}:position`,sourceId:entry.device.id,levelId,wallId:entry.wall.id,reference:previousPoint,center,referenceWitness:previousWitness,centerWitness:entry.center,direction:entry.direction,normal:entry.normal,lane,valueMeters:Math.abs(entry.scalar-(index===0?reference.scalar:ordered[index-1]!.scalar)),referenceKind:index===0?reference.kind:'device-center',relatedIds:[entry.device.id,entry.wall.id,...(previousId?[previousId]:[])],measurementBasis:'derived',confidence:'high',assumptions:['设备中心沿直墙宿主方向投影；首段以洞口边或墙端为模型定位基准，后续同类型点位标注中心距。']});previousPoint=center;previousWitness=entry.center;previousId=entry.device.id;});
  });
  for(const device of overlay.devices){
    if(!context.deviceVisible(device)||context.deviceLevel(device)!==levelId||!['luminaire','sprinkler-head'].includes(device.deviceType)||device.position.attachment?.hostKind==='wall')continue;
    const center=point2(device.position.position),candidates=straightWalls.flatMap(wall=>{const start:Point=[Number(wall.start![0]),Number(wall.start![1])],end:Point=[Number(wall.end![0]),Number(wall.end![1])],edge:Point=[end[0]-start[0],end[1]-start[1]],length=Math.hypot(...edge);if(length<1e-6)return [];const along:Point=[edge[0]/length,edge[1]/length],raw=(center[0]-start[0])*along[0]+(center[1]-start[1])*along[1];if(raw<0||raw>length)return [];const linePoint:Point=[start[0]+along[0]*raw,start[1]+along[1]*raw],delta:Point=[center[0]-linePoint[0],center[1]-linePoint[1]],distance=Math.hypot(...delta);if(distance<1e-6)return [];const toward:Point=[delta[0]/distance,delta[1]/distance],half=Math.max(0,Number(wall.thickness)||0)/2,reference:Point=[linePoint[0]+toward[0]*half,linePoint[1]+toward[1]*half],value=Math.max(0,distance-half);return [{wall,reference,direction:toward,value}];}).sort((a,b)=>a.value-b.value||a.wall.id.localeCompare(b.wall.id));
    const selected:typeof candidates=[];for(const candidate of candidates){if(!selected.length||Math.abs(candidate.direction[0]*selected[0].direction[0]+candidate.direction[1]*selected[0].direction[1])<.2)selected.push(candidate);if(selected.length===2)break;}
    selected.forEach((candidate,index)=>{const normal:Point=[-candidate.direction[1],candidate.direction[0]];dimensions.push({id:`${device.id}:position:${index+1}`,sourceId:device.id,levelId,wallId:candidate.wall.id,reference:candidate.reference,center,referenceWitness:candidate.reference,centerWitness:center,direction:candidate.direction,normal,lane:index,valueMeters:candidate.value,referenceKind:'wall-face',relatedIds:[device.id,candidate.wall.id],measurementBasis:'derived',confidence:'limited',assumptions:['顶面点位中心至实际投影落在有限直墙段内的模型墙面；施工前需复核完成面。']});});
  }
  return dimensions;
}
