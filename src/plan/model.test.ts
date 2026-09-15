import { describe, expect, it } from 'vitest';
import type { NodeData } from '../types';
import { createEmptyOverlay, type HostAttachment, type NetworkDevice, type RouteSegment } from '../domain/overlay';
import { buildPlanAnnotations, buildPointPositionDimensionReport, buildPointPositionDimensions, createPlanContext } from './model';

const nodes = { l0: { id: 'l0', type: 'level', level: 0 }, l1: { id: 'l1', type: 'level', level: 1 }, w: { id: 'w', type: 'wall', parentId: 'l0', start: [0, 0], end: [4, 0] }, w1: { id: 'w1', type: 'wall', parentId: 'l1', start: [0, 0], end: [4, 0] } } as unknown as Record<string, NodeData>;
const host = (id = 'w', levelId = 'l0'): HostAttachment => ({ hostId: id, hostKind: 'wall', levelId, surface: 'front', normal: [0, 0, 1] });
const device = (id = 'd', x = 1): NetworkDevice => ({ id, type: 'network-device', deviceType: 'socket', name: '插座', position: { position: [x, .3, .1], attachment: host() }, sizeMm: [86, 86, 50], orientation: [0, 0, 0], systems: ['receptacle'], ports: [], createdAt: '' });
const segment = (id: string, start: [number, number, number], end: [number, number, number]): RouteSegment => ({ id, type: 'conduit-segment', system: 'receptacle', diameterMm: 20, start: { position: start, attachment: host() }, end: { position: end, attachment: host() }, createdAt: '' });

describe('2D point annotations', () => {
  it('shows device type and height without a generated point number', () => {
    const overlay = createEmptyOverlay('a', 'sha'); overlay.devices = [device()];
    const report = buildPlanAnnotations(nodes, overlay, 'l0', 'millimeters');
    expect(report.annotations).toHaveLength(1);
    expect(report.annotations[0].text).toBe('插座\nH=257 mm');
    expect(report.annotations[0].rows[0]).toMatchObject({label:'插座',height:'257 mm'});
    expect(report.annotations[0].text).not.toMatch(/管径|上行|下行|墙端|模型层基准/);
  });

  it('derives switch gang text from persisted independent control groups', () => {
    const overlay = createEmptyOverlay('a', 'sha'), wallSwitch = { ...device('switch'), deviceType: 'switch' as const, name: '开关', systems: ['lighting' as const] };
    overlay.devices = [wallSwitch];
    overlay.lightingControlGroups = [
      { id: 'a', switchDeviceId: wallSwitch.id, luminaireDeviceIds: ['light-a'], createdAt: '' },
      { id: 'b', switchDeviceId: wallSwitch.id, luminaireDeviceIds: ['light-b'], createdAt: '' },
    ];
    expect(buildPlanAnnotations(nodes, overlay, 'l0', 'millimeters').annotations[0].text).toBe('双开开关\nH=257 mm');
    wallSwitch.name = '玄关总控';
    expect(buildPlanAnnotations(nodes, overlay, 'l0', 'millimeters').annotations[0].text).toBe('玄关总控\nH=257 mm');
  });

  it('keeps editable names through movement and formats model-derived heights', () => {
    const overlay = createEmptyOverlay('a', 'sha'), original = device(); overlay.devices = [original, device('other')];
    original.name='五孔墙身插座';const before = JSON.stringify(overlay);
    const moved = { ...overlay, devices: [{ ...original, position: { ...original.position, position: [2, .6, .1] as [number, number, number] } }] };
    const report = buildPlanAnnotations(nodes, moved, 'l0', 'millimeters');
    expect(report.annotations[0].text).toBe('五孔墙身插座\nH=557 mm');
    expect(buildPlanAnnotations(nodes, moved, 'l0', 'feet-inches').annotations[0].text).not.toContain('mm');
    expect(buildPlanAnnotations(nodes, { ...overlay, devices: [] }, 'l0', 'millimeters').annotations).toEqual([]);
    expect(JSON.stringify(overlay)).toBe(before);
  });

  it('resolves segment-mounted devices and excludes ambiguous or hidden systems', () => {
    const overlay = createEmptyOverlay('a', 'sha'), mounted = device(); delete mounted.position.attachment; mounted.mount = { kind: 'segment', segmentId: 's', t: .5, tangent: [1, 0, 0] };
    overlay.devices = [mounted]; overlay.segments = [segment('s', [0, 0, 0], [2, 0, 0])];
    expect(createPlanContext(nodes, overlay).deviceLevel(mounted)).toBe('l0');
    overlay.segments[0].end.attachment = host('w1', 'l1');
    expect(createPlanContext(nodes, overlay).deviceLevel(mounted)).toBeNull();
    expect(buildPlanAnnotations(nodes, overlay, 'l0', 'millimeters').notices[0].sourceId).toBe('d');
    const hiddenSystems = { ...overlay.settings.visibleSystems, receptacle: false };
    expect(buildPlanAnnotations(nodes, overlay, 'l0', 'millimeters', createPlanContext(nodes, overlay, new Set(), hiddenSystems)).annotations).toHaveLength(0);
  });

  it('uses a unique rooted circuit level for legacy floating segment devices', () => {
    const overlay = createEmptyOverlay('a', 'sha'), source = { ...device('source'), deviceType: 'strong-panel' as const }, mounted = { ...device('mounted'), position: { position: [1, 2, 0] as [number, number, number] }, mount: { kind: 'segment' as const, segmentId: 'floating', t: .5, tangent: [1, 0, 0] as [number, number, number], circuitId: 'circuit' } };
    overlay.devices = [source, mounted];
    overlay.segments = [{ ...segment('floating', [0, 2, 0], [2, 2, 0]), start: { position: [0, 2, 0] }, end: { position: [2, 2, 0] }, circuitId: 'circuit' }];
    overlay.circuits = [{ id: 'circuit', system: 'receptacle', sourceDeviceId: source.id, rootPortId: null, segmentIds: ['floating'], status: 'rooted', createdAt: '' }];
    expect(createPlanContext(nodes, overlay).deviceLevel(mounted)).toBe('l0');
  });

  it('keeps a connected wall device visible when splitting leaves a stale segment mount id',()=>{
    const overlay=createEmptyOverlay('a','sha'),connected=device();connected.mount={kind:'segment',segmentId:'split-away',t:1,tangent:[0,1,0]};overlay.devices=[connected];
    const context=createPlanContext(nodes,overlay);
    expect(context.deviceVisible(connected)).toBe(true);
    expect(buildPlanAnnotations(nodes,overlay,'l0','millimeters').annotations).toHaveLength(1);
  });
  it('inherits a valid level from an installation reference plane mount',()=>{
    const overlay=createEmptyOverlay('a','sha'),light={...device('light'),deviceType:'luminaire' as const,systems:['lighting' as const],position:{position:[1,1.5,2] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l0',elevationMm:1500}};
    overlay.devices=[light];
    const context=createPlanContext(nodes,overlay);
    expect(context.deviceLevel(light)).toBe('l0');
    expect(buildPlanAnnotations(nodes,overlay,'l0','millimeters',context).annotations).toHaveLength(0);
  });

  it('uses the actual model level value for basement and skipped floors', () => {
    const overlay = createEmptyOverlay('a', 'sha'), altered = { ...nodes, l0: { ...nodes.l0, level: -1 }, l1: { ...nodes.l1, level: 3 } };
    const point = device(); point.position.position = [1, -2.9, .1]; overlay.devices = [point];
    expect(buildPlanAnnotations(altered, overlay, 'l0', 'millimeters').annotations[0].text).toContain('H=257 mm');
    point.position = { position: [1, 9.9, .1], attachment: host('w1', 'l1') };
    expect(buildPlanAnnotations(altered, overlay, 'l1', 'millimeters').annotations[0].text).toContain('H=257 mm');
  });

  it('groups 150 mm same-wall gangs and derives horizontal or vertical positions',()=>{
    const overlay=createEmptyOverlay('a','sha');overlay.devices=[device('a',1),device('b',1.1)];
    let annotation=buildPlanAnnotations(nodes,overlay,'l0','millimeters').annotations[0];
    expect(annotation.arrangement).toBe('horizontal');expect(annotation.rows[0]).toMatchObject({label:'插座',count:2,position:undefined});
    overlay.devices=[device('top',1),{...device('bottom',1),position:{...device('bottom',1).position,position:[1,.8,.1]}}];
    annotation=buildPlanAnnotations(nodes,overlay,'l0','millimeters').annotations[0];
    expect(annotation.arrangement).toBe('vertical');expect(annotation.rows.map(row=>row.position)).toEqual(['上','下']);
  });

  it('does not create any annotation for pipe direction or size', () => {
    const overlay = createEmptyOverlay('a', 'sha'); overlay.segments = [segment('riser', [1, 0, 0], [1, 2, 0])];
    expect(buildPlanAnnotations(nodes, overlay, 'l0', 'millimeters')).toEqual({ annotations: [], notices: [] });
  });

  it('closes each wall-device chain between its nearest opening edge or wall end',()=>{
    const overlay=createEmptyOverlay('a','sha'),nearOpening=device('near-opening',3.2),nearEnd={...device('near-end',.4),deviceType:'switch' as const,systems:['lighting' as const]};overlay.devices=[nearOpening,nearEnd];
    const withOpening={...nodes,door:{id:'door',type:'door',parentId:'w',wallId:'w',position:[2,1,0],width:1}} as Record<string,NodeData>;
    const dimensions=buildPointPositionDimensions(withOpening,overlay,'l0');
    expect(dimensions.map(d=>({id:d.sourceId,value:Math.round(d.valueMeters*1000),basis:d.referenceKind}))).toEqual([{id:'near-opening',value:700,basis:'opening-edge'},{id:'near-opening',value:800,basis:'wall-end'},{id:'near-end',value:400,basis:'wall-end'},{id:'near-end',value:1100,basis:'opening-edge'}]);
    expect(dimensions.every(d=>d.measurementBasis==='derived'&&d.confidence==='high')).toBe(true);
  });

  it('chains same-type wall devices from one reference through their centres',()=>{
    const overlay=createEmptyOverlay('a','sha');overlay.devices=[device('a',.8),device('b',1.2),device('c',1.8)];
    const dimensions=buildPointPositionDimensions(nodes,overlay,'l0');
    expect(dimensions.map(d=>({basis:d.referenceKind,value:Math.round(d.valueMeters*1000),lane:d.lane}))).toEqual([{basis:'wall-end',value:800,lane:0},{basis:'device-center',value:400,lane:0},{basis:'device-center',value:600,lane:0},{basis:'wall-end',value:2200,lane:0}]);
  });

  it('splits a same-wall chain at an opening instead of dimensioning through it',()=>{
    const overlay=createEmptyOverlay('a','sha');overlay.devices=[device('left',1),device('right',3)];
    const withDoor={...nodes,door:{id:'door',type:'door',parentId:'w',wallId:'w',position:[2,1,0],width:1}} as Record<string,NodeData>;
    const dimensions=buildPointPositionDimensions(withDoor,overlay,'l0');
    expect(dimensions.map(d=>({basis:d.referenceKind,value:Math.round(d.valueMeters*1000)}))).toEqual([{basis:'wall-end',value:1000},{basis:'opening-edge',value:500},{basis:'opening-edge',value:500},{basis:'wall-end',value:1000}]);
    expect(dimensions.some(d=>d.referenceKind==='device-center')).toBe(false);
  });

  it('closes both orthogonal position chains for a reference-plane luminaire',()=>{
    const overlay=createEmptyOverlay('a','sha'),light={...device('light'),deviceType:'luminaire' as const,systems:['lighting' as const],position:{position:[2,1.5,3] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l0',elevationMm:1500}};
    overlay.devices=[light];
    const rectangle={...nodes,west:{id:'west',type:'wall',parentId:'l0',start:[0,0],end:[0,6],thickness:.2},east:{id:'east',type:'wall',parentId:'l0',start:[6,0],end:[6,6],thickness:.2},north:{id:'north',type:'wall',parentId:'l0',start:[0,0],end:[6,0],thickness:.2},south:{id:'south',type:'wall',parentId:'l0',start:[0,6],end:[6,6],thickness:.2}} as Record<string,NodeData>;
    const dimensions=buildPointPositionDimensions(rectangle,overlay,'l0').filter(d=>d.sourceId==='light');
    expect(dimensions).toHaveLength(4);
    expect(dimensions.map(d=>Math.round(d.valueMeters*1000)).sort((a,b)=>a-b)).toEqual([1900,2900,2900,3900]);
    expect(dimensions.every(d=>d.referenceKind==='wall-face')).toBe(true);
  });

  it('derives two orthogonal position dimensions for floor and ceiling sockets',()=>{
    const overlay=createEmptyOverlay('a','sha'),rectangle={...nodes,west:{id:'west',type:'wall',parentId:'l0',start:[0,0],end:[0,6],thickness:.2},east:{id:'east',type:'wall',parentId:'l0',start:[6,0],end:[6,6],thickness:.2},north:{id:'north',type:'wall',parentId:'l0',start:[0,0],end:[6,0],thickness:.2},south:{id:'south',type:'wall',parentId:'l0',start:[0,6],end:[6,6],thickness:.2},floor:{id:'floor',type:'slab',parentId:'l0',polygon:[[0,0],[6,0],[6,6],[0,6]]},ceiling:{id:'ceiling',type:'ceiling',parentId:'l0',polygon:[[0,0],[6,0],[6,6],[0,6]]}} as Record<string,NodeData>;
    const floorSocket={...device('floor-socket'),position:{position:[1,0,2] as [number,number,number],attachment:{hostId:'floor',hostKind:'slab' as const,surface:'top',normal:[0,1,0] as [number,number,number],levelId:'l0'}}},ceilingSocket={...device('ceiling-socket'),position:{position:[3,2.7,4] as [number,number,number],attachment:{hostId:'ceiling',hostKind:'ceiling' as const,surface:'bottom',normal:[0,-1,0] as [number,number,number],levelId:'l0'}}};
    overlay.devices=[floorSocket,ceilingSocket];
    const context=createPlanContext(rectangle,overlay);
    expect([floorSocket,ceilingSocket].map(item=>[context.deviceLevel(item),context.deviceVisible(item)])).toEqual([['l0',true],['l0',true]]);
    const dimensions=buildPointPositionDimensions(rectangle,overlay,'l0',context);
    expect(dimensions.filter(d=>d.sourceId==='floor-socket')).toHaveLength(4);
    expect(dimensions.filter(d=>d.sourceId==='ceiling-socket')).toHaveLength(4);
  });

  it('forms one closed point-position chain for collinear ceiling devices',()=>{
    const overlay=createEmptyOverlay('a','sha'),rectangle={...nodes,west:{id:'west',type:'wall',parentId:'l0',start:[0,0],end:[0,6],thickness:.2},east:{id:'east',type:'wall',parentId:'l0',start:[6,0],end:[6,6],thickness:.2},north:{id:'north',type:'wall',parentId:'l0',start:[0,0],end:[6,0],thickness:.2},south:{id:'south',type:'wall',parentId:'l0',start:[0,6],end:[6,6],thickness:.2}} as Record<string,NodeData>;
    overlay.devices=[2,4].map((x,index)=>({...device(`light-${index}`),deviceType:'luminaire' as const,systems:['lighting' as const],position:{position:[x,2.7,3] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l0',elevationMm:2700}}));
    const horizontal=buildPointPositionDimensions(rectangle,overlay,'l0').filter(d=>Math.abs(d.direction[0])>.9);
    expect(horizontal.map(d=>({basis:d.referenceKind,value:Math.round(d.valueMeters*1000)}))).toEqual([{basis:'wall-face',value:1900},{basis:'device-center',value:2000},{basis:'wall-face',value:1900}]);
  });

  it('reports a point-position chain when one side has no reliable wall',()=>{
    const overlay=createEmptyOverlay('a','sha'),light={...device('open-light'),deviceType:'luminaire' as const,systems:['lighting' as const],position:{position:[2,2.7,3] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l0',elevationMm:2700}};overlay.devices=[light];
    const openPlan={l0:nodes.l0,west:{id:'west',type:'wall',parentId:'l0',start:[0,0],end:[0,6],thickness:.2}} as Record<string,NodeData>;
    const report=buildPointPositionDimensionReport(openPlan,overlay,'l0');
    expect(report.dimensions).toHaveLength(1);
    expect(report.notices).toEqual([expect.objectContaining({sourceId:'open-light',levelId:'l0',text:'该方向定位尺寸链未闭合'})]);
    const withoutWalls=buildPointPositionDimensionReport({l0:nodes.l0} as Record<string,NodeData>,overlay,'l0');
    expect(withoutWalls.dimensions).toEqual([]);
    expect(withoutWalls.notices).toEqual([expect.objectContaining({sourceId:'open-light',text:'该方向定位尺寸链未闭合'})]);
  });

  it('groups points within 100 mm and splits a chain when a solid wall intervenes',()=>{
    const rectangle={...nodes,west:{id:'west',type:'wall',parentId:'l0',start:[0,0],end:[0,6],thickness:.2},east:{id:'east',type:'wall',parentId:'l0',start:[6,0],end:[6,6],thickness:.2},north:{id:'north',type:'wall',parentId:'l0',start:[0,0],end:[6,0],thickness:.2},south:{id:'south',type:'wall',parentId:'l0',start:[0,6],end:[6,6],thickness:.2}} as Record<string,NodeData>,makeOverlay=(offset:number)=>{const overlay=createEmptyOverlay('a','sha');overlay.devices=[[2,3],[4,3+offset]].map(([x,z],index)=>({...device(`light-${index}`),deviceType:'luminaire' as const,systems:['lighting' as const],position:{position:[x,2.7,z] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l0',elevationMm:2700}}));return overlay;};
    const within=buildPointPositionDimensions(rectangle,makeOverlay(.1),'l0').filter(d=>Math.abs(d.direction[0])>.9);
    expect(within.some(d=>d.referenceKind==='device-center')).toBe(true);
    const outside=buildPointPositionDimensions(rectangle,makeOverlay(.101),'l0').filter(d=>Math.abs(d.direction[0])>.9);
    expect(outside.some(d=>d.referenceKind==='device-center')).toBe(false);
    const divided={...rectangle,partition:{id:'partition',type:'wall',parentId:'l0',start:[3,0],end:[3,6],thickness:.2}} as Record<string,NodeData>;
    const split=buildPointPositionDimensions(divided,makeOverlay(0),'l0').filter(d=>Math.abs(d.direction[0])>.9);
    expect(split.some(d=>d.referenceKind==='device-center')).toBe(false);
  });

  it('does not let an evolving row average exceed the 100 mm collinearity span',()=>{
    const rectangle={...nodes,west:{id:'west',type:'wall',parentId:'l0',start:[0,0],end:[0,6],thickness:.2},east:{id:'east',type:'wall',parentId:'l0',start:[6,0],end:[6,6],thickness:.2},north:{id:'north',type:'wall',parentId:'l0',start:[0,0],end:[6,0],thickness:.2},south:{id:'south',type:'wall',parentId:'l0',start:[0,6],end:[6,6],thickness:.2}} as Record<string,NodeData>,overlay=createEmptyOverlay('a','sha');
    overlay.devices=[[2,3],[3,3.1],[4,3.15]].map(([x,z],index)=>({...device(`light-${index}`),deviceType:'luminaire' as const,systems:['lighting' as const],position:{position:[x,2.7,z] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l0',elevationMm:2700}}));
    const horizontal=buildPointPositionDimensions(rectangle,overlay,'l0').filter(d=>d.referenceKind==='device-center'&&Math.abs(d.direction[0])>.9);
    expect(horizontal).toHaveLength(1);
  });

  it('supports a non-wall fire inlet and reports unsupported curved wall positioning',()=>{
    const rectangle={...nodes,west:{id:'west',type:'wall',parentId:'l0',start:[0,0],end:[0,6],thickness:.2},east:{id:'east',type:'wall',parentId:'l0',start:[6,0],end:[6,6],thickness:.2},north:{id:'north',type:'wall',parentId:'l0',start:[0,0],end:[6,0],thickness:.2},south:{id:'south',type:'wall',parentId:'l0',start:[0,6],end:[6,6],thickness:.2},ceiling:{id:'ceiling',type:'ceiling',parentId:'l0',polygon:[[0,0],[6,0],[6,6],[0,6]]}} as Record<string,NodeData>,overlay=createEmptyOverlay('a','sha');
    overlay.devices=[{...device('fire'),deviceType:'fire-inlet' as const,systems:['sprinkler' as const],position:{position:[3,2.7,3] as [number,number,number],attachment:{hostId:'ceiling',hostKind:'ceiling' as const,surface:'bottom',normal:[0,-1,0] as [number,number,number],levelId:'l0'}}}];
    expect(buildPointPositionDimensions(rectangle,overlay,'l0').filter(d=>d.sourceId==='fire')).toHaveLength(4);
    const curved={...nodes,w:{...nodes.w,curveOffset:.5}} as Record<string,NodeData>,wallOverlay=createEmptyOverlay('a','sha');wallOverlay.devices=[device('curved',1)];
    expect(buildPointPositionDimensionReport(curved,wallOverlay,'l0').notices).toContainEqual(expect.objectContaining({sourceId:'curved',text:'该方向定位尺寸链未闭合'}));
    const degenerate={...nodes,w:{...nodes.w,start:[0,0],end:[0,0]}} as Record<string,NodeData>;
    expect(buildPointPositionDimensionReport(degenerate,wallOverlay,'l0').notices).toContainEqual(expect.objectContaining({sourceId:'curved',text:'该方向定位尺寸链未闭合'}));
  });

  it('uses an opening edge when the first boundary wall is open at the dimension ray',()=>{
    const overlay=createEmptyOverlay('a','sha'),light={...device('light'),deviceType:'luminaire' as const,systems:['lighting' as const],position:{position:[2,2.7,3] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l0',elevationMm:2700}};overlay.devices=[light];
    const plan={l0:nodes.l0,west:{id:'west',type:'wall',parentId:'l0',start:[0,0],end:[0,6],thickness:.2},east:{id:'east',type:'wall',parentId:'l0',start:[6,0],end:[6,6],thickness:.2},door:{id:'door',type:'door',parentId:'west',wallId:'west',position:[3,1,0],width:1}} as Record<string,NodeData>;
    const openingDimension=buildPointPositionDimensions(plan,overlay,'l0').find(d=>d.referenceKind==='opening-edge'&&d.relatedIds.includes('door'));
    expect(openingDimension).toBeDefined();
    expect(openingDimension!.valueMeters).toBeCloseTo(1.9);
    expect(openingDimension!.referenceWitness[1]).toBeCloseTo(2.5);
    expect(Math.abs(openingDimension!.direction[0])<1e-6||Math.abs(openingDimension!.direction[1])<1e-6).toBe(true);
  });

  it('keeps ceiling point dimensions on the two building axes despite nearby angled walls and openings',()=>{
    const overlay=createEmptyOverlay('a','sha'),light={...device('light'),deviceType:'luminaire' as const,systems:['lighting' as const],position:{position:[3,2.7,3] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l0',elevationMm:2700}};overlay.devices=[light];
    const plan={l0:nodes.l0,west:{id:'west',type:'wall',parentId:'l0',start:[0,0],end:[0,6],thickness:.2},east:{id:'east',type:'wall',parentId:'l0',start:[6,0],end:[6,6],thickness:.2},north:{id:'north',type:'wall',parentId:'l0',start:[0,0],end:[6,0],thickness:.2},south:{id:'south',type:'wall',parentId:'l0',start:[0,6],end:[6,6],thickness:.2},angled:{id:'angled',type:'wall',parentId:'l0',start:[2.6,2.4],end:[3.6,3.4],thickness:.2},door:{id:'door',type:'door',parentId:'west',wallId:'west',position:[3,1,0],width:1}} as Record<string,NodeData>;
    const dimensions=buildPointPositionDimensions(plan,overlay,'l0').filter(d=>d.sourceId==='light');
    expect(dimensions).toHaveLength(4);
    expect(dimensions.every(d=>Math.abs(d.direction[0])<1e-6||Math.abs(d.direction[1])<1e-6)).toBe(true);
  });

  it('keeps a surviving point-position dimension ID stable when an unrelated chain is added',()=>{
    const rectangle={...nodes,west:{id:'west',type:'wall',parentId:'l0',start:[0,0],end:[0,6],thickness:.2},east:{id:'east',type:'wall',parentId:'l0',start:[6,0],end:[6,6],thickness:.2},north:{id:'north',type:'wall',parentId:'l0',start:[0,0],end:[6,0],thickness:.2},south:{id:'south',type:'wall',parentId:'l0',start:[0,6],end:[6,6],thickness:.2}} as Record<string,NodeData>;
    const light=(id:string,x:number,z:number)=>({...device(id),deviceType:'luminaire' as const,systems:['lighting' as const],position:{position:[x,2.7,z] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l0',elevationMm:2700}});
    const overlay=createEmptyOverlay('a','sha'); overlay.devices=[light('target',3,3)];
    const before=buildPointPositionDimensions(rectangle,overlay,'l0').filter(d=>d.sourceId==='target').map(d=>d.id).sort();
    overlay.devices=[light('unrelated',1,1),light('target',3,3)];
    const after=buildPointPositionDimensions(rectangle,overlay,'l0').filter(d=>d.sourceId==='target').map(d=>d.id).sort();
    expect(after).toEqual(before);
  });
});
