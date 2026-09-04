import { AffineMatrix2D, NodeData, Transform } from '../types';
import { composePascalTransformWithWorldToSvg, resolveAncestorLevelId, resolveItemPlanTransform, rotatePascalPlanVector } from './transform';

export type ShelfStyle = 'wall-shelf' | 'bookshelf' | 'open-rack' | 'cubby';
export type ShelfData = {
  width: number; depth: number; thickness: number; height: number; rows: number; columns: number;
  style: ShelfStyle; withBack: boolean; withSides: boolean; withBottom: boolean; bracketStyle: 'minimal' | 'industrial' | 'hidden';
  defaultFields: string[];
};
const defaults = { width: 1.2, depth: .3, thickness: .04, height: .9, rows: 1, columns: 1, style: 'wall-shelf', withBack: false, withSides: true, withBottom: false, bracketStyle: 'minimal' } as const;
const validStyle = new Set<ShelfStyle>(['wall-shelf', 'bookshelf', 'open-rack', 'cubby']);
const validBracket = new Set(['minimal', 'industrial', 'hidden']);
const number = (node: NodeData, key: keyof typeof defaults, min: number, max: number, integer = false) => {
  const value = node[key];
  if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))) return value;
  return defaults[key] as number;
};
/** Pascal ShelfNode defaults; invalid supplied dimensions are intentionally not replaced for drawing. */
export function resolveShelfData(node: NodeData): ShelfData {
  const defaultFields: string[] = [];
  const pick = <K extends keyof typeof defaults>(key: K, valid: boolean) => { if (!(key in node)) defaultFields.push(key); return valid ? node[key] : defaults[key]; };
  const width = number(node, 'width', .3, 3), depth = number(node, 'depth', .1, 1), thickness = number(node, 'thickness', .01, .1), height = number(node, 'height', .05, 2.5), rows = number(node, 'rows', 1, 8, true), columns = number(node, 'columns', 1, 6, true);
  for (const [key, value] of Object.entries({ width, depth, thickness, height, rows, columns })) if (!(key in node)) defaultFields.push(key);
  const style = validStyle.has(node.style) ? node.style : defaults.style; if (!('style' in node)) defaultFields.push('style');
  const bracketStyle = validBracket.has(node.bracketStyle) ? node.bracketStyle : defaults.bracketStyle; if (!('bracketStyle' in node)) defaultFields.push('bracketStyle');
  const bool = (key: 'withBack' | 'withSides' | 'withBottom') => { if (!(key in node)) defaultFields.push(key); return typeof node[key] === 'boolean' ? node[key] : defaults[key]; };
  return { width, depth, thickness, height, rows, columns, style, bracketStyle, withBack: bool('withBack'), withSides: bool('withSides'), withBottom: bool('withBottom'), defaultFields };
}
export function hasValidShelfFootprint(node: NodeData) { return Number.isFinite(node.width ?? defaults.width) && Number.isFinite(node.depth ?? defaults.depth) && (node.width === undefined || node.width >= .3 && node.width <= 3) && (node.depth === undefined || node.depth >= .1 && node.depth <= 1); }
export function resolveShelfPlanTransform(id: string, nodes: Record<string, NodeData>): Transform {
  const ancestry = resolveAncestorLevelId(id, nodes); const seen = new Set<string>();
  const fail = (error: string, sourceNodeIds: string[]): Transform => ({ x: 0, z: 0, rotationY: 0, sourceNodeIds, status: 'error', error });
  const walk = (nodeId: string): Transform => { if (seen.has(nodeId)) return fail('parent_cycle', [nodeId]); seen.add(nodeId); const node = nodes[nodeId]; if (!node) return fail('missing_parent', [nodeId]); const p = Array.isArray(node.position) ? node.position : [0,0,0], r = Array.isArray(node.rotation) ? node.rotation[1] ?? 0 : 0; const parent = nodes[node.parentId ?? '']; if (!node.parentId || !parent) return fail('missing_parent', [nodeId, node.parentId ?? '']); if (['level','slab','ceiling'].includes(parent.type)) return { x:p[0], z:p[2], rotationY:r, ancestorLevelId:ancestry.levelId, sourceNodeIds:[nodeId,parent.id], status:'ok' }; if (parent.type === 'item') { const base = resolveItemPlanTransform(parent.id, nodes); if (base.status === 'error') return base; const offset = rotatePascalPlanVector(p[0],p[2],base.rotationY); return { x:base.x+offset.x,z:base.z+offset.z,rotationY:base.rotationY+r,ancestorLevelId:ancestry.levelId,sourceNodeIds:[nodeId,...base.sourceNodeIds],status:'ok' }; } if (parent.type === 'shelf') { const base = walk(parent.id); if (base.status === 'error') return base; const offset = rotatePascalPlanVector(p[0],p[2],base.rotationY); return { x:base.x+offset.x,z:base.z+offset.z,rotationY:base.rotationY+r,ancestorLevelId:ancestry.levelId,sourceNodeIds:[nodeId,...base.sourceNodeIds],status:'ok' }; } return fail('unsupported_parent_transform',[nodeId,parent.id]); };
  const result = walk(id); return result.status === 'ok' ? { ...result, ancestorLevelId: ancestry.levelId } : result;
}
export function shelfMatrix(node: NodeData, nodes: Record<string, NodeData>): AffineMatrix2D | null { const transform = resolveShelfPlanTransform(node.id,nodes); return transform.status === 'ok' ? composePascalTransformWithWorldToSvg(transform) : null; }
export function shelfCorners(node: NodeData, nodes: Record<string, NodeData>) { const data = resolveShelfData(node), matrix = shelfMatrix(node,nodes); if (!matrix || !hasValidShelfFootprint(node)) return []; return [[-data.width/2,-data.depth/2],[data.width/2,-data.depth/2],[data.width/2,data.depth/2],[-data.width/2,data.depth/2]].map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,z:matrix.b*x+matrix.d*y+matrix.f})); }
export function shelfDividerXs(data: ShelfData) { return (data.style === 'bookshelf' || data.style === 'cubby') && data.columns > 1 ? Array.from({length:data.columns-1},(_,i)=>-((data.width-2*data.thickness)/2)+(i+1)*(data.width-2*data.thickness)/data.columns) : []; }
