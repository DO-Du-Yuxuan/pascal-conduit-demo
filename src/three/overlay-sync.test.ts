import { describe, expect, it } from 'vitest';
import { createEmptyOverlay } from '../domain/overlay';
import { editDevicePosition } from '../domain/device-positioning';
import { synchronizedOverlay } from './overlay-sync';

describe('3D Overlay synchronization', () => {
  it('preserves 2D placement when a later 3D height edit starts from the synchronized Overlay', () => {
    const stale = createEmptyOverlay('plan.json', 'sha', 'project');
    const shared = {
      ...stale,
      devices: [{ id: 'socket', type: 'network-device' as const, deviceType: 'socket' as const, name: '插座', position: { position: [1, .3, 0] as [number, number, number], attachment: { hostId: 'wall', hostKind: 'wall' as const, surface: 'interior', normal: [0, 0, 1] as [number, number, number], levelId: 'level', localPosition: [1, .3, 0] as [number, number, number], basis: { u: [1, 0, 0] as [number, number, number], v: [0, 1, 0] as [number, number, number] } } }, sizeMm: [86, 86, 50] as [number, number, number], orientation: [0, 0, 1] as [number, number, number], systems: ['receptacle' as const], ports: [], createdAt: '' }],
      constructionAnnotationLabelPositions: { 'group:socket': [7, -3] as [number, number] },
      pointPositionDimensionLabelPositions: { 'socket:position:from:wall': .75 },
      pointPositionDimensionLineOffsets: { 'socket:position:from:wall': .6 },
    };
    const synchronized = synchronizedOverlay(stale, shared, 'sha', 'project');
    expect(synchronized).toBe(shared);
    const result = editDevicePosition(synchronized!, { deviceIds: ['socket'], bottomHeightMm: 900 }, { levelFloorY: { level: 0 }, wallSpans: { wall: [0, 4] } }, 'commit');
    expect(result.overlay.constructionAnnotationLabelPositions).toEqual(shared.constructionAnnotationLabelPositions);
    expect(result.overlay.pointPositionDimensionLabelPositions).toEqual(shared.pointPositionDimensionLabelPositions);
    expect(result.overlay.pointPositionDimensionLineOffsets).toEqual(shared.pointPositionDimensionLineOffsets);
  });

  it('does not replace local interaction state for an unchanged or foreign Overlay', () => {
    const current = createEmptyOverlay('plan.json', 'sha', 'project');
    expect(synchronizedOverlay(current, current, 'sha', 'project')).toBeNull();
    expect(synchronizedOverlay(current, createEmptyOverlay('other.json', 'other', 'other-project'), 'sha', 'project')).toBeNull();
  });
});
