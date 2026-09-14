import type { NodeData } from '../types';
import type { ConduitOverlayDocument, HostAttachment, NetworkDevice, RouteSegment, RoutingSystem, Vec3 } from '../domain/overlay';
import { parseBuilding, levelForNode } from '../domain/building';
import { formatMeasurement, type MeasurementUnit } from '../geometry/manual-measurement';
import { DEVICE_DEFAULTS } from '../domain/devices';
import { switchGangCount, switchGangLabel } from '../domain/lighting-controls';

export type Point = [number, number];
export type PlanAnnotation = {
  id: string; sourceId: string; relatedIds: string[]; levelId: string; anchor: Point;
  kind: 'height'; text: string; arrangement: 'single' | 'horizontal' | 'vertical'; rows: PlanAnnotationRow[];
  measurementBasis: 'explicit' | 'derived'; assumptions: string[]; confidence: 'high' | 'limited';
  witness?: [Point, Point];
};
export type PlanAnnotationRow = { sourceIds: string[]; editableSourceId: string; label: string; count: number; position?: string; height: string };
export type PlanNotice = { sourceId: string; text: string; levelId: string | null; anchor?: Point };
export type PointPositionDimension = { id:string; sourceId:string; levelId:string; wallId?:string; reference:Point; center:Point; referenceWitness:Point; centerWitness:Point; direction:Point; normal:Point; lane:number; valueMeters:number; referenceKind:'opening-edge'|'wall-end'|'wall-face'|'device-center'; relatedIds:string[]; measurementBasis:'derived'; confidence:'high'|'limited'; assumptions:string[] };
export const MODEL_DATUM_NOTE = '墙面点位标高按设备下边缘相对当前 3D 模型楼层基准计算，与 3D“下边缘离地”一致；施工前仍需按完成面复核。';
/** Matches PascalScenePreview's numeric(level.level) * 3.2, including basements
 * and non-consecutive levels. Never substitute the sorted array index. */
export function modelLevelBase(nodes: Record<string, NodeData>, levelId: string): number {
  const value = nodes[levelId]?.level;
  return (typeof value === 'number' && Number.isFinite(value) ? value : 0) * 3.2;
}
export const deviceHostAttachment = (device: NetworkDevice): HostAttachment | undefined =>
  device.position.attachment ?? (device.mount?.kind === 'host' ? device.mount.attachment : undefined);
export const isFloorSocket = (device: NetworkDevice): boolean =>
  device.deviceType === 'socket' && deviceHostAttachment(device)?.hostKind === 'slab';
export function deviceInstallationHeightMeters(device: NetworkDevice, nodes: Record<string, NodeData>, levelId: string): number {
  if (device.mount?.kind === 'reference-plane') return device.mount.elevationMm / 1000;
  if (isFloorSocket(device)) return 0;
  return device.position.position[1] - device.sizeMm[1] / 2000 - modelLevelBase(nodes, levelId);
}
export const PLAN_COLORS: Record<RoutingSystem, string> = { receptacle: '#dc3434', lighting: '#2563c7', network: '#535861', sprinkler: '#208348' };
export const point2 = (p: Vec3): Point => [p[0], p[2]];
export function devicePlanLabel(device: NetworkDevice, overlay: ConduitOverlayDocument): string {
  const source = device.name.trim();
  if (isFloorSocket(device) && (!source || source === DEVICE_DEFAULTS.socket.label)) return '地插';
  if (device.deviceType !== 'switch' || (source && source !== DEVICE_DEFAULTS.switch.label)) return source || DEVICE_DEFAULTS[device.deviceType].label;
  const gangs = switchGangCount(overlay, device.id);
  return gangs ? switchGangLabel(gangs) : DEVICE_DEFAULTS.switch.label;
}
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
    const rawRows=group.map((d,index)=>({sourceIds:[d.id],editableSourceId:d.id,label:devicePlanLabel(d,overlay),count:1,position:group.length===1?undefined:arrangement==='vertical'?(index===0?'上':index===group.length-1?'下':'中'):(index===0?'左':index===group.length-1?'右':'中'),height:length(deviceInstallationHeightMeters(d,nodes,levelId))}));
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
export function buildPointPositionDimensionReport(nodes:Record<string,NodeData>,overlay:ConduitOverlayDocument,levelId:string,context=createPlanContext(nodes,overlay)):{dimensions:PointPositionDimension[];notices:PlanNotice[]}{
  const dimensions:PointPositionDimension[]=[],notices:PlanNotice[]=[];
  const straightWalls=Object.values(nodes).filter((node):node is NodeData=>node.type==='wall'&&node.curveOffset===undefined&&Array.isArray(node.start)&&Array.isArray(node.end)&&context.hostLevel({hostId:node.id,hostKind:'wall',surface:'interior',normal:[0,0,1],levelId})===levelId);
  const wallEntries:Array<{device:NetworkDevice;wall:NodeData;start:Point;direction:Point;length:number;scalar:number;center:Point;normal:Point}>=[];
  for(const device of overlay.devices){
    if(!context.deviceVisible(device)||context.deviceLevel(device)!==levelId)continue;
    const attachment=device.position.attachment??(device.mount?.kind==='host'?device.mount.attachment:undefined),wall=attachment&&nodes[attachment.hostId];
    if(!attachment||attachment.hostKind!=='wall')continue;
    if(wall?.type!=='wall'||!Array.isArray(wall.start)||!Array.isArray(wall.end)||wall.curveOffset!==undefined){notices.push({sourceId:device.id,levelId,text:'该方向定位尺寸链未闭合',anchor:point2(device.position.position)});continue;}
    const start:Point=[Number(wall.start[0]),Number(wall.start[1])],end:Point=[Number(wall.end[0]),Number(wall.end[1])],dx=end[0]-start[0],dz=end[1]-start[1],length=Math.hypot(dx,dz);
    if(!Number.isFinite(length)||length<1e-6){notices.push({sourceId:device.id,levelId,text:'该方向定位尺寸链未闭合',anchor:point2(device.position.position)});continue;}
    const direction:Point=[dx/length,dz/length],center=point2(device.position.position),scalar=Math.max(0,Math.min(length,(center[0]-start[0])*direction[0]+(center[1]-start[1])*direction[1]));
    const normal:Point=attachment.normal?[attachment.normal[0],attachment.normal[2]]:[-direction[1],direction[0]],normalLength=Math.hypot(...normal),unitNormal:Point=normalLength>1e-6?[normal[0]/normalLength,normal[1]/normalLength]:[-direction[1],direction[0]];
    wallEntries.push({device,wall,start,direction,length,scalar,center,normal:unitNormal});
  }
  const wallGroups=new Map<string,typeof wallEntries>();
  wallEntries.forEach(entry=>{const system=entry.device.systems.find(candidate=>context.systemVisibility[candidate])??entry.device.systems[0]??'unknown',key=`${entry.wall.id}:${system}:${entry.device.deviceType}`;wallGroups.set(key,[...(wallGroups.get(key)??[]),entry]);});
  [...wallGroups.values()].sort((a,b)=>a[0]!.wall.id.localeCompare(b[0]!.wall.id)||a[0]!.device.deviceType.localeCompare(b[0]!.device.deviceType)).forEach((group,lane)=>{
    const first=group[0]!,openingRanges=Object.values(nodes).flatMap(node=>{if((node.type!=='door'&&node.type!=='window')||(node.wallId??node.parentId)!==first.wall.id||!Array.isArray(node.position)||!Number.isFinite(node.position[0])||!Number.isFinite(node.width))return [];const half=Number(node.width)/2;return [{id:node.id,start:Number(node.position[0])-half,end:Number(node.position[0])+half}];}).sort((a,b)=>a.start-b.start),candidates=[...openingRanges.flatMap(opening=>[{scalar:opening.start,kind:'opening-edge' as const,sourceId:opening.id},{scalar:opening.end,kind:'opening-edge' as const,sourceId:opening.id}]),{scalar:0,kind:'wall-end' as const,sourceId:first.wall.id},{scalar:first.length,kind:'wall-end' as const,sourceId:first.wall.id}].sort((a,b)=>a.scalar-b.scalar),ordered=[...group].sort((a,b)=>a.scalar-b.scalar||a.device.id.localeCompare(b.device.id)),runs:typeof wallEntries[]=[];
    for(const entry of ordered){const run=runs[runs.length-1],previous=run?.[run.length-1],separated=previous&&openingRanges.some(opening=>opening.start<entry.scalar-1e-6&&opening.end>previous.scalar+1e-6);if(!run||separated)runs.push([entry]);else run.push(entry);}
    for(const run of runs){const runFirst=run[0]!,runLast=run[run.length-1]!,left=candidates.filter(candidate=>candidate.scalar<=runFirst.scalar+1e-6).slice(-1)[0],right=candidates.find(candidate=>candidate.scalar>=runLast.scalar-1e-6);if(!left||!right)continue;
      let previousPoint:Point=[runFirst.start[0]+runFirst.direction[0]*left.scalar,runFirst.start[1]+runFirst.direction[1]*left.scalar],previousWitness=previousPoint,previousId:string|undefined;
      run.forEach((entry,index)=>{const center:Point=[entry.start[0]+entry.direction[0]*entry.scalar,entry.start[1]+entry.direction[1]*entry.scalar];dimensions.push({id:`${entry.device.id}:position:${lane}:${index}`,sourceId:entry.device.id,levelId,wallId:entry.wall.id,reference:previousPoint,center,referenceWitness:previousWitness,centerWitness:entry.center,direction:entry.direction,normal:entry.normal,lane,valueMeters:Math.abs(entry.scalar-(index===0?left.scalar:run[index-1]!.scalar)),referenceKind:index===0?left.kind:'device-center',relatedIds:[entry.device.id,entry.wall.id,...(index===0&&left.sourceId!==entry.wall.id?[left.sourceId]:[]),...(previousId?[previousId]:[])],measurementBasis:'derived',confidence:'high',assumptions:['同墙同类型点位形成闭合定位尺寸链；门窗洞口将尺寸链分开，端部止于洞口边或墙端。']});previousPoint=center;previousWitness=entry.center;previousId=entry.device.id;});
      const boundaryPoint:Point=[runLast.start[0]+runLast.direction[0]*right.scalar,runLast.start[1]+runLast.direction[1]*right.scalar],lastPoint:Point=[runLast.start[0]+runLast.direction[0]*runLast.scalar,runLast.start[1]+runLast.direction[1]*runLast.scalar];dimensions.push({id:`${runLast.device.id}:position:${lane}:end`,sourceId:runLast.device.id,levelId,wallId:runLast.wall.id,reference:boundaryPoint,center:lastPoint,referenceWitness:boundaryPoint,centerWitness:runLast.center,direction:runLast.direction,normal:runLast.normal,lane,valueMeters:Math.abs(right.scalar-runLast.scalar),referenceKind:right.kind,relatedIds:[runLast.device.id,runLast.wall.id,...(right.sourceId!==runLast.wall.id?[right.sourceId]:[])],measurementBasis:'derived',confidence:'high',assumptions:['同墙同类型点位形成闭合定位尺寸链；门窗洞口将尺寸链分开，端部止于洞口边或墙端。']});
    }
  });
  type PlaneEntry={device:NetworkDevice;center:Point;axis:Point;normal:Point;scalar:number;cross:number};
  const dot=(a:Point,b:Point)=>a[0]*b[0]+a[1]*b[1],cross=(a:Point,b:Point)=>a[0]*b[1]-a[1]*b[0],canonical=(axis:Point):Point=>axis[0]<-1e-6||(Math.abs(axis[0])<=1e-6&&axis[1]<0)?[-axis[0],-axis[1]]:axis;
  const openingsByWall=new Map<string,Array<{id:string;start:number;end:number}>>();
  Object.values(nodes).forEach(node=>{if((node.type!=='door'&&node.type!=='window')||!Number.isFinite(node.width)||!Array.isArray(node.position))return;const wallId=node.wallId??node.parentId;if(!wallId)return;const half=Number(node.width)/2,list=openingsByWall.get(wallId)??[];list.push({id:node.id,start:Number(node.position[0])-half,end:Number(node.position[0])+half});openingsByWall.set(wallId,list);});
  const segmentIntersection=(a:Point,b:Point,c:Point,d:Point)=>{const r:Point=[b[0]-a[0],b[1]-a[1]],s:Point=[d[0]-c[0],d[1]-c[1]],den=cross(r,s);if(Math.abs(den)<1e-8)return null;const ca:Point=[c[0]-a[0],c[1]-a[1]];return {t:cross(ca,s)/den,u:cross(ca,r)/den};};
  const crossesSolidWall=(a:Point,b:Point)=>straightWalls.some(wall=>{const start:Point=[Number(wall.start![0]),Number(wall.start![1])],end:Point=[Number(wall.end![0]),Number(wall.end![1])],hit=segmentIntersection(a,b,start,end);if(!hit||hit.t<=1e-5||hit.t>=1-1e-5||hit.u<0||hit.u>1)return false;const length=Math.hypot(end[0]-start[0],end[1]-start[1]),along=hit.u*length;return !(openingsByWall.get(wall.id)??[]).some(opening=>along>=opening.start-1e-6&&along<=opening.end+1e-6);});
  const orientationGroups:Array<{axis:Point;length:number}>=[];
  for(const wall of straightWalls){const dx=Number(wall.end![0])-Number(wall.start![0]),dz=Number(wall.end![1])-Number(wall.start![1]),length=Math.hypot(dx,dz);if(length<1e-6)continue;const axis=canonical([dx/length,dz/length]),group=orientationGroups.find(item=>Math.abs(dot(item.axis,axis))>=.98);if(group)group.length+=length;else orientationGroups.push({axis,length});}
  const primaryAxis=orientationGroups.sort((a,b)=>b.length-a.length)[0]?.axis,planAxes:Point[]=primaryAxis?[primaryAxis,canonical([-primaryAxis[1],primaryAxis[0]])]:[];
  const entries:PlaneEntry[]=[];
  for(const device of overlay.devices){
    if(!context.deviceVisible(device)||context.deviceLevel(device)!==levelId||deviceHostAttachment(device)?.hostKind==='wall')continue;
    const center=point2(device.position.position);
    if(planAxes.length<2)notices.push({sourceId:device.id,levelId,text:'该方向定位尺寸链未闭合',anchor:center});
    planAxes.forEach(axis=>{const normal:Point=[-axis[1],axis[0]];entries.push({device,center,axis,normal,scalar:dot(center,axis),cross:dot(center,normal)});});
  }
  const planeGroups=new Map<string,PlaneEntry[]>();
  entries.forEach(entry=>{const host=deviceHostAttachment(entry.device)?.hostKind??entry.device.mount?.kind??'floating',system=entry.device.systems.find(candidate=>context.systemVisibility[candidate])??entry.device.systems[0],axisKey=`${Math.round(entry.axis[0]*1000)}:${Math.round(entry.axis[1]*1000)}`,key=`${system}:${entry.device.deviceType}:${host}:${axisKey}`;planeGroups.set(key,[...(planeGroups.get(key)??[]),entry]);});
  const boundary=(entry:PlaneEntry,rowCross:number,side:-1|1)=>{const origin:Point=[entry.axis[0]*entry.scalar+entry.normal[0]*rowCross,entry.axis[1]*entry.scalar+entry.normal[1]*rowCross],rayEnd:Point=[origin[0]+entry.axis[0]*side*1e5,origin[1]+entry.axis[1]*side*1e5];return straightWalls.flatMap(wall=>{const start:Point=[Number(wall.start![0]),Number(wall.start![1])],end:Point=[Number(wall.end![0]),Number(wall.end![1])],hit=segmentIntersection(origin,rayEnd,start,end);if(!hit||hit.t<=1e-9||hit.u<0||hit.u>1)return [];const length=Math.hypot(end[0]-start[0],end[1]-start[1]),along=hit.u*length,opening=(openingsByWall.get(wall.id)??[]).find(item=>along>=item.start&&along<=item.end),wallDirection:Point=[(end[0]-start[0])/length,(end[1]-start[1])/length],half=Math.max(0,Number(wall.thickness)||0)/2,boundaryScalar=dot([start[0]+(end[0]-start[0])*hit.u,start[1]+(end[1]-start[1])*hit.u],entry.axis)-side*half,point:Point=[entry.axis[0]*boundaryScalar+entry.normal[0]*rowCross,entry.axis[1]*boundaryScalar+entry.normal[1]*rowCross],edge=opening?(Math.abs(along-opening.start)<=Math.abs(opening.end-along)?opening.start:opening.end):along,witness:Point=[start[0]+wallDirection[0]*edge-entry.axis[0]*side*half,start[1]+wallDirection[1]*edge-entry.axis[1]*side*half];return [{wall,point,witness,kind:opening?'opening-edge' as const:'wall-face' as const,openingId:opening?.id,distance:Math.abs(boundaryScalar-entry.scalar),direction:entry.axis,normal:entry.normal}];}).sort((a,b)=>a.distance-b.distance||a.wall.id.localeCompare(b.wall.id))[0]??null;};
  let planeLane=0;
  for(const group of planeGroups.values()){
    const rows:PlaneEntry[][]=[];for(const entry of [...group].sort((a,b)=>a.cross-b.cross||a.scalar-b.scalar)){const row=rows.find(items=>Math.max(...items.map(item=>item.cross),entry.cross)-Math.min(...items.map(item=>item.cross),entry.cross)<=.100001);if(row)row.push(entry);else rows.push([entry]);}
    for(const row of rows){const sorted=[...row].sort((a,b)=>a.scalar-b.scalar||a.device.id.localeCompare(b.device.id)),runs:PlaneEntry[][]=[];for(const entry of sorted){const current=runs[runs.length-1];if(!current||crossesSolidWall(current[current.length-1]!.center,entry.center))runs.push([entry]);else current.push(entry);}
      for(const run of runs){const first=run[0]!,last=run[run.length-1]!,rowCross=run.reduce((sum,item)=>sum+item.cross,0)/run.length,left=boundary(first,rowCross,-1),right=boundary(last,rowCross,1),normal=first.normal,lane=planeLane++;
        const projected=(entry:PlaneEntry):Point=>[entry.axis[0]*entry.scalar+entry.normal[0]*rowCross,entry.axis[1]*entry.scalar+entry.normal[1]*rowCross];
        if(left){dimensions.push({id:`${first.device.id}:position:${lane}:start`,sourceId:first.device.id,levelId,wallId:left.wall.id,reference:left.point,center:projected(first),referenceWitness:left.witness,centerWitness:first.center,direction:left.direction,normal:left.normal,lane:0,valueMeters:left.distance,referenceKind:left.kind,relatedIds:[first.device.id,left.wall.id,...(left.openingId?[left.openingId]:[])],measurementBasis:'derived',confidence:'limited',assumptions:['同专业、同类型、同安装面的近似共线点位形成闭合定位尺寸链；边界为该方向首先到达的可靠墙面或洞口边。']});}
        run.slice(1).forEach((entry,index)=>{const previous=run[index]!;dimensions.push({id:`${entry.device.id}:position:${lane}:chain`,sourceId:entry.device.id,levelId,reference:projected(previous),center:projected(entry),referenceWitness:previous.center,centerWitness:entry.center,direction:first.axis,normal,lane:0,valueMeters:Math.abs(entry.scalar-previous.scalar),referenceKind:'device-center',relatedIds:[previous.device.id,entry.device.id],measurementBasis:'derived',confidence:'limited',assumptions:['点位中心垂直于尺寸链方向的模型偏差不超过 100 mm，按同一排或同一列表达。']});});
        if(right){dimensions.push({id:`${last.device.id}:position:${lane}:end`,sourceId:last.device.id,levelId,wallId:right.wall.id,reference:right.point,center:projected(last),referenceWitness:right.witness,centerWitness:last.center,direction:right.direction,normal:right.normal,lane:0,valueMeters:right.distance,referenceKind:right.kind,relatedIds:[last.device.id,right.wall.id,...(right.openingId?[right.openingId]:[])],measurementBasis:'derived',confidence:'limited',assumptions:['同专业、同类型、同安装面的近似共线点位形成闭合定位尺寸链；边界为该方向首先到达的可靠墙面或洞口边。']});}
        if(!left||!right)notices.push({sourceId:first.device.id,levelId,text:'该方向定位尺寸链未闭合',anchor:first.center});
      }
    }
  }
  return {dimensions,notices:[...new Map(notices.map(notice=>[`${notice.sourceId}:${notice.text}`,notice])).values()]};
}
export function buildPointPositionDimensions(nodes:Record<string,NodeData>,overlay:ConduitOverlayDocument,levelId:string,context=createPlanContext(nodes,overlay)):PointPositionDimension[]{return buildPointPositionDimensionReport(nodes,overlay,levelId,context).dimensions;}
