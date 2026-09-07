import type { PlanAnnotation, Point } from './model';
import { EXTENSION_OVERSHOOT_M, OVERALL_CHAIN_OFFSET_M, type ExteriorDimensionReport, type ExteriorDimensionRun } from '../geometry/exterior-dimensions';
export type Rect = { x: number; y: number; width: number; height: number };
export type PlacedAnnotation = { annotation: PlanAnnotation; box: Rect; anchor: Point };
export type ExteriorPlacedAnnotation = { annotation: PlanAnnotation; innerBend: Point; boundary: Point; outerBend: Point; label: Point; textWidth: number; textHeight: number; lane: number; outwardNormal: Point };
export const rotatePoint = (p: Point, rotation: number, scale = 1): Point => { const r = rotation * Math.PI / 180; return [(p[0] * Math.cos(r) - p[1] * Math.sin(r)) * scale, (p[0] * Math.sin(r) + p[1] * Math.cos(r)) * scale]; };
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width + 4 && a.x + a.width + 4 > b.x && a.y < b.y + b.height + 4 && a.y + a.height + 4 > b.y;
export const textWidth = (text: string) => Array.from(text).reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 12 : 7.4), 0) + 12;
/** Coordinates are rotated world coordinates in pixels: translation/panning is
 * deliberately absent, so panning never changes label placement. */
export function layoutAnnotations(annotations: PlanAnnotation[], scale: number, rotation: number, obstacles: Rect[], selectedId: string | null) {
  const occupied = [...obstacles], placed: PlacedAnnotation[] = [], hidden: PlanAnnotation[] = [];
  const sorted = [...annotations].sort((a,b) => Number(b.sourceId === selectedId || b.relatedIds.includes(selectedId ?? '')) - Number(a.sourceId === selectedId || a.relatedIds.includes(selectedId ?? '')) || a.id.localeCompare(b.id));
  for (const annotation of sorted) {
    const anchor = rotatePoint(annotation.anchor, rotation, scale), width = textWidth(annotation.text), height = 20;
    let box: Rect | undefined;
    const radii = annotation.sourceId === selectedId || annotation.relatedIds.includes(selectedId ?? '') ? [18, 44, 76, 112, 160, 220, 290] : [18, 44, 76, 112, 160];
    for (const d of radii) {
      const candidates: Rect[] = [[d,-height/2],[-width-d,-height/2],[-width/2,-height-d],[-width/2,d],[d,-height-d],[-width-d,d],[d,d],[-width-d,-height-d]].map(([x,y]) => ({ x: anchor[0]+x, y: anchor[1]+y, width, height }));
      box = candidates.find(candidate => occupied.every(other => !overlaps(candidate, other)));
      if (box) break;
    }
    if (!box) hidden.push(annotation);
    else { occupied.push(box); placed.push({ annotation, box, anchor }); }
  }
  return { placed, hidden };
}

const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point, amount: number): Point => [a[0] + b[0] * amount, a[1] + b[1] * amount];
export function annotationRuleSide(outwardNormal:Point,rotation:number):'left'|'right'{const screen=rotatePoint(outwardNormal,rotation);return Math.abs(screen[0])>Math.abs(screen[1])&&screen[0]<0?'right':'left';}
function nearestRun(anchor: Point, runs: ExteriorDimensionRun[]) {
  return runs.map(run => {
    const scalar = Math.max(0, Math.min(run.lengthMeters, dot(subtract(anchor, run.start), run.direction)));
    const boundary = add(run.start, run.direction, scalar), distance = Math.hypot(anchor[0] - boundary[0], anchor[1] - boundary[1]);
    return { run, scalar, boundary, distance };
  }).sort((a, b) => a.distance - b.distance || a.run.id.localeCompare(b.run.id))[0];
}

/** Places point callouts in model space beyond the existing outer dimension chain. */
export function layoutExteriorAnnotations(annotations: PlanAnnotation[], exterior: ExteriorDimensionReport, annotationScale: number): { placed: ExteriorPlacedAnnotation[]; hidden: PlanAnnotation[] } {
  const assignments = annotations.map(annotation => ({ annotation, nearest: nearestRun(annotation.anchor, exterior.runs) })).filter(item => item.nearest) as Array<{ annotation: PlanAnnotation; nearest: NonNullable<ReturnType<typeof nearestRun>> }>;
  const hidden = annotations.filter(annotation => !assignments.some(item => item.annotation.id === annotation.id));
  const groups = new Map<string, typeof assignments>();
  const sideKey=(run:ExteriorDimensionRun)=>`${run.componentId}:${Math.abs(run.outwardNormal[0])>=Math.abs(run.outwardNormal[1])?(run.outwardNormal[0]<0?'left':'right'):(run.outwardNormal[1]<0?'top':'bottom')}`;
  assignments.forEach(item => {const key=sideKey(item.nearest.run);groups.set(key,[...(groups.get(key)??[]),item]);});
  const placed: ExteriorPlacedAnnotation[] = [], fontSize = .2 * annotationScale, lineHeight = .3 * annotationScale;
  for (const group of groups.values()) {
    const measured=group.map(item=>{const commonHeight=item.annotation.rows.every(row=>row.height===item.annotation.rows[0]?.height),lineCount=item.annotation.arrangement==='horizontal'&&commonHeight?item.annotation.rows.length+1:item.annotation.rows.length*2,textHeight=lineCount*lineHeight,
      displayLines=item.annotation.rows.flatMap(row=>[`${row.label}${row.count>1?` × ${row.count}`:''}${row.position?`  ${row.position}`:''}`,`H=${row.height}`]),textWidthWorld=Math.max(.8,...displayLines.map(line=>Array.from(line).reduce((width,char)=>width+(char.charCodeAt(0)>255?fontSize:fontSize*.58),0)+.24*annotationScale)),
      horizontalSide=Math.abs(item.nearest.run.outwardNormal[0])>=Math.abs(item.nearest.run.outwardNormal[1]),tangent=item.nearest.boundary[horizontalSide?1:0],tangentExtent=(horizontalSide?textHeight:textWidthWorld)/2;
      return {item,textHeight,textWidthWorld,horizontalSide,tangent,tangentExtent};}).sort((a,b)=>b.tangent-a.tangent||a.item.annotation.id.localeCompare(b.item.annotation.id));
    const laneEnds:number[]=[];
    measured.forEach(({item,textHeight,textWidthWorld,horizontalSide,tangent,tangentExtent}) => {
        let lane=laneEnds.findIndex(start=>start-(tangent+tangentExtent)>=lineHeight/2);
        if(lane<0)lane=laneEnds.length;
        laneEnds[lane]=tangent-tangentExtent;
        const run = item.nearest.run;
        const forbidden=exterior.dimensions.filter(d=>d.runId===run.id).map(d=>{const width=Math.max(.24,d.displayMillimeters.length*.105),fits=d.valueMeters>width+.16,center=fits?(d.sourceStart.scalarOnRun+d.sourceEnd.scalarOnRun)/2:d.sourceEnd.scalarOnRun+width/2+.14;return {start:center-width/2-.12,end:center+width/2+.12};});
        let crossing=item.nearest.scalar;
        for(let attempt=0;attempt<forbidden.length+1;attempt++){const hit=forbidden.find(interval=>crossing>=interval.start&&crossing<=interval.end);if(!hit)break;const left=Math.max(0,hit.start-.08),right=Math.min(run.lengthMeters,hit.end+.08);crossing=Math.abs(crossing-left)<=Math.abs(right-crossing)?left:right;}
        const scalar = crossing;
        const normalExtent=horizontalSide?textWidthWorld/2:textHeight/2,
          outsideDimensionChain=OVERALL_CHAIN_OFFSET_M+EXTENSION_OVERSHOOT_M+.12,
          offset=outsideDimensionChain+normalExtent+lane*((horizontalSide?textWidthWorld:textHeight)+.14),
          componentPoints=exterior.rings.filter(ring=>ring.componentId===run.componentId).flatMap(ring=>ring.points),
          sideEdge=componentPoints.length?(horizontalSide?(run.outwardNormal[0]<0?Math.min(...componentPoints.map(p=>p[0])):Math.max(...componentPoints.map(p=>p[0]))):(run.outwardNormal[1]<0?Math.min(...componentPoints.map(p=>p[1])):Math.max(...componentPoints.map(p=>p[1])))):dot(run.start,run.outwardNormal),
          tangentPoint=add(run.start,run.direction,scalar),label:Point=horizontalSide?[sideEdge+run.outwardNormal[0]*offset,tangentPoint[1]]:[tangentPoint[0],sideEdge+run.outwardNormal[1]*offset];
        const boundary=add(run.start,run.direction,crossing),outerBend:Point=horizontalSide?[label[0],boundary[1]]:[boundary[0],label[1]];
        const innerBend: Point = Math.abs(run.direction[0]) >= Math.abs(run.direction[1]) ? [boundary[0], item.annotation.anchor[1]] : [item.annotation.anchor[0], boundary[1]];
        placed.push({ annotation: item.annotation, innerBend, boundary, outerBend, label, textWidth: textWidthWorld, textHeight, lane, outwardNormal:run.outwardNormal });
    });
  }
  return { placed, hidden };
}
