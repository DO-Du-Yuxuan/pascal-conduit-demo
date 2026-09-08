import type { NodeData } from '../types';
import type { ConduitOverlayDocument, NetworkDevice, RoutingSystem } from '../domain/overlay';
import { DEVICE_DEFAULTS } from '../domain/devices';
import { formatMeasurement, type MeasurementUnit } from '../geometry/manual-measurement';
import { modelLevelBase, type PlanContext } from './model';

export type ConstructionDrawingVisibility = Record<RoutingSystem, boolean>;
export const CONSTRUCTION_DRAWING_LABELS: Record<RoutingSystem, string> = {
  receptacle: '插座施工图', lighting: '灯具施工图', network: '弱电施工图', sprinkler: '消防施工图',
};
export const CONSTRUCTION_DRAWING_SYSTEMS: RoutingSystem[] = ['receptacle', 'lighting', 'network', 'sprinkler'];
export const allConstructionDrawingsSelected = (visibility: ConstructionDrawingVisibility) => CONSTRUCTION_DRAWING_SYSTEMS.every(system => visibility[system]);
export const setAllConstructionDrawings = (checked: boolean): ConstructionDrawingVisibility => ({ receptacle: checked, lighting: checked, network: checked, sprinkler: checked });

export type InstallationScheduleRow = { deviceType: NetworkDevice['deviceType']; name: string; mounting: string; height: string; quantity: number; sourceIds: string[]; measurementBasis: 'explicit' | 'derived'; assumptions: string[]; confidence: 'high' | 'limited' };
export type InstallationScheduleSection = { system: RoutingSystem; label: string; rows: InstallationScheduleRow[] };

const wallAttachment = (device: NetworkDevice) => device.position.attachment?.hostKind === 'wall' || (device.mount?.kind === 'host' && device.mount.attachment.hostKind === 'wall');
export const usesExteriorHeightCallout = (device: NetworkDevice) => wallAttachment(device);

export function buildInstallationSchedule(nodes: Record<string, NodeData>, overlay: ConduitOverlayDocument, levelId: string, unit: MeasurementUnit, context: PlanContext): InstallationScheduleSection[] {
  const suffix = unit === 'millimeters' ? ' mm' : '';
  const rows = new Map<RoutingSystem, Map<string, InstallationScheduleRow>>();
  for (const device of overlay.devices) {
    if (!context.deviceVisible(device) || context.deviceLevel(device) !== levelId || usesExteriorHeightCallout(device)) continue;
    const system = device.systems.find(candidate => context.systemVisibility[candidate]);
    if (!system) continue;
    const mounting = device.mount?.kind === 'reference-plane' ? '安装参考面' : device.position.attachment?.hostKind === 'ceiling' ? '天花' : device.position.attachment?.hostKind === 'slab' ? '楼板' : '悬空';
    const heightMeters = device.mount?.kind === 'reference-plane' ? device.mount.elevationMm / 1000 : device.position.position[1] - modelLevelBase(nodes, levelId);
    const height = `${formatMeasurement(heightMeters, unit)}${suffix}`;
    const name = device.name.trim() || DEVICE_DEFAULTS[device.deviceType].label;
    const systemRows = rows.get(system) ?? new Map<string, InstallationScheduleRow>();
    const key = `${device.deviceType}|${name}|${mounting}|${height}`;
    const current = systemRows.get(key);
    if (current) { current.quantity += 1; current.sourceIds.push(device.id); }
    else systemRows.set(key, { deviceType: device.deviceType, name, mounting, height, quantity: 1, sourceIds: [device.id], measurementBasis: device.mount?.kind === 'reference-plane' ? 'explicit' : 'derived', confidence: device.mount?.kind === 'reference-plane' ? 'high' : 'limited', assumptions: [device.mount?.kind === 'reference-plane' ? '高度来自设备明确保存的楼层安装参考面。' : '高度按设备中心相对当前 3D 模型楼层基准计算，施工前需按完成面复核。'] });
    rows.set(system, systemRows);
  }
  return CONSTRUCTION_DRAWING_SYSTEMS.flatMap(system => {
    const sectionRows = [...(rows.get(system)?.values() ?? [])];
    return sectionRows.length ? [{ system, label: CONSTRUCTION_DRAWING_LABELS[system], rows: sectionRows }] : [];
  });
}
