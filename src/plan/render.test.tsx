// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {NodeData} from '../types';
import {createEmptyOverlay,type ConduitOverlayDocument,type NetworkDevice} from '../domain/overlay';
import {createPlanContext} from './model';
import {ConduitPlanOverlay,devicePlanRotation} from './ConduitPlan';
import {ConstructionAnnotations,ConstructionNotices,missingConstructionDrawingLayout,useConstructionPlan} from './ConstructionAnnotations';
import {ConstructionLegend} from './ConstructionLegend';
import {PointPositionDimensions} from './PointPositionDimensions';
import {buildExteriorDimensions} from '../geometry/exterior-dimensions';
import {useOverlayStore} from '../domain/store';
const nodes={l:{id:'l',type:'level',level:0},w:{id:'w',type:'wall',parentId:'l',start:[0,0],end:[4,0],thickness:.2}} as unknown as Record<string,NodeData>;
const device:NetworkDevice={id:'d',type:'network-device',deviceType:'socket',name:'插座',position:{position:[1,.3,.1],attachment:{hostId:'w',hostKind:'wall',surface:'front',normal:[0,0,1],levelId:'l'}},sizeMm:[86,86,50],orientation:[0,0,0],systems:['receptacle'],ports:[],createdAt:''};
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
const roots:ReturnType<typeof createRoot>[]=[];
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.innerHTML='';useOverlayStore.setState({preview:null});vi.restoreAllMocks();});
function Harness({overlay,modelNodes=nodes,onAnnotationLabelPositionChange}:{overlay:ConduitOverlayDocument;modelNodes?:Record<string,NodeData>;onAnnotationLabelPositionChange?:(id:string,label:[number,number],signature:string)=>void}) {
 const ref=useRef<HTMLDivElement>(null),plan=useConstructionPlan({nodes:modelNodes,overlay,levelId:'l',hiddenNodeIds:new Set(),unit:'millimeters',rotation:90,viewBox:{minX:-5,minZ:-5,width:10,height:10},planRef:ref,selectedId:null,exterior:buildExteriorDimensions(modelNodes,'l'),dimensionsVisible:true,measurements:[],annotationScale:1});
 return <div ref={ref}><svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={plan.context} scale={plan.scale} rotation={90}/><ConstructionAnnotations plan={plan} rotation={90} onSelect={()=>{}} onLabelPositionChange={onAnnotationLabelPositionChange} toPlanPoint={(x,y)=>[x,y]}/></svg><ConstructionNotices plan={plan} onFocus={()=>{}}/></div>;
}
describe('construction plan rendering integration',()=>{
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
  const context=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:true,network:true,sprinkler:false});
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  const pipe=div.querySelector('[data-conduit-segment="network-pipe"]')!;
  expect(pipe.querySelector('[data-conduit-stroke="outline"]')?.getAttribute('stroke')).toBe('#00a6a0');
  expect(pipe.querySelector('[data-conduit-stroke="core"]')?.getAttribute('stroke')).toBe('#ffffff');
  const lighting=div.querySelector('[data-conduit-segment="lighting-pipe"]')!;
  expect(lighting.querySelector('[data-conduit-stroke="color"]')?.getAttribute('stroke')).toBe('#2563c7');
  expect(lighting.querySelector('[data-conduit-stroke="core"]')).toBeNull();
 });
 it('keeps switch control relations visible when the conduit layer is hidden',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),wallSwitch={...device,id:'switch',deviceType:'switch' as const,name:'开关',systems:['lighting' as const]},light={...device,id:'light',deviceType:'luminaire' as const,name:'灯具',systems:['lighting' as const],position:{position:[3,2.7,2] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l',elevationMm:2700}};
  overlay.devices=[wallSwitch,light];overlay.lightingControlGroups=[{id:'control',switchDeviceId:'switch',luminaireDeviceIds:['light'],createdAt:''}];
  overlay.segments=[{id:'pipe',type:'conduit-segment',system:'lighting',diameterMm:20,start:wallSwitch.position,end:light.position,createdAt:''}];
  const context=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:true,network:false,sprinkler:false});
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0} conduitsVisible={false}/></svg>));
  expect(div.querySelector('[data-lighting-control-line]')).not.toBeNull();
  expect(div.querySelector('[data-conduit-segment]')).toBeNull();
  expect(div.querySelector('[data-lighting-control-line]')?.textContent).toBe('');
 });
 it('renders one switch blade for each persisted control group',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),wallSwitch={...device,id:'switch',deviceType:'switch' as const,name:'开关',systems:['lighting' as const]};overlay.devices=[wallSwitch];
  overlay.lightingControlGroups=[{id:'a',switchDeviceId:'switch',luminaireDeviceIds:['light-a'],createdAt:''},{id:'b',switchDeviceId:'switch',luminaireDeviceIds:['light-b'],createdAt:''}];
  const context=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:true,network:false,sprinkler:false});
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  const symbol=div.querySelector('[data-device-symbol="switch"]');expect(symbol?.getAttribute('data-switch-gangs')).toBe('2');expect(symbol?.querySelectorAll('path')).toHaveLength(2);
 });
 it('renders an explicit pendent sprinkler symbol in the 2D plan',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),sprinkler={...device,id:'sprinkler',deviceType:'sprinkler-head' as const,name:'喷淋头',systems:['sprinkler' as const],sprinklerDirection:'pendent' as const,position:{position:[2,2.7,1] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l',elevationMm:2700}};overlay.devices=[sprinkler];
  const context=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:false,network:false,sprinkler:true});
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={50} rotation={0}/></svg>));
  const symbol=div.querySelector('[data-device-symbol="sprinkler-head"]');
  expect(symbol?.getAttribute('data-sprinkler-direction')).toBe('pendent');
  expect(symbol?.querySelectorAll('path')[1]?.getAttribute('d')).toContain('M0-10V10');
 });
 it('renders a sensor only while the dedicated sensor layer is visible',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha'),sensor={...device,id:'sensor',deviceType:'sensor' as const,name:'传感器',systems:[] as [],ports:[],position:{position:[2,2.7,1] as [number,number,number]},mount:{kind:'reference-plane' as const,levelId:'l',elevationMm:2700}};overlay.devices=[sensor];
  const visible=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:false,network:false,sprinkler:false},true);
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={visible} scale={50} rotation={0}/></svg>));
  expect(div.querySelector('[data-device-symbol="sensor"]')).not.toBeNull();
  const hidden=createPlanContext(nodes,overlay,new Set(),{receptacle:false,lighting:false,network:false,sprinkler:false},false);
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
 it('renders ceiling-device installation information in the drawing schedule',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const sections=[{system:'lighting' as const,label:'灯具施工图',rows:[{deviceType:'luminaire' as const,name:'筒灯',mounting:'安装参考面',height:'1500 mm',heightMeters:1.5,quantity:2,sourceIds:['a','b'],measurementBasis:'explicit' as const,confidence:'high' as const,assumptions:['高度来自安装参考面']}]}];
  act(()=>root.render(<ConstructionLegend sections={sections} annotationScale={1}/>));
  expect(div.querySelector('[aria-label="点位图例及安装高度表"]')).not.toBeNull();
  expect(div.querySelector('[aria-label="筒灯图块"]')).not.toBeNull();
  expect(div.querySelector('[data-schedule-row]')?.getAttribute('title')).toContain('依据：explicit');
  expect(div.textContent).toContain('筒灯');expect(div.textContent).toContain('H=1500 mm');expect(div.textContent).toContain('×2');
 });
 it('shows an incomplete-chain notice when a ceiling point has no wall on one side',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const openNodes={l:nodes.l,west:{id:'west',type:'wall',parentId:'l',start:[0,0],end:[0,6],thickness:.2}} as Record<string,NodeData>,overlay=createEmptyOverlay('a','sha');
  overlay.devices=[{...device,id:'open-light',deviceType:'luminaire',name:'灯具',systems:['lighting'],position:{position:[2,2.7,3]},mount:{kind:'reference-plane',levelId:'l',elevationMm:2700}}];
  act(()=>root.render(<Harness overlay={overlay} modelNodes={openNodes}/>));
  expect(div.textContent).toContain('该方向定位尺寸链未闭合');
 });
 it('renders a persisted point-position label placement along its dimension line',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const dimension={id:'position',sourceId:'d',levelId:'l',reference:[0,0] as [number,number],center:[10,0] as [number,number],referenceWitness:[0,0] as [number,number],centerWitness:[10,0] as [number,number],direction:[1,0] as [number,number],normal:[0,1] as [number,number],lane:0,valueMeters:10,referenceKind:'wall-face' as const,relatedIds:['d','wall'],measurementBasis:'derived' as const,confidence:'high' as const,assumptions:[]};
  act(()=>root.render(<svg><PointPositionDimensions dimensions={[dimension]} unit="millimeters" viewRotation={0} annotationScale={1} onSelect={()=>{}} labelPositions={{position:.8}} /></svg>));
  const label=div.querySelector('[data-point-position-dimension-label="position"]');
  expect(Number(label?.getAttribute('x'))).toBeCloseTo(8);
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
