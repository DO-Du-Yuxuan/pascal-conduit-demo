import { describe, expect, it } from 'vitest';
import type { NodeData } from '../types';
import { createEmptyOverlay, type HostAttachment, type NetworkDevice } from '../domain/overlay';
import { buildInstallationSchedule, setAllConstructionDrawings, type ConstructionDrawingVisibility } from './construction-drawings';
import { createPlanContext } from './model';

const nodes = { level: { id: 'level', type: 'level', level: 0 }, wall: { id: 'wall', type: 'wall', parentId: 'level', start: [0, 0], end: [4, 0] } } as unknown as Record<string, NodeData>;
const wallAttachment: HostAttachment = { hostId: 'wall', hostKind: 'wall', levelId: 'level', surface: 'front', normal: [0, 0, 1] };
const device = (id: string, deviceType: NetworkDevice['deviceType'], systems: NetworkDevice['systems'], y: number, attachment?: HostAttachment): NetworkDevice => ({ id, type: 'network-device', deviceType, name: deviceType === 'luminaire' ? '筒灯' : '插座', position: { position: [1, y, 1], attachment }, sizeMm: [86, 86, 50], orientation: [0, 0, 0], systems, ports: [], createdAt: '' });

describe('construction drawing visibility and installation schedule', () => {
  it('turns all four construction drawings on and off as one global selection', () => {
    const partial: ConstructionDrawingVisibility = { receptacle: true, lighting: false, network: true, sprinkler: false };
    expect(partial.receptacle).toBe(true);
    expect(setAllConstructionDrawings(true)).toEqual({ receptacle: true, lighting: true, network: true, sprinkler: true });
    expect(setAllConstructionDrawings(false)).toEqual({ receptacle: false, lighting: false, network: false, sprinkler: false });
  });

  it('lists only visible ceiling or suspended devices and groups equal rows by quantity', () => {
    const overlay = createEmptyOverlay('a', 'sha');
    overlay.devices = [
      device('wall-socket', 'socket', ['receptacle'], .3, wallAttachment),
      { ...device('light-a', 'luminaire', ['lighting'], 1.5), mount: { kind: 'reference-plane', levelId: 'level', elevationMm: 1500 } },
      { ...device('light-b', 'luminaire', ['lighting'], 1.5), mount: { kind: 'reference-plane', levelId: 'level', elevationMm: 1500 } },
      { ...device('sprinkler', 'sprinkler-head', ['sprinkler'], 2.7), mount: { kind: 'reference-plane', levelId: 'level', elevationMm: 2700 } },
    ];
    const visible = { receptacle: false, lighting: true, network: false, sprinkler: false };
    const sections = buildInstallationSchedule(nodes, overlay, 'level', 'millimeters', createPlanContext(nodes, overlay, new Set(), visible));
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ system: 'lighting', label: '灯具施工图' });
    expect(sections[0].rows).toEqual([expect.objectContaining({ deviceType: 'luminaire', name: '筒灯', mounting: '安装参考面', height: '1500 mm', quantity: 2, sourceIds: ['light-a', 'light-b'], measurementBasis: 'explicit', confidence: 'high' })]);
  });
});
