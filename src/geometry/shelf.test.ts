import { describe, expect, it } from 'vitest';
import reference from '../../sample-data/Bellevue demo.json';
import { finalDimensions, resolveAncestorLevelId, resolveItemPlanTransform } from './transform';
import { hasValidShelfFootprint, resolveShelfData, resolveShelfPlanTransform, shelfCorners, shelfDividerXs, shelfMatrix } from './shelf';

const shelf = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'shelf', parentId: 'level', position: [2, 0, 3], rotation: [0, 0, 0], width: 2, depth: .5, ...extra });
const nodesFor = (node: any) => ({ level: { id: 'level', type: 'level' }, [node.id]: node });

describe('Pascal shelf floorplan', () => {
  it('uses schema defaults only for absent fields and preserves the supplied footprint', () => {
    const data = resolveShelfData(shelf('s', { width: 1.8, depth: .6 }));
    expect(data).toMatchObject({ width: 1.8, depth: .6, thickness: .04, height: .9, rows: 1, columns: 1, style: 'wall-shelf' });
    expect(data.defaultFields).toContain('thickness');
  });
  it('centres the footprint on position x/z and uses Pascal plan rotation at cardinal angles', () => {
    for (const rotation of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const node = shelf(`s-${rotation}`, { rotation: [0, rotation, 0] }), nodes = nodesFor(node), matrix = shelfMatrix(node, nodes)!;
      expect(matrix.e).toBeCloseTo(2); expect(matrix.f).toBeCloseTo(3);
      expect(matrix.a).toBeCloseTo(Math.cos(rotation)); expect(matrix.b).toBeCloseTo(-Math.sin(rotation));
      expect(shelfCorners(node, nodes)).toHaveLength(4);
    }
  });
  it('emits only grid-style column dividers', () => {
    expect(shelfDividerXs(resolveShelfData(shelf('book', { style: 'bookshelf', columns: 4 })))).toHaveLength(3);
    expect(shelfDividerXs(resolveShelfData(shelf('cubby', { style: 'cubby', columns: 3 })))).toHaveLength(2);
    expect(shelfDividerXs(resolveShelfData(shelf('wall', { style: 'wall-shelf', columns: 4 })))).toEqual([]);
    expect(shelfDividerXs(resolveShelfData(shelf('rack', { style: 'open-rack', columns: 4 })))).toEqual([]);
  });
  it('resolves a shelf ancestor level and rejects missing or cyclic parents', () => {
    const valid = shelf('valid'); expect(resolveShelfPlanTransform(valid.id, nodesFor(valid)).ancestorLevelId).toBe('level');
    const missing = shelf('missing', { parentId: 'gone' }); expect(resolveShelfPlanTransform(missing.id, nodesFor(missing)).error).toBe('missing_parent');
    const cycle = shelf('cycle', { parentId: 'cycle' }); expect(resolveShelfPlanTransform(cycle.id, nodesFor(cycle)).error).toBe('parent_cycle');
  });
  it('does not create a fallback footprint for invalid shelf dimensions', () => {
    const node = shelf('bad', { width: 0 }); expect(hasValidShelfFootprint(node)).toBe(false); expect(shelfCorners(node, nodesFor(node))).toEqual([]);
  });
  it('keeps shelf child item matrices unchanged', () => {
    const parent = shelf('s', { rotation: [0, Math.PI / 2, 0] }); const child: any = { id: 'item', type: 'item', parentId: 's', position: [1, 0, 0], rotation: [0, 0, 0], scale: [1,1,1], asset: { dimensions: [1,1,1] } }; const nodes: any = { level: { id: 'level', type: 'level' }, s: parent, item: child };
    const before = resolveItemPlanTransform('item', nodes); shelfMatrix(parent, nodes); expect(resolveItemPlanTransform('item', nodes)).toEqual(before); expect(finalDimensions(child)).toEqual({ width: 1, height: 1, depth: 1 });
  });
  it('counts reference shelves generically without node identifiers', () => {
    const shelves = Object.values(reference.nodes).filter((node: any) => node.type === 'shelf');
    expect(shelves.length).toBeGreaterThan(0); expect(shelves.every((node: any) => resolveAncestorLevelId(node.id, reference.nodes as any).levelId)).toBe(true);
  });
});
