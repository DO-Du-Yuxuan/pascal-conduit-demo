// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {NodeData} from '../types';
import {createEmptyOverlay,type ConduitOverlayDocument,type NetworkDevice} from '../domain/overlay';
import {createPlanContext} from './model';
import {ConduitPlanOverlay,devicePlanRotation} from './ConduitPlan';
import {ConstructionAnnotations,ConstructionNotices,useConstructionPlan} from './ConstructionAnnotations';
import {buildExteriorDimensions} from '../geometry/exterior-dimensions';
import {useOverlayStore} from '../domain/store';
const nodes={l:{id:'l',type:'level',level:0},w:{id:'w',type:'wall',parentId:'l',start:[0,0],end:[4,0],thickness:.2}} as unknown as Record<string,NodeData>;
const device:NetworkDevice={id:'d',type:'network-device',deviceType:'socket',name:'插座',position:{position:[1,.3,.1],attachment:{hostId:'w',hostKind:'wall',surface:'front',normal:[0,0,1],levelId:'l'}},sizeMm:[86,86,50],orientation:[0,0,0],systems:['receptacle'],ports:[],createdAt:''};
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
const roots:ReturnType<typeof createRoot>[]=[];
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.innerHTML='';useOverlayStore.setState({preview:null});vi.restoreAllMocks();});
function Harness({overlay}:{overlay:ConduitOverlayDocument}) {
 const ref=useRef<HTMLDivElement>(null),plan=useConstructionPlan({nodes,overlay,levelId:'l',hiddenNodeIds:new Set(),unit:'millimeters',rotation:90,viewBox:{minX:-5,minZ:-5,width:10,height:10},planRef:ref,selectedId:null,exterior:buildExteriorDimensions(nodes,'l'),dimensionsVisible:true,measurements:[],annotationScale:1});
 return <div ref={ref}><svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={plan.context} scale={plan.scale} rotation={90}/><ConstructionAnnotations plan={plan} rotation={90} onSelect={()=>{}}/></svg><ConstructionNotices plan={plan} onFocus={()=>{}}/></div>;
}
describe('construction plan rendering integration',()=>{
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
  expect(div.textContent).toContain('300 mm');
  const moved={...overlay,devices:[{...device,position:{...device.position,position:[2,.6,.1] as [number,number,number]}}]};
  act(()=>root.render(<Harness overlay={moved}/>));expect(div.textContent).toContain('600 mm');expect(div.textContent).not.toContain('300 mm');
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
  act(()=>root.render(<svg><ConduitPlanOverlay overlay={overlay} levelId="l" selectedId={null} onSelect={()=>{}} context={context} scale={100} rotation={0} annotationScale={2}/></svg>));
  expect(div.querySelector('[data-device-symbol="socket"]')?.getAttribute('transform')).toContain('scale(0.036)');
 });
 it('opens an inline editor only when the device description is double-clicked',()=>{
  const div=document.createElement('div');document.body.append(div);const root=createRoot(div);roots.push(root);
  const overlay=createEmptyOverlay('a','sha');overlay.devices=[device];useOverlayStore.getState().load(overlay);
  act(()=>root.render(<Harness overlay={overlay}/>));
  const description=[...div.querySelectorAll('text')].find(node=>node.textContent==='插座');expect(description).toBeTruthy();
  act(()=>description!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
  expect(div.querySelector('foreignObject input')).not.toBeNull();
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
});
