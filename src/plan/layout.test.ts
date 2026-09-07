import {describe,expect,it} from 'vitest';
import {annotationRuleSide,layoutAnnotations,layoutExteriorAnnotations,overlaps,rotatePoint} from './layout';
import type {PlanAnnotation} from './model';
import type {ExteriorDimensionReport} from '../geometry/exterior-dimensions';
const a=(id:string):PlanAnnotation=>({id,sourceId:id,relatedIds:[id],levelId:'l',anchor:[2,3],kind:'height',text:`插座\nH=300 mm`,arrangement:'single',rows:[{sourceIds:[id],editableSourceId:id,label:'插座',count:1,height:'300 mm'}],measurementBasis:'derived',confidence:'limited',assumptions:[]});
describe('construction annotation layout',()=>{
 it('never overlaps placed text or reserved symbols even in a dense scene',()=>{
  const annotations=Array.from({length:100},(_,i)=>a(String(i))),obstacles=[{x:90,y:140,width:20,height:20}];
  const r=layoutAnnotations(annotations,50,0,obstacles,null);
  expect(r.hidden.length).toBeGreaterThan(0);expect(r.hidden.length+r.placed.length).toBe(100);
  r.placed.forEach((p,i)=>{expect(obstacles.some(o=>overlaps(p.box,o))).toBe(false);expect(r.placed.slice(i+1).some(q=>overlaps(p.box,q.box))).toBe(false);});
 });
 it('prioritizes selection, is deterministic, and uses pan-independent coordinates',()=>{
  const list=Array.from({length:60},(_,i)=>a(String(i)));
  const first=layoutAnnotations(list,40,90,[],'59');
  expect(first.placed[0].annotation.sourceId).toBe('59');
  expect(first).toEqual(layoutAnnotations([...list].reverse(),40,90,[],'59'));
  expect(rotatePoint([2,3],90,40)[0]).toBeCloseTo(-120);
  expect(first.placed[0].box.height).toBe(20);
  expect(layoutAnnotations(list,80,90,[],'59').placed[0].box.height).toBe(20);
 });
});

it('keeps separated point annotations in the same aligned lane',()=>{
 const exterior={runs:[{id:'bottom',levelId:'l',componentId:'c',start:[0,0],end:[10,0],direction:[1,0],outwardNormal:[0,-1],sourceWallIds:['w'],boundarySegments:[],lengthMeters:10}],rings:[],dimensions:[],diagnostics:[],summary:{}} as unknown as ExteriorDimensionReport;
 const result=layoutExteriorAnnotations([a('1'),{...a('2'),anchor:[4,3]},{...a('3'),anchor:[6,3]}],exterior,1);
 expect(result.hidden).toEqual([]);
 expect(result.placed.every(item=>item.label[1]<-.85)).toBe(true);
 expect(new Set(result.placed.map(item=>item.lane))).toEqual(new Set([0]));
 expect(result.placed[0].textHeight).toBeCloseTo(.6);
 expect(layoutExteriorAnnotations([a('1')],exterior,2).placed[0].textHeight).toBeCloseTo(1.2);
});

it('only staggers colliding callouts and returns later callouts to the main rule line',()=>{
 const exterior={runs:[{id:'left',levelId:'l',componentId:'c',start:[0,0],end:[0,10],direction:[0,1],outwardNormal:[-1,0],sourceWallIds:['w'],boundarySegments:[],lengthMeters:10}],rings:[{componentId:'c',ringId:'r',points:[[0,0],[10,0],[10,10],[0,10]],signedArea:100,winding:'counterclockwise',sourceWallIds:['w']}],dimensions:[],diagnostics:[],summary:{}} as unknown as ExteriorDimensionReport;
 const result=layoutExteriorAnnotations([[1,1],[2,1.25],[3,3],[4,5]].map(([id,y])=>({...a(String(id)),anchor:[2,y]})),exterior,1).placed.sort((x,y)=>Number(x.annotation.id)-Number(y.annotation.id));
 expect(result.map(item=>item.lane)).toEqual([1,0,0,0]);
 const ruleX=(item:typeof result[number])=>item.label[0]+item.textWidth/2;
 expect(ruleX(result[0])).not.toBeCloseTo(ruleX(result[1]));
 expect(ruleX(result[1])).toBeCloseTo(ruleX(result[2]));
 expect(ruleX(result[2])).toBeCloseTo(ruleX(result[3]));
});

it('moves the dimension-band crossing away from exterior dimension text',()=>{
 const exterior={runs:[{id:'bottom',levelId:'l',componentId:'c',start:[0,0],end:[10,0],direction:[1,0],outwardNormal:[0,-1],sourceWallIds:['w'],boundarySegments:[],lengthMeters:10}],rings:[],dimensions:[{runId:'bottom',valueMeters:2,displayMillimeters:'2000',sourceStart:{scalarOnRun:4},sourceEnd:{scalarOnRun:6}}],diagnostics:[],summary:{}} as unknown as ExteriorDimensionReport;
 const placed=layoutExteriorAnnotations([{...a('1'),anchor:[5,3]}],exterior,1).placed[0];
 expect(placed.boundary[0]).not.toBeCloseTo(5);
 expect(placed.boundary[0]<4.67||placed.boundary[0]>5.33).toBe(true);
});

it('puts the callout rule on the side facing the device and wholly beyond dimensions',()=>{
 const run=(id:string,start:[number,number],end:[number,number],direction:[number,number],outwardNormal:[number,number])=>({id,levelId:'l',componentId:'c',start,end,direction,outwardNormal,sourceWallIds:['w'],boundarySegments:[],lengthMeters:10});
 const report=(runs:ReturnType<typeof run>[])=>({runs,rings:[{componentId:'c',ringId:'r',points:[[0,0],[10,0],[10,10],[0,10]],signedArea:100,winding:'counterclockwise',sourceWallIds:['w']}],dimensions:[],diagnostics:[],summary:{}} as unknown as ExteriorDimensionReport);
 const left=layoutExteriorAnnotations([a('left')],report([run('left',[0,0],[0,10],[0,1],[-1,0])]),1).placed[0];
 const right=layoutExteriorAnnotations([{...a('right'),anchor:[8,3]}],report([run('right',[10,0],[10,10],[0,1],[1,0])]),1).placed[0];
 const top=layoutExteriorAnnotations([{...a('top'),anchor:[3,8]}],report([run('top',[0,10],[10,10],[1,0],[0,1])]),1).placed[0];
 expect(annotationRuleSide(left.outwardNormal,0)).toBe('right');
 expect(annotationRuleSide(right.outwardNormal,0)).toBe('left');
 expect(annotationRuleSide(top.outwardNormal,0)).toBe('left');
 expect(annotationRuleSide(left.outwardNormal,180)).toBe('left');
 expect(-left.label[0]-left.textWidth/2).toBeGreaterThan(.95);
 expect(right.label[0]-10-right.textWidth/2).toBeGreaterThan(.95);
 expect(top.label[1]-10-top.textHeight/2).toBeGreaterThan(.95);
});
