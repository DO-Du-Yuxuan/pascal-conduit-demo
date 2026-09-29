// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {NodeData} from '../types';
import {createEmptyOverlay,type ConduitOverlayDocument,type NetworkDevice} from '../domain/overlay';
import {createHvacDuct,placeIndoorUnit} from '../domain/hvac';
import {createPlanContext} from './model';
import {createReferencePlaneDevice} from '../domain/devices';
import {ConduitPlanOverlay,devicePlanRotation} from './ConduitPlan';
import {ConstructionAnnotations,ConstructionNotices,missingConstructionDrawingLayout,useConstructionPlan} from './ConstructionAnnotations';
import {buildHvacPositionDimensions} from './HvacConstruction';
import {ConstructionLegend} from './ConstructionLegend';
import {PointPositionDimensions} from './PointPositionDimensions';
import {buildExteriorDimensions} from '../geometry/exterior-dimensions';
import {useOverlayStore} from '../domain/store';
const nodes={l:{id:'l',type:'level',level:0},w:{id:'w',type:'wall',parentId:'l',start:[0,0],end:[4,0],thickness:.2}} as unknown as Record<string,NodeData>;
const device:NetworkDevice={id:'d',type:'network-device',deviceType:'socket',name:'插座',position:{position:[1,.3,.1],attachment:{hostId:'w',hostKind:'wall',surface:'front',normal:[0,0,1],levelId:'l'}},sizeMm:[86,86,50],orientation:[0,0,0],systems:['receptacle'],ports:[],createdAt:''};
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
const roots:ReturnType<typeof createRoot>[]=[];
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.innerHTML='';useOverlayStore.setState({preview:null});vi.restoreAllMocks();});
function Harness({overlay,modelNodes=nodes,onAnnotationLabelPositionChange,selectionClearVersion=0}:{overlay:ConduitOverlayDocument;modelNodes?:Record<string,NodeData>;onAnnotationLabelPositionChange?:(id:string,label:[number,number],signature:string)=>void;selectionClearVersion?:number}) {
 const ref=useRef<HTMLDivElement>(null),plan=useConstructionPlan({nodes:modelNodes,overlay,levelId:'l',hiddenNodeIds:new Set(),unit:'millimeters',rotation:90,viewBox:{minX:-5,minZ:-5,width:10,height:10},planRef:ref,selectedId:null,exterior:buildExteriorDimensions(modelNodes,'l'),dimensionsVisible:true,measurements:[],annotationScale:1});
 return <div ref={ref}><svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={plan.context} scale={plan.scale} rotation={90}/><ConstructionAnnotations plan={plan} rotation={90} onSelect={()=>{}} onLabelPositionChange={onAnnotationLabelPositionChange} toPlanPoint={(x,y)=>[x,y]} selectionClearVersion={selectionClearVersion}/></svg><ConstructionNotices plan={plan} onFocus={()=>{}}/></div>;
}
describe('construction plan rendering integration',()=>{
 it('draws electrical panels at physical casing dimensions independent of annotation scale',()=>{
  const overlay=createEmptyOverlay('a','sha');overlay.devices=[{...device,id:'panel',deviceType:'strong-panel',name:'强电箱',sizeMm:[500,600,120],systems:['receptacle','lighting']}];
  const context=createPlanContext(nodes,overlay),div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const render=(annotationScale:number)=>act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0} annotationScale={annotationScale}/></svg>));
  render(.5);
  const symbol=div.querySelector('[data-device-symbol="strong-panel"]')!,casing=symbol.querySelector('[data-panel-real-size]')!;
  expect(casing.getAttribute('x')).toBe('-0.25');expect(casing.getAttribute('width')).toBe('0.5');expect(casing.getAttribute('height')).toBe('0.12');expect(symbol.getAttribute('transform')).toContain('translate(1 0.1) rotate(180)');expect(symbol.getAttribute('transform')).not.toContain('scale(');expect(symbol.getAttribute('stroke-width')).toBe('0.03');expect(symbol.querySelector('[data-panel-real-size]')?.getAttribute('stroke')).toBeNull();
  const smallGeometry=casing.outerHTML,smallTransform=symbol.getAttribute('transform');
  render(2);
  const enlarged=div.querySelector('[data-device-symbol="strong-panel"]')!,enlargedCasing=enlarged.querySelector('[data-panel-real-size]')!;
  expect(enlargedCasing.outerHTML).toBe(smallGeometry);expect(enlarged.getAttribute('transform')).toBe(smallTransform);
 });
 it('keeps 2D HVAC geometry and dimensions independent of the persisted 3D HVAC visibility',()=>{
  const placed=placeIndoorUnit(createEmptyOverlay('a','sha'),{position:[0,2.7,0]});
  const mounted={...placed.overlay,hvac:{...placed.overlay.hvac,indoorUnits:placed.overlay.hvac.indoorUnits.map(unit=>({...unit,mount:{kind:'reference-plane' as const,levelId:'l',elevationMm:2700}}))}};
  const routed=createHvacDuct(mounted,placed.unit.id,'supply',{position:[0,2.7,0]},{position:[2,2.85,.3]});
  if(!('duct' in routed)) throw new Error('fixture');
  routed.overlay.hvac.visible=false;
  const segmentId=routed.duct.segmentIds[0]!;
  const context=createPlanContext(nodes,routed.overlay),div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={routed.overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0} hvacVisible={true}/></svg>));
  expect(div.querySelector('[data-hvac-indoor-unit]')).not.toBeNull();
  expect(div.querySelector(`[data-hvac-duct-segment="${segmentId}"]`)).not.toBeNull();
  expect(buildHvacPositionDimensions(nodes,routed.overlay,'l').some(dimension=>dimension.sourceId===segmentId)).toBe(true);
 });
 it('records generated drawing layout once without replacing existing positions',()=>{
  const overlay=createEmptyOverlay('a','sha');
  const oldLabel:[number,number]=[9,-3],oldOffset=.91;
  overlay.constructionAnnotationLabelPositions['group:d']=oldLabel;
  overlay.constructionAnnotationLabelPlacementSignatures['group:d']='existing-signature';
  overlay.pointPositionDimensionLabelPositions['d:position:wall:w:from:wall-end:w']=.71;
  overlay.pointPositionDimensionLineOffsets['d:position:wall:w:from:wall-end:w']=oldOffset;
  const plan={
   annotationScale:1,
   report:{annotations:[{id:'group:d',anchor:[1,.1],arrangement:'single',rows:[],relatedIds:['d']},{id:'group:new',anchor:[2,.1],arrangement:'single',rows:[],relatedIds:['new']}]},
   layout:{placed:[{annotation:{id:'group:d'},label:oldLabel},{annotation:{id:'group:new'},label:[8,-2] as [number,number]}]},
   positionDimensions:[{id:'d:position:wall:w:from:wall-end:w',lane:0},{id:'new:position:wall:w:from:wall-end:w',lane:2}],
  } as unknown as Parameters<typeof missingConstructionDrawingLayout>[1];
  const next=missingConstructionDrawingLayout(overlay,plan)!;
  expect(next.constructionAnnotationLabelPositions).toEqual({'group:d':oldLabel,'group:new':[8,-2]});
  expect(next.constructionAnnotationLabelPlacementSignatures['group:d']).toBe('existing-signature');
  expect(next.pointPositionDimensionLabelPositions).toEqual({'d:position:wall:w:from:wall-end:w':.71,'new:position:wall:w:from:wall-end:w':.5});
  expect(next.pointPositionDimensionLineOffsets).toEqual({'d:position:wall:w:from:wall-end:w':oldOffset,'new:position:wall:w:from:wall-end:w':.64});
  expect(missingConstructionDrawingLayout(next,plan)).toBeNull();
 });
 it('draws network conduits with a bright teal outline and a white core',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');overlay.segments=[{id:'network-pipe',type:'conduit-segment',system:'network',diameterMm:20,start:{position:[0,.3,0],attachment:device.position.attachment},end:{position:[2,.3,0],attachment:device.position.attachment},createdAt:''},{id:'lighting-pipe',type:'conduit-segment',system:'lighting',diameterMm:20,start:{position:[0,.3,.2],attachment:device.position.attachment},end:{position:[2,.3,.2],attachment:device.position.attachment},createdAt:''}];
  const context=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:true,network:true,sprinkler:false, 'fire-signal': false});
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  const pipe=div.querySelector('[data-conduit-segment="network-pipe"]')!;
  expect(pipe.querySelector('[data-conduit-stroke="outline"]')?.getAttribute('stroke')).toBe('#00a6a0');
  expect(pipe.querySelector('[data-conduit-stroke="core"]')?.getAttribute('stroke')).toBe('#ffffff');
  expect(Number(pipe.querySelector('[data-conduit-stroke="core"]')?.getAttribute('stroke-width'))).toBeCloseTo(.01);
  expect(Number(pipe.querySelector('[data-conduit-stroke="outline"]')?.getAttribute('stroke-width'))).toBeCloseTo(.024);
  const lighting=div.querySelector('[data-conduit-segment="lighting-pipe"]')!;
  expect(lighting.querySelector('[data-conduit-stroke="color"]')?.getAttribute('stroke')).toBe('#2563c7');
  expect(Number(lighting.querySelector('[data-conduit-stroke="color"]')?.getAttribute('stroke-width'))).toBeCloseTo(.036);
  expect(lighting.querySelector('[data-conduit-stroke="core"]')).toBeNull();
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={100} rotation={0}/></svg>));
  expect(Number(div.querySelector('[data-conduit-segment="lighting-pipe"] [data-conduit-stroke="color"]')?.getAttribute('stroke-width'))).toBeCloseTo(.02);
  expect(Number(div.querySelector('[data-conduit-segment="network-pipe"] [data-conduit-stroke="outline"]')?.getAttribute('stroke-width'))).toBeCloseTo(.02);
  expect(Number(div.querySelector('[data-conduit-segment="network-pipe"] [data-conduit-stroke="core"]')?.getAttribute('stroke-width'))).toBeCloseTo(.012);
 });
 it('draws water and white signal routes plus sprinkler and smoke symbols on the shared fire drawing',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),attachment=device.position.attachment!;
  overlay.devices=[
   {...device,id:'smoke',deviceType:'smoke-detector',name:'烟感',position:{position:[0,2.8,0]},mount:{kind:'reference-plane',levelId:'l',elevationMm:2800},sizeMm:[60,60,30],systems:['fire-signal'],ports:[]},
   {...device,id:'sprinkler',deviceType:'sprinkler-head',name:'喷淋头',position:{position:[2,2.8,0]},mount:{kind:'reference-plane',levelId:'l',elevationMm:2800},systems:['sprinkler'],ports:[]},
  ];
  overlay.segments=[
   {id:'signal-run',type:'conduit-segment',system:'fire-signal',diameterMm:20,start:{position:[0,2.8,0]},end:{position:[1,2.8,0],attachment},createdAt:''},
   {id:'water-run',type:'conduit-segment',system:'sprinkler',diameterMm:50,start:{position:[2,2.8,0]},end:{position:[3,2.8,0],attachment},createdAt:''},
  ];
  const fireVisibility={receptacle:false,lighting:false,network:false,sprinkler:true,'fire-signal':true};
  const context=createPlanContext(nodes,overlay,new Set(),fireVisibility);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={100} rotation={0}/></svg>));
  const signal=div.querySelector('[data-conduit-segment="signal-run"] [data-conduit-stroke="outline"]');
  const signalCore=div.querySelector('[data-conduit-segment="signal-run"] [data-conduit-stroke="core"]');
  expect(signal?.getAttribute('stroke')).toBe('#334155');
  expect(signalCore?.getAttribute('stroke')).toBe('#ffffff');
  expect(signal?.getAttribute('stroke-dasharray')).toBe('.12 .08');
  expect(signalCore?.getAttribute('stroke-dasharray')).toBe('.12 .08');
  expect(Number(signal?.getAttribute('stroke-width'))).toBeCloseTo(.024);
  const smoke=div.querySelector('[data-device-symbol="smoke-detector"]');
  expect(smoke?.getAttribute('stroke')).toBe('#334155');
  expect(smoke?.getAttribute('fill')).toBe('#fff');
  expect(div.querySelector('[data-device-symbol="sprinkler-head"]')?.getAttribute('stroke')).toBe('#208348');
  expect(div.querySelector('[data-conduit-segment="water-run"] [data-conduit-stroke="color"]')?.getAttribute('stroke')).toBe('#208348');
  expect(Number(div.querySelector('[data-conduit-segment="water-run"] [data-conduit-stroke="color"]')?.getAttribute('stroke-width'))).toBeCloseTo(.05);
  const hiddenContext=createPlanContext(nodes,overlay,new Set(),{...fireVisibility,sprinkler:false,'fire-signal':false});
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={hiddenContext} scale={100} rotation={0}/></svg>));
  expect(div.querySelector('[data-conduit-segment="signal-run"]')).toBeNull();
  expect(div.querySelector('[data-conduit-segment="water-run"]')).toBeNull();
  expect(div.querySelector('[data-device-symbol="smoke-detector"]')).toBeNull();
  expect(div.querySelector('[data-device-symbol="sprinkler-head"]')).toBeNull();
 });
 it('uses dashed strokes for elevated free-space and ceiling-back conduit while keeping floor and wall runs solid',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),wallAttachment=device.position.attachment!;
  overlay.segments=[
   {id:'floor-open',type:'conduit-segment',system:'receptacle',diameterMm:20,start:{position:[0,.05,0]},end:{position:[1,.05,0],attachment:wallAttachment},createdAt:''},
   {id:'high-free',type:'conduit-segment',system:'lighting',diameterMm:20,start:{position:[0,2.74,1]},end:{position:[1,2.74,1],attachment:wallAttachment},createdAt:''},
   {id:'high-receptacle',type:'conduit-segment',system:'receptacle',diameterMm:20,start:{position:[0,2.74,.1],attachment:wallAttachment},end:{position:[1,2.74,.1]},createdAt:''},
   {id:'high-network',type:'conduit-segment',system:'network',diameterMm:20,start:{position:[0,2.74,.1],attachment:wallAttachment},end:{position:[1,2.74,.1]},createdAt:''},
   {id:'high-sprinkler',type:'sprinkler-segment',system:'sprinkler',diameterMm:50,start:{position:[0,2.74,.1],attachment:wallAttachment},end:{position:[1,2.74,.1]},createdAt:''},
   {id:'ceiling-back',type:'conduit-segment',system:'lighting',diameterMm:20,start:{position:[0,2.74,2],attachment:{...wallAttachment,hostKind:'ceiling',surface:'ceiling-back'}},end:{position:[1,2.74,2],attachment:{...wallAttachment,hostKind:'ceiling',surface:'ceiling-back'}},createdAt:''},
   {id:'wall-mounted',type:'conduit-segment',system:'receptacle',diameterMm:20,start:{position:[0,2.74,.1],attachment:wallAttachment},end:{position:[1,2.74,.1],attachment:wallAttachment},createdAt:''},
  ];
  overlay.fittings=[{id:'high-sprinkler-elbow',type:'sprinkler-fitting',fitting:'elbow',bendStyle:'standard',system:'sprinkler',diameterMm:50,position:{position:[.5,2.74,.1]},segmentIds:['high-sprinkler'],arc:{start:[.5,2.74,0],end:[.6,2.74,.1],center:[.6,2.74,0],normal:[0,1,0],sweepRadians:Math.PI/2},ports:[]},{id:'high-sprinkler-bridge',type:'sprinkler-fitting',fitting:'bridge-bend',system:'sprinkler',diameterMm:50,position:{position:[.5,2.74,.1]},segmentIds:['high-sprinkler'],bridge:{obstacleSegmentId:'obstacle',entry:[.3,2.74,.1],crestStart:[.4,2.85,.1],crestEnd:[.6,2.85,.1],exit:[.7,2.74,.1],riseMm:110,clearanceMm:10},ports:[]}];
  const context=createPlanContext(nodes,overlay);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  const stroke=(id:string)=>div.querySelector(`[data-conduit-segment="${id}"] [data-conduit-stroke="color"]`);
  expect(stroke('floor-open')?.getAttribute('stroke-dasharray')).toBeNull();
  expect(stroke('high-free')?.getAttribute('stroke-dasharray')).toBe('.12 .08');
  expect(stroke('ceiling-back')?.getAttribute('stroke-dasharray')).toBe('.12 .08');
  expect(stroke('high-receptacle')?.getAttribute('stroke-dasharray')).toBe('.12 .08');
  expect(div.querySelector('[data-conduit-segment="high-network"] [data-conduit-stroke="outline"]')?.getAttribute('stroke-dasharray')).toBe('.12 .08');
  expect(stroke('high-sprinkler')?.getAttribute('stroke-dasharray')).toBeNull();
  expect(Number(stroke('high-sprinkler')?.getAttribute('stroke-width'))).toBeCloseTo(.05);
  expect(Number(stroke('high-receptacle')?.getAttribute('stroke-width'))).toBeCloseTo(.036);
  expect(Number(stroke('high-sprinkler')?.getAttribute('stroke-width'))).toBeGreaterThan(Number(div.querySelector('[data-conduit-segment="high-network"] [data-conduit-stroke="outline"]')?.getAttribute('stroke-width')));
  expect(div.querySelector('[data-conduit-fitting="high-sprinkler-elbow"] [data-conduit-stroke="color"]')?.getAttribute('stroke-dasharray')).toBeNull();
  expect(Number(div.querySelector('[data-conduit-fitting="high-sprinkler-elbow"] [data-conduit-stroke="color"]')?.getAttribute('stroke-width'))).toBeCloseTo(.05);
  expect(Number(div.querySelector('[data-conduit-fitting="high-sprinkler-bridge"] [data-conduit-stroke="color"]')?.getAttribute('stroke-width'))).toBeCloseTo(.05);
  expect(stroke('wall-mounted')?.getAttribute('stroke-dasharray')).toBeNull();
 });
 it('renders elevated free-space segments connected through fittings to reference-plane lighting boxes',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');
  const left=createReferencePlaneDevice('luminaire',[0,2.8,0],'l',2800),right=createReferencePlaneDevice('luminaire',[2,2.8,0],'l',2800);
  left.ports[0]!.connectedSegmentIds=['floating-a'];right.ports[0]!.connectedSegmentIds=['floating-b'];
  overlay.devices=[left,right];
  overlay.segments=[
   {id:'floating-a',type:'conduit-segment',system:'lighting',diameterMm:20,start:{position:[0,2.8,0]},end:{position:[1,2.8,0]},startPortId:left.ports[0]!.id,endPortId:'elbow:port:0',createdAt:''},
   {id:'floating-b',type:'conduit-segment',system:'lighting',diameterMm:20,start:{position:[1,2.8,0]},end:{position:[2,2.8,0]},startPortId:'elbow:port:1',endPortId:right.ports[0]!.id,createdAt:''},
  ];
  overlay.fittings=[{id:'elbow',type:'conduit-fitting',fitting:'elbow',bendStyle:'sweep',system:'lighting',diameterMm:20,position:{position:[1,2.8,0]},segmentIds:['floating-a','floating-b'],arc:{start:[1,2.8,-.1],end:[1.1,2.8,0],center:[1.1,2.8,-.1],normal:[0,1,0],sweepRadians:Math.PI/2},ports:[]} as unknown as ConduitOverlayDocument['fittings'][number]];
  const context=createPlanContext(nodes,overlay);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  for(const id of ['floating-a','floating-b']){
   const segment=div.querySelector(`[data-conduit-segment="${id}"]`);
   expect(segment).not.toBeNull();
   expect(segment?.getAttribute('data-suspended')).toBe('true');
   expect(segment?.querySelector('[data-conduit-stroke="color"]')?.getAttribute('stroke-dasharray')).toBe('.12 .08');
  }
  const elbow=div.querySelector('[data-conduit-fitting="elbow"]');
  expect(elbow?.getAttribute('data-suspended')).toBe('true');
  expect(elbow?.querySelector('[data-conduit-stroke="color"]')?.getAttribute('stroke-dasharray')).toBe('.12 .08');
 });
 it('dashes an elevated conduit whose persisted wall attachments miss the wall geometry',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const modelNodes={l:{id:'l',type:'level',level:0},w:{id:'w',type:'wall',parentId:'l',start:[3.5777821517392283,-.5977600998749288],end:[5.845113700040272,-.5977174912801821],thickness:.1}} as unknown as Record<string,NodeData>;
  const attachment={hostId:'w',hostKind:'wall' as const,surface:'exterior',normal:[0,0,-1] as [number,number,number],levelId:'l'};
  const overlay=createEmptyOverlay('a','sha');
  overlay.segments=[{id:'stale-wall-host',type:'conduit-segment',system:'lighting',diameterMm:20,start:{position:[4.924590862183028,2.8,-.7476716041022494],attachment},end:{position:[4.99492334129862,2.8,-2.724150693038257],attachment},createdAt:''}];
  const context=createPlanContext(modelNodes,overlay);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  const segment=div.querySelector('[data-conduit-segment="stale-wall-host"]');
  expect(segment).not.toBeNull();
  expect(segment?.getAttribute('data-suspended')).toBe('true');
  expect(segment?.querySelector('[data-conduit-stroke="color"]')?.getAttribute('stroke-dasharray')).toBe('.12 .08');
 });
 it('does not draw legacy switch control relations when the conduit layer is hidden',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),wallSwitch={...device,id:'switch',deviceType:'switch' as const,name:'开关',systems:['lighting' as const]},light={...device,id:'light',deviceType:'luminaire' as const,name:'灯具',systems:['lighting' as const],position:{position:[3,2.7,2] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l',elevationMm:2700}};
  overlay.devices=[wallSwitch,light];overlay.lightingControlGroups=[{id:'control',switchDeviceId:'switch',luminaireDeviceIds:['light'],createdAt:''}];
  overlay.segments=[{id:'pipe',type:'conduit-segment',system:'lighting',diameterMm:20,start:wallSwitch.position,end:light.position,createdAt:''}];
  const context=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:true,network:false,sprinkler:false, 'fire-signal': false});
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0} conduitsVisible={false}/></svg>));
  expect(div.querySelector('[data-lighting-control-line]')).toBeNull();
  expect(div.querySelector('[data-conduit-segment]')).toBeNull();
 });
 it('does not derive switch blades from persisted legacy control groups',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),wallSwitch={...device,id:'switch',deviceType:'switch' as const,name:'开关',systems:['lighting' as const]};overlay.devices=[wallSwitch];
  overlay.lightingControlGroups=[{id:'a',switchDeviceId:'switch',luminaireDeviceIds:['light-a'],createdAt:''},{id:'b',switchDeviceId:'switch',luminaireDeviceIds:['light-b'],createdAt:''}];
  const context=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:true,network:false,sprinkler:false, 'fire-signal': false});
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  const symbol=div.querySelector('[data-device-symbol="switch"]');expect(symbol?.getAttribute('data-switch-gangs')).toBeNull();expect(symbol?.querySelectorAll('path')).toHaveLength(1);
 });
 it('renders an explicit pendent sprinkler symbol in the 2D plan',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),sprinkler={...device,id:'sprinkler',deviceType:'sprinkler-head' as const,name:'喷淋头',systems:['sprinkler' as const],sprinklerDirection:'pendent' as const,position:{position:[2,2.7,1] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l',elevationMm:2700}};overlay.devices=[sprinkler];
  const context=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:false,network:false,sprinkler:true, 'fire-signal': false});
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  const symbol=div.querySelector('[data-device-symbol="sprinkler-head"]');
  expect(symbol?.getAttribute('data-sprinkler-direction')).toBe('pendent');
  expect(symbol?.querySelectorAll('path')[1]?.getAttribute('d')).toContain('M0-10V10');
 });
 it('renders a sensor only while the dedicated sensor layer is visible',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),sensor={...device,id:'sensor',deviceType:'sensor' as const,name:'传感器',systems:[] as [],ports:[],position:{position:[2,2.7,1] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l',elevationMm:2700}};overlay.devices=[sensor];
  const visible=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:false,network:false,sprinkler:false, 'fire-signal': false},true);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={visible} scale={50} rotation={0}/></svg>));
  expect(div.querySelector('[data-device-symbol="sensor"]')).not.toBeNull();
  const hidden=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:false,network:false,sprinkler:false, 'fire-signal': false},false);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={hidden} scale={50} rotation={0}/></svg>));
  expect(div.querySelector('[data-device-symbol="sensor"]')).toBeNull();
 });
 it('orients wall devices from their host normal while ceiling devices stay screen-upright',()=>{
  const wallDevice={...device,position:{...device.position,attachment:{...device.position.attachment!,normal:[1,0,0] as [number,number,number]}}};
  const light={...device,deviceType:'luminaire' as const,systems:['lighting' as const],position:{position:[1,1.5,2] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l',elevationMm:1500}};
  expect(devicePlanRotation(wallDevice,90)).toBeCloseTo(90);
  expect(devicePlanRotation(light,90)).toBe(-90);
 });
 it('updates symbols and derived text after immutable edits and removal without writing overlay',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');overlay.devices=[device];const before=JSON.stringify(overlay);
  act(()=>root.render(<Harness overlay={overlay}/>));
  expect(div.querySelectorAll('[data-device-symbol="socket"]')).toHaveLength(1);
  expect(div.textContent).toContain('257 mm');
  const moved={...overlay,devices:[{...device,position:{...device.position,position:[2,.6,.1] as [number,number,number]}}]};
  act(()=>root.render(<Harness overlay={moved}/>));expect(div.textContent).toContain('557 mm');expect(div.textContent).not.toContain('257 mm');
  act(()=>root.render(<Harness overlay={{...overlay,devices:[]}}/>));expect(div.querySelectorAll('[data-device-symbol]')).toHaveLength(0);
  expect(JSON.stringify(overlay)).toBe(before);
 });
 it('keeps preview geometry separate, source-matched, and never annotates it',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),context=createPlanContext(nodes,overlay);
  useOverlayStore.setState({preview:{sourceSha:'sha',levelId:'l',system:'network',diameterMm:20,points:[device.position,{...device.position,position:[2,.3,.1]}],plan:null,branchNode:null,deviceNode:null} as never});
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  expect(div.querySelector('.conduit-plan-preview')).not.toBeNull();
  expect(div.querySelectorAll('[data-annotation]')).toHaveLength(0);
  act(()=>useOverlayStore.setState({preview:{...useOverlayStore.getState().preview!,sourceSha:'other'}}));
  expect(div.querySelector('.conduit-plan-preview')).toBeNull();
 });
 it('keeps temporary smoke symbols and fire-signal endpoints visible on a white sheet',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),position:[number,number,number]=[1,2.8,1];
  const context=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:false,network:false,sprinkler:true,'fire-signal':true});
  useOverlayStore.setState({preview:{sourceSha:'sha',levelId:'l',system:'fire-signal',diameterMm:20,points:[{position}],plan:null,branchNode:null,deviceNode:{deviceType:'smoke-detector',valid:true,position:{position}}} as never});
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={100} rotation={0}/></svg>));
  const smoke=div.querySelector('[data-device-preview-symbol="smoke-detector"]');
  expect(smoke?.getAttribute('stroke')).toBe('#334155');
  expect(smoke?.getAttribute('fill')).toBe('#fff');
  const endpoint=div.querySelector('.conduit-plan-preview circle');
  expect(endpoint?.getAttribute('fill')).toBe('#ffffff');
  expect(endpoint?.getAttribute('stroke')).toBe('#334155');
  expect(Number(endpoint?.getAttribute('stroke-width'))).toBeCloseTo(.024);
 });
 it('keeps device blocks in model space and applies the manual annotation scale',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');overlay.devices=[device];const context=createPlanContext(nodes,overlay);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  expect(div.querySelector('[data-device-symbol="socket"]')?.getAttribute('transform')).toContain('scale(0.018)');
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0} deviceVariants={{d:'A'}}/></svg>));
  expect(div.querySelector('[data-device-variant="A"]')?.textContent).toBe('A');
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={100} rotation={0} annotationScale={2}/></svg>));
  expect(div.querySelector('[data-device-symbol="socket"]')?.getAttribute('transform')).toContain('scale(0.036)');
 });
  it('anchors a wall-device symbol on its attached physical face instead of the wall axis',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');overlay.devices=[{...device,position:{...device.position,position:[1,.3,0] as [number,number,number]}}];const context=createPlanContext(nodes,overlay);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
    expect(div.querySelector('[data-device-symbol="socket"]')?.getAttribute('transform')).toContain('translate(1 0.1)');
  });
 it('uses a distinct square floor-socket symbol for slab-mounted sockets',()=>{
    const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
    const overlay=createEmptyOverlay('a','sha'),floorSocket={...device,id:'floor-socket',position:{position:[1,0,2] as [number,number,number],attachment:{hostId:'floor',hostKind:'slab' as const,surface:'top',normal:[0,1,0] as [number,number,number],levelId:'l'}}};
    overlay.devices=[floorSocket];const context=createPlanContext({...nodes,floor:{id:'floor',type:'slab',parentId:'l'}} as Record<string,NodeData>,overlay);
    act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
    expect(div.querySelector('[data-device-symbol="socket"]')?.hasAttribute('data-floor-socket')).toBe(true);
    expect(div.querySelector('[data-floor-socket-symbol]')).toBeTruthy();
  });
 it('projects HVAC hardware from its 3D dimensions without automatic duct-length labels',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');
  overlay.hvac={visible:true,indoorUnits:[{id:'unit',type:'indoor-air-handling-unit',name:'空调内机',position:{position:[1,2.85,1],attachment:{hostId:'ceiling',hostKind:'ceiling',surface:'bottom',normal:[0,-1,0],levelId:'l'}},sizeMm:[600,1000,300],sectionMm:[1000,300],rotationYDegrees:0,createdAt:''}],ducts:[{id:'duct',type:'hvac-duct',indoorUnitId:'unit',system:'supply',segmentIds:['segment'],createdAt:''}],segments:[{id:'segment',start:{position:[1,2.85,1.3]},end:{position:[3,2.85,1.3]}}],outlets:[{id:'outlet',type:'hvac-duct-outlet',ductId:'duct',segmentId:'segment',face:'left',offsetMm:400,sizeMm:[300,150],createdAt:''}],thermostats:[{id:'thermostat',type:'thermostat',name:'控温器',position:{position:[.2,1.3,1],attachment:{hostId:'w',hostKind:'wall',surface:'front',normal:[0,0,1],levelId:'l'}},sizeMm:[86,86,50],createdAt:''}],controls:[],controlConduits:[],controlSegments:[],controlFittings:[],wallPenetrations:[]};
  const context=createPlanContext(nodes,overlay);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  expect(div.querySelector('[data-hvac-duct-segment="segment"]')?.getAttribute('points')).toContain('1,0.8');
  expect(div.querySelector('[data-hvac-duct-segment="segment"]')?.textContent).toBe('');
  expect(div.querySelector('[data-hvac-plan-port="supply"]')?.textContent).toBe('送');
  expect(div.querySelector('[data-hvac-outlet="outlet"]')).not.toBeNull();
  expect(div.querySelector('[data-hvac-thermostat="thermostat"] rect')?.getAttribute('width')).toBe('0.086');
 });
 it('shows overhead HVAC control segments and elbows as dashed on their uniquely owned level',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');
  overlay.hvac.thermostats=[{id:'thermostat',type:'thermostat',name:'控温器',position:{position:[0,2.8,0]},mount:{kind:'reference-plane',levelId:'l',elevationMm:2800},sizeMm:[86,86,50],createdAt:''}];
  overlay.hvac.indoorUnits=[{id:'unit',type:'indoor-air-handling-unit',name:'FCU',position:{position:[2,2.8,0]},mount:{kind:'reference-plane',levelId:'l',elevationMm:2800},sizeMm:[1000,600,300],sectionMm:[500,200],rotationYDegrees:0,createdAt:''}];
  overlay.hvac.controlConduits=[{id:'control-route',type:'hvac-control-conduit',system:'control',thermostatId:'thermostat',thermostatPortId:'t-port',indoorUnitId:'unit',indoorUnitPortId:'unit-port',segmentIds:['control-a','control-b'],fittingIds:['control-elbow'],diameterMm:20,createdAt:''}];
  overlay.hvac.controlSegments=[{id:'control-a',start:{position:[0,2.8,0]},end:{position:[1,2.8,0]}},{id:'control-b',start:{position:[1,2.8,0]},end:{position:[2,2.8,0]}}];
  overlay.hvac.controlFittings=[{id:'control-elbow',type:'hvac-control-fitting',system:'control',fitting:'elbow',diameterMm:20,position:{position:[1,2.8,0]},segmentIds:['control-a','control-b'],arc:{start:[1,2.8,-.1],end:[1.1,2.8,0],center:[1.1,2.8,-.1],normal:[0,1,0],sweepRadians:Math.PI/2}}];
  const context=createPlanContext(nodes,overlay);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  for(const id of ['control-a','control-b']){
   const segment=div.querySelector(`[data-hvac-control-conduit="${id}"]`);
   const outline=segment?.querySelector('[data-hvac-control-stroke="outline"]'),core=segment?.querySelector('[data-hvac-control-stroke="core"]');
   expect(segment).not.toBeNull();expect(segment?.getAttribute('data-suspended')).toBe('true');
   expect(outline?.getAttribute('stroke')).toBe('#64748b');expect(core?.getAttribute('stroke')).toBe('#ffffff');
   expect(outline?.getAttribute('stroke-dasharray')).toBe('.12 .08');expect(core?.getAttribute('stroke-dasharray')).toBe('.12 .08');
   expect(Number(outline?.getAttribute('stroke-width'))).toBeCloseTo(.04);expect(Number(core?.getAttribute('stroke-width'))).toBeCloseTo(.024);
  }
  const elbow=div.querySelector('[data-hvac-control-fitting="control-elbow"]');
  const elbowOutline=elbow?.querySelector('[data-hvac-control-stroke="outline"]'),elbowCore=elbow?.querySelector('[data-hvac-control-stroke="core"]');
  expect(elbow?.getAttribute('data-suspended')).toBe('true');
  expect(elbowOutline?.getAttribute('stroke-dasharray')).toBe('.12 .08');expect(elbowCore?.getAttribute('stroke-dasharray')).toBe('.12 .08');
  expect(Number(elbowOutline?.getAttribute('stroke-width'))).toBeCloseTo(.04);expect(Number(elbowCore?.getAttribute('stroke-width'))).toBeCloseTo(.024);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={100} rotation={0}/></svg>));
  expect(Number(div.querySelector('[data-hvac-control-conduit="control-a"] [data-hvac-control-stroke="outline"]')?.getAttribute('stroke-width'))).toBeCloseTo(.02);
  expect(Number(div.querySelector('[data-hvac-control-conduit="control-a"] [data-hvac-control-stroke="core"]')?.getAttribute('stroke-width'))).toBeCloseTo(.012);
  expect(Number(div.querySelector('[data-hvac-control-fitting="control-elbow"] [data-hvac-control-stroke="outline"]')?.getAttribute('stroke-width'))).toBeCloseTo(.02);
  expect(Number(div.querySelector('[data-hvac-control-fitting="control-elbow"] [data-hvac-control-stroke="core"]')?.getAttribute('stroke-width'))).toBeCloseTo(.012);
  const crossFloor={...overlay,hvac:{...overlay.hvac,indoorUnits:overlay.hvac.indoorUnits.map(unit=>({...unit,mount:{kind:'reference-plane' as const,levelId:'l1',elevationMm:6000}}))}};
  const splitContext=createPlanContext({...nodes,l1:{id:'l1',type:'level',level:1}} as unknown as Record<string,NodeData>,crossFloor);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={crossFloor} levelId="l" selectedId={null} onSelect={()=>{}} context={splitContext} scale={50} rotation={0}/></svg>));
  expect(div.querySelector('[data-hvac-control-conduit]')).toBeNull();
  expect(div.querySelector('[data-hvac-control-fitting]')).toBeNull();
 });
 it('opens a screen-space editor only when the device description is double-clicked',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');overlay.devices=[device];useOverlayStore.getState().load(overlay);
  act(()=>root.render(<Harness overlay={overlay}/>));
  const description=[...div.querySelectorAll('text')].find(node=>node.textContent==='插座');expect(description).toBeTruthy();
  act(()=>description!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
  expect(document.body.querySelector('.construction-annotation-editor')).not.toBeNull();
  expect(div.querySelector('foreignObject')).toBeNull();
 });
 it('uses readable text and caret colors while editing an automatic annotation',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');overlay.devices=[device];useOverlayStore.getState().load(overlay);
  act(()=>root.render(<Harness overlay={overlay}/>));
  const description=[...div.querySelectorAll('text')].find(node=>node.textContent==='插座')!;
  act(()=>description.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
  const input=document.body.querySelector('.construction-annotation-editor') as HTMLInputElement;
  expect(input.style.color).toBe('rgb(52, 52, 52)');
  expect(input.style.caretColor).toBe('rgb(52, 52, 52)');
  expect(Number.parseFloat(input.style.fontSize)).toBeGreaterThanOrEqual(12);
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'现场复核');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(input.value).toBe('现场复核');
 });
 it('persists an arbitrary drag position from an automatic annotation panel',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div),onChange=vi.fn();roots.push(root);
  const overlay=createEmptyOverlay('a','sha');overlay.devices=[device];
  act(()=>root.render(<Harness overlay={overlay} onAnnotationLabelPositionChange={onChange}/>));
  const panel=div.querySelector('[data-construction-annotation-panel]') as SVGGElement;expect(panel).toBeTruthy();
  Object.assign(panel,{setPointerCapture:vi.fn(),hasPointerCapture:vi.fn(()=>true),releasePointerCapture:vi.fn()});
  act(()=>{panel.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:1,clientY:1,button:0}));panel.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:7,clientY:-3,button:0}));panel.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:7,clientY:-3,button:0}));});
  expect(onChange).toHaveBeenCalledWith('group:d',[7,-3],expect.any(String));
 });
 it('clears a cancelled automatic annotation-panel drag without persisting it',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div),onChange=vi.fn();roots.push(root);
  const overlay=createEmptyOverlay('a','sha');overlay.devices=[device];
  act(()=>root.render(<Harness overlay={overlay} onAnnotationLabelPositionChange={onChange}/>));
  const panel=div.querySelector('[data-construction-annotation-panel]') as SVGGElement;
  Object.assign(panel,{setPointerCapture:vi.fn(),hasPointerCapture:vi.fn(()=>true),releasePointerCapture:vi.fn()});
  act(()=>{panel.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:1,clientY:1,button:0}));panel.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:7,clientY:-3,button:0}));panel.dispatchEvent(new Event('pointercancel',{bubbles:true}));panel.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:9,clientY:-4,button:0}));});
  expect(onChange).not.toHaveBeenCalled();
 });
 it('renders the callout rule on the final screen-facing side after rotation',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');overlay.devices=[device];
  act(()=>root.render(<Harness overlay={overlay}/>));
  const callout=div.querySelector('[data-annotation]'),rule=callout?.querySelector('[data-callout-rule]');
  expect(callout?.getAttribute('data-rule-side')).toBe('right');
  expect(Number(rule?.getAttribute('x1'))).toBeGreaterThan(0);
  const points=callout?.querySelector('polyline')?.getAttribute('points')?.trim().split(/\s+/).map(point=>point.split(',').map(Number));
 expect(points?.[points.length-1]?.[0]).toBeCloseTo(points?.[points.length-2]?.[0] ?? NaN);
 });
 it('clears an automatic annotation-panel selection with Escape or a canvas clear signal',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');overlay.devices=[device];
  act(()=>root.render(<Harness overlay={overlay} selectionClearVersion={0}/>));
  const annotation=div.querySelector('[data-annotation]')!;
  act(()=>annotation.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(annotation.getAttribute('data-construction-annotation-selected')).toBe('true');
  act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(annotation.getAttribute('data-construction-annotation-selected')).toBeNull();
  act(()=>annotation.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(annotation.getAttribute('data-construction-annotation-selected')).toBe('true');
  act(()=>root.render(<Harness overlay={overlay} selectionClearVersion={1}/>));
  expect(div.querySelector('[data-annotation]')?.getAttribute('data-construction-annotation-selected')).toBeNull();
 });
 it('renders ceiling-device installation information in the drawing schedule',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const sections=[{system:'lighting' as const,label:'灯位接线盒施工图',rows:[{deviceType:'luminaire' as const,name:'灯位接线盒',mounting:'安装参考面',height:'1500 mm',heightMeters:1.5,quantity:2,sourceIds:['a','b'],measurementBasis:'explicit' as const,confidence:'high' as const,assumptions:['高度来自安装参考面']}]}];
  act(()=>root.render(<ConstructionLegend sections={sections} annotationScale={1}/>));
  const schedule=div.querySelector<HTMLDetailsElement>('[aria-label="点位图例及安装高度表"]');
  expect(schedule?.open).toBe(false);
  expect(schedule?.querySelector('summary')?.textContent).toBe('点位图例及安装高度表');
  expect(div.querySelector('[aria-label="灯位接线盒图块"]')).not.toBeNull();
  expect(div.querySelector('[data-schedule-row]')?.getAttribute('title')).toContain('依据：explicit');
  expect(div.textContent).toContain('灯位接线盒');expect(div.textContent).toContain('H=1500 mm');expect(div.textContent).toContain('×2');
 });
 it('shows an incomplete-chain notice when a ceiling point has no wall on one side',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const openNodes={l:nodes.l,west:{id:'west',type:'wall',parentId:'l',start:[0,0],end:[0,6],thickness:.2}} as Record<string,NodeData>,overlay=createEmptyOverlay('a','sha');
  overlay.devices=[{...device,id:'open-light',deviceType:'luminaire',name:'灯位接线盒',systems:['lighting'],position:{position:[2,2.7,3]},mount:{kind:'reference-plane',levelId:'l',elevationMm:2700}}];
  act(()=>root.render(<Harness overlay={overlay} modelNodes={openNodes}/>));
  expect(div.querySelector('.construction-notices summary')?.textContent).toBe('图纸提示 1');
  expect(div.textContent).not.toContain('未显示点位');
  expect(div.textContent).toContain('该方向定位尺寸链未闭合');
 });
 it('renders a persisted point-position label placement along its dimension line',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const dimension={id:'position',sourceId:'d',levelId:'l',reference:[0,0] as [number,number],center:[10,0] as [number,number],referenceWitness:[0,0] as [number,number],centerWitness:[10,0] as [number,number],direction:[1,0] as [number,number],normal:[0,1] as [number,number],lane:0,valueMeters:10,referenceKind:'wall-face' as const,relatedIds:['d','wall'],measurementBasis:'derived' as const,confidence:'high' as const,assumptions:[]};
  act(()=>root.render(<svg><PointPositionDimensions dimensions={[dimension]} unit="millimeters" viewRotation={0} annotationScale={1} onSelect={()=>{}} labelPositions={{position:.8}} /></svg>));
 const label=div.querySelector('[data-point-position-dimension-label="position"]');
  expect(Number(label?.getAttribute('x'))).toBeCloseTo(8);
 });
 it('extends the box dimension from its measured casing edge witness',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const dimension={id:'panel-position',sourceId:'panel',levelId:'l',reference:[.1,.1] as [number,number],center:[.75,.1] as [number,number],referenceWitness:[.1,.1] as [number,number],centerWitness:[.75,.1] as [number,number],direction:[1,0] as [number,number],normal:[0,1] as [number,number],lane:0,valueMeters:.65,referenceKind:'wall-end' as const,centerKind:'device-edge' as const,relatedIds:['panel','w'],measurementBasis:'derived' as const,confidence:'high' as const,assumptions:[]};
  act(()=>root.render(<svg><PointPositionDimensions dimensions={[dimension]} unit="millimeters" viewRotation={0} annotationScale={.5} onSelect={()=>{}}/></svg>));
  const centerWitness=div.querySelector('[data-point-position-witness="center"]');
  expect(centerWitness?.getAttribute('x1')).toBe('0.75');expect(centerWitness?.getAttribute('x2')).toBe('0.75');
 });
 it('clears a point-position dimension selection with Escape or a canvas clear signal',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div),onSelect=vi.fn();roots.push(root);
  const dimension={id:'position',sourceId:'d',levelId:'l',reference:[0,0] as [number,number],center:[10,0] as [number,number],referenceWitness:[0,0] as [number,number],centerWitness:[10,0] as [number,number],direction:[1,0] as [number,number],normal:[0,1] as [number,number],lane:0,valueMeters:10,referenceKind:'wall-face' as const,relatedIds:['d','wall'],measurementBasis:'derived' as const,confidence:'high' as const,assumptions:[]};
  act(()=>root.render(<svg><PointPositionDimensions dimensions={[dimension]} unit="millimeters" viewRotation={0} annotationScale={1} onSelect={onSelect} selectionClearVersion={0}/></svg>));
  const group=div.querySelector('[data-point-position-dimension="d"]')!;
  act(()=>group.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(group.getAttribute('data-point-position-dimension-selected')).toBe('true');
  const label=group.querySelector('[data-point-position-dimension-label]')!;
  expect(label.textContent).toContain('10000');
  expect(label.textContent).not.toContain('10000 mm');
  act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  expect(group.getAttribute('data-point-position-dimension-selected')).toBeNull();
  expect(onSelect).toHaveBeenCalledWith(null);
  act(()=>group.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(group.getAttribute('data-point-position-dimension-selected')).toBe('true');
  act(()=>root.render(<svg><PointPositionDimensions dimensions={[dimension]} unit="millimeters" viewRotation={0} annotationScale={1} onSelect={onSelect} selectionClearVersion={1}/></svg>));
  expect(div.querySelector('[data-point-position-dimension="d"]')?.getAttribute('data-point-position-dimension-selected')).toBeNull();
 });
 it('projects a dragged point-position label onto its own dimension and persists the relative position',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div),onChange=vi.fn();roots.push(root);
  const dimension={id:'position',sourceId:'d',levelId:'l',reference:[0,0] as [number,number],center:[10,0] as [number,number],referenceWitness:[0,0] as [number,number],centerWitness:[10,0] as [number,number],direction:[1,0] as [number,number],normal:[0,1] as [number,number],lane:0,valueMeters:10,referenceKind:'wall-face' as const,relatedIds:['d','wall'],measurementBasis:'derived' as const,confidence:'high' as const,assumptions:[]};
  act(()=>root.render(<svg><PointPositionDimensions dimensions={[dimension]} unit="millimeters" viewRotation={0} annotationScale={1} onSelect={()=>{}} onLabelPositionChange={onChange} toPlanPoint={(x,y)=>[x,y]} /></svg>));
  const label=div.querySelector('[data-point-position-dimension-label="position"]') as SVGTextElement;
  Object.assign(label,{setPointerCapture:vi.fn(),hasPointerCapture:vi.fn(()=>true),releasePointerCapture:vi.fn()});
  act(()=>{label.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:5,clientY:0,button:0}));label.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:8,clientY:3,button:0}));label.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:8,clientY:3,button:0}));});
  expect(onChange).toHaveBeenCalledWith('position',.8);
 });
 it('moves a point-position dimension line perpendicular to its value and persists its offset',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div),onChange=vi.fn();roots.push(root);
  const dimension={id:'position',sourceId:'d',levelId:'l',reference:[0,0] as [number,number],center:[10,0] as [number,number],referenceWitness:[0,0] as [number,number],centerWitness:[10,0] as [number,number],direction:[1,0] as [number,number],normal:[0,1] as [number,number],lane:0,valueMeters:10,referenceKind:'wall-face' as const,relatedIds:['d','wall'],measurementBasis:'derived' as const,confidence:'high' as const,assumptions:[]};
  act(()=>root.render(<svg><PointPositionDimensions dimensions={[dimension]} unit="millimeters" viewRotation={0} annotationScale={1} onSelect={()=>{}} labelPositions={{position:.5}} lineOffsets={{position:.28}} onPositionChange={onChange} toPlanPoint={(x,y)=>[x,y]}/></svg>));
  const label=div.querySelector('[data-point-position-dimension-label="position"]') as SVGTextElement;
  Object.assign(label,{setPointerCapture:vi.fn(),hasPointerCapture:vi.fn(()=>true),releasePointerCapture:vi.fn()});
  act(()=>{label.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:5,clientY:.28,button:0}));label.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:5,clientY:1.28,button:0}));label.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:5,clientY:1.28,button:0}));});
  expect(onChange).toHaveBeenCalledWith('position',.5,1.28);
 });
 it('keeps a point-position dimension line directly under the pointer during continuous dragging',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div),onChange=vi.fn();roots.push(root);
  const dimension={id:'position',sourceId:'d',levelId:'l',reference:[0,0] as [number,number],center:[10,0] as [number,number],referenceWitness:[0,0] as [number,number],centerWitness:[10,0] as [number,number],direction:[1,0] as [number,number],normal:[0,1] as [number,number],lane:0,valueMeters:10,referenceKind:'wall-face' as const,relatedIds:['d','wall'],measurementBasis:'derived' as const,confidence:'high' as const,assumptions:[]};
  act(()=>root.render(<svg><PointPositionDimensions dimensions={[dimension]} unit="millimeters" viewRotation={0} annotationScale={1} onSelect={()=>{}} labelPositions={{position:.5}} lineOffsets={{position:.28}} onPositionChange={onChange} toPlanPoint={(x,y)=>[x,y]}/></svg>));
  const label=div.querySelector('[data-point-position-dimension-label="position"]') as SVGTextElement;
  Object.assign(label,{setPointerCapture:vi.fn(),hasPointerCapture:vi.fn(()=>true),releasePointerCapture:vi.fn()});
  act(()=>{label.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:5,clientY:.28,button:0}));label.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:5,clientY:.5,button:0}));label.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:5,clientY:.75,button:0}));label.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:5,clientY:.75,button:0}));});
  expect(onChange).toHaveBeenCalledWith('position',.5,.75);
 });
 it('snaps a moved point-position dimension line to an adjacent point-position dimension line only',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div),onChange=vi.fn();roots.push(root);
  const dimension={id:'position',sourceId:'d',levelId:'l',reference:[0,0] as [number,number],center:[10,0] as [number,number],referenceWitness:[0,0] as [number,number],centerWitness:[10,0] as [number,number],direction:[1,0] as [number,number],normal:[0,1] as [number,number],lane:0,valueMeters:10,referenceKind:'wall-face' as const,relatedIds:['d','wall'],measurementBasis:'derived' as const,confidence:'high' as const,assumptions:[]},neighbor={...dimension,id:'neighbor',sourceId:'other',reference:[0,3] as [number,number],center:[10,3] as [number,number],referenceWitness:[0,3] as [number,number],centerWitness:[10,3] as [number,number]};
  act(()=>root.render(<svg><PointPositionDimensions dimensions={[dimension,neighbor]} unit="millimeters" viewRotation={0} annotationScale={1} onSelect={()=>{}} lineOffsets={{position:.28,neighbor:-1.7}} onPositionChange={onChange} toPlanPoint={(x,y)=>[x,y]}/></svg>));
  const label=div.querySelector('[data-point-position-dimension-label="position"]') as SVGTextElement;
  Object.assign(label,{setPointerCapture:vi.fn(),hasPointerCapture:vi.fn(()=>true),releasePointerCapture:vi.fn()});
  act(()=>{label.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:5,clientY:.28,button:0}));label.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:5,clientY:1.26,button:0}));label.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:5,clientY:1.26,button:0}));});
  expect(onChange).toHaveBeenCalledWith('position',.5,1.3);
 });
 it('moves the dimension number in the same screen direction as its actual dimension line',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div),onChange=vi.fn();roots.push(root);
  const dimension={id:'position',sourceId:'d',levelId:'l',reference:[10,0] as [number,number],center:[0,0] as [number,number],referenceWitness:[10,0] as [number,number],centerWitness:[0,0] as [number,number],direction:[1,0] as [number,number],normal:[0,1] as [number,number],lane:0,valueMeters:10,referenceKind:'wall-face' as const,relatedIds:['d','wall'],measurementBasis:'derived' as const,confidence:'high' as const,assumptions:[]};
  act(()=>root.render(<svg><PointPositionDimensions dimensions={[dimension]} unit="millimeters" viewRotation={0} annotationScale={1} onSelect={()=>{}} onLabelPositionChange={onChange} toPlanPoint={(x,y)=>[x,y]}/></svg>));
  const label=div.querySelector('[data-point-position-dimension-label="position"]') as SVGTextElement;
  Object.assign(label,{setPointerCapture:vi.fn(),hasPointerCapture:vi.fn(()=>true),releasePointerCapture:vi.fn()});
  act(()=>{label.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,clientX:5,clientY:.28,button:0}));label.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:8,clientY:.28,button:0}));label.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,clientX:8,clientY:.28,button:0}));});
  expect(onChange).toHaveBeenCalledWith('position',.2);
 });
});
