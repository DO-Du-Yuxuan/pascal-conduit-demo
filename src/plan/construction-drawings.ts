import type { NodeData } from '../types';
import type { ConduitOverlayDocument, NetworkDevice, RoutingSystem } from '../domain/overlay';
import { formatMeasurement, type MeasurementUnit } from '../geometry/manual-measurement';
import { deviceInstallationHeightMeters, devicePlanLabel, isFloorSocket, type PlanContext } from './model';

export type ConstructionDrawingSystem = RoutingSystem | 'sensor';
export type ConstructionDrawingVisibility = Record<RoutingSystem, boolean> & { sensor?: boolean };
export const CONSTRUCTION_DRAWING_LABELS: Record<ConstructionDrawingSystem, string> = {
  receptacle: '插座施工图', lighting: '灯具施工图', network: '弱电施工图', sprinkler: '消防施工图',
  sensor: '传感器施工图',
};
export const CONSTRUCTION_DRAWING_SYSTEMS: ConstructionDrawingSystem[] = ['receptacle', 'lighting', 'network', 'sprinkler', 'sensor'];
export const allConstructionDrawingsSelected = (visibility: ConstructionDrawingVisibility) => CONSTRUCTION_DRAWING_SYSTEMS.every(system => system === 'sensor' ? visibility.sensor !== false : visibility[system]);
export const setAllConstructionDrawings = (checked: boolean): ConstructionDrawingVisibility => ({ receptacle: checked, lighting: checked, network: checked, sprinkler: checked, sensor: checked });

export type InstallationScheduleRow = { variant?: string; deviceType: NetworkDevice['deviceType']; name: string; mounting: string; height: string; heightMeters: number; quantity: number; sourceIds: string[]; measurementBasis: 'explicit' | 'derived'; assumptions: string[]; confidence: 'high' | 'limited' };
export type InstallationScheduleSection = { system: ConstructionDrawingSystem; label: string; rows: InstallationScheduleRow[] };

const wallAttachment = (device: NetworkDevice) => device.position.attachment?.hostKind === 'wall' || (device.mount?.kind === 'host' && device.mount.attachment.hostKind === 'wall');
export const usesExteriorHeightCallout = (device: NetworkDevice) => wallAttachment(device);

export function buildInstallationSchedule(nodes: Record<string, NodeData>, overlay: ConduitOverlayDocument, levelId: string, unit: MeasurementUnit, context: PlanContext): InstallationScheduleSection[] {
  const suffix = unit === 'millimeters' ? ' mm' : '';
  const rows = new Map<ConstructionDrawingSystem, Map<string, InstallationScheduleRow>>();
  for (const device of overlay.devices) {
    if (!context.deviceVisible(device) || context.deviceLevel(device) !== levelId || usesExteriorHeightCallout(device)) continue;
    const system: ConstructionDrawingSystem | undefined = device.deviceType === 'sensor' ? context.sensorVisible ? 'sensor' : undefined : device.systems.find(candidate => context.systemVisibility[candidate]);
    if (!system) continue;
    const mounting = device.mount?.kind === 'reference-plane' ? '安装参考面' : device.position.attachment?.hostKind === 'ceiling' ? '天花' : device.position.attachment?.hostKind === 'slab' ? '楼板' : '悬空';
    const heightMeters = deviceInstallationHeightMeters(device, nodes, levelId);
    const height = `${formatMeasurement(heightMeters, unit)}${suffix}`;
    const name = devicePlanLabel(device, overlay);
    const floorSocket = isFloorSocket(device);
    const systemRows = rows.get(system) ?? new Map<string, InstallationScheduleRow>();
    const key = `${device.deviceType}|${name}|${mounting}|${height}`;
    const current = systemRows.get(key);
    if (current) { current.quantity += 1; current.sourceIds.push(device.id); }
    else systemRows.set(key, { deviceType: device.deviceType, name, mounting, height, heightMeters, quantity: 1, sourceIds: [device.id], measurementBasis: device.mount?.kind === 'reference-plane' ? 'explicit' : 'derived', confidence: device.mount?.kind === 'reference-plane' || floorSocket ? 'high' : 'limited', assumptions: [device.mount?.kind === 'reference-plane' ? '高度来自设备明确保存的楼层安装参考面，与 3D“完成地标高”一致。' : floorSocket ? '插座明确挂载楼板顶面，施工图按地插显示，安装高度记为 0。' : '高度按设备下边缘相对当前 3D 模型楼层基准计算，与 3D“下边缘离地”一致；施工前需按完成面复核。'] });
    rows.set(system, systemRows);
  }
  return CONSTRUCTION_DRAWING_SYSTEMS.flatMap(system => {
    const sectionRows = [...(rows.get(system)?.values() ?? [])].sort((a, b) => a.deviceType.localeCompare(b.deviceType) || a.mounting.localeCompare(b.mounting) || b.heightMeters - a.heightMeters || a.name.localeCompare(b.name));
    const variants = new Map<string, InstallationScheduleRow[]>();
    sectionRows.forEach(row => { const key = `${row.deviceType}|${row.mounting}`; variants.set(key, [...(variants.get(key) ?? []), row]); });
    variants.forEach(group => {
      const heights = [...new Set(group.map(row => row.height))];
      if (heights.length > 1) group.forEach(row => { const index = heights.indexOf(row.height); row.variant = index < 26 ? String.fromCharCode(65 + index) : `A${index + 1}`; });
    });
    return sectionRows.length ? [{ system, label: CONSTRUCTION_DRAWING_LABELS[system], rows: sectionRows }] : [];
  });
}

export function installationVariantByDeviceId(sections: InstallationScheduleSection[]): Record<string, string> {
  return Object.fromEntries(sections.flatMap(section => section.rows.flatMap(row => row.variant ? row.sourceIds.map(id => [id, row.variant!] as const) : [])));
}
