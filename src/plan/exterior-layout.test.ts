import {expect,it} from 'vitest';
import {buildExteriorDimensions,buildAlignedDimensionDisplay} from '../geometry/exterior-dimensions';
import type {NodeData} from '../types';
import {exteriorGraphics} from './exterior-layout';
import {overlaps} from './layout';
const nodes={l:{id:'l',type:'level'},w:{id:'w',type:'wall',parentId:'l',start:[0,0],end:[4,0],thickness:.2}} as unknown as Record<string,NodeData>;
it('keeps all exterior measurement evidence unchanged while laying out legible text',()=>{
 const report=buildExteriorDimensions(nodes,'l'),before=JSON.stringify(report);
 expect(report.dimensions.length).toBeGreaterThan(0);
 for(const rotation of [0,45,90,180]) for(const scale of [20,60,150]) {
  const graphics=exteriorGraphics(report,'millimeters',scale,rotation);
  expect(graphics.length).toBeGreaterThan(0);
  graphics.forEach((g,i)=>{expect(g.box.height).toBe(20);expect(graphics.slice(i+1).some(b=>overlaps(g.box,b.box))).toBe(false);expect(buildAlignedDimensionDisplay(report).find(d=>d.id===g.dimension.id)?.valueMeters).toBe(g.dimension.valueMeters);});
 }
 expect(JSON.stringify(report)).toBe(before);
});
