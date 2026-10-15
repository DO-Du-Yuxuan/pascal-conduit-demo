import type { NodeData } from '../types';
import type { ConduitOverlayDocument, NetworkDevice, RoutingSystem, SprinklerDirection } from '../domain/overlay';
import { sprinklerDirectionOf } from '../domain/devices';
import { formatMeasurement, type MeasurementUnit } from '../geometry/manual-measurement';
import { deviceConstructionHeight, deviceHostAttachment, devicePlanLabel, isFloorSocket, type PlanContext } from './model';

export type ConstructionDrawingSystem = RoutingSystem | 'sensor';
export type ConstructionDrawingVisibility = Record<RoutingSystem, boolean> & { sensor?: boolean };
export type FireDrawingVisibility = Pick<ConstructionDrawingVisibility, 'sprinkler' | 'fire-signal'>;
export const fireDrawingIsVisible = (visibility: FireDrawingVisibility): boolean => visibility.sprinkler && visibility['fire-signal'];
export function setFireDrawingVisibility<T extends FireDrawingVisibility>(visibility: T, visible: boolean): T {
  return { ...visibility, sprinkler: visible, 'fire-signal': visible };
}
export const CONSTRUCTION_DRAWING_LABELS: Record<ConstructionDrawingSystem, string> = {
  receptacle: '插座施工图', lighting: '灯位接线盒施工图', network: '弱电施工图', sprinkler: '消防施工图',
  'fire-signal': '消防信号施工图', sensor: '传感器施工图',
};
export const CONSTRUCTION_DRAWING_SYSTEMS: ConstructionDrawingSystem[] = ['receptacle', 'lighting', 'network', 'sprinkler', 'fire-signal', 'sensor'];
export const allConstructionDrawingsSelected = (visibility: ConstructionDrawingVisibility) => CONSTRUCTION_DRAWING_SYSTEMS.every(system => system === 'sensor' ? visibility.sensor !== false : visibility[system]);
export const setAllConstructionDrawings = (checked: boolean): ConstructionDrawingVisibility => ({ receptacle: checked, lighting: checked, network: checked, sprinkler: checked, 'fire-signal': checked, sensor: checked });

export type InstallationScheduleRow = { variant?: string; deviceType: NetworkDevice['deviceType']; sprinklerDirection?: SprinklerDirection; floorSocket?: boolean; name: string; mounting: string; height: string; heightMeters: number; quantity: number; sourceIds: string[]; evidenceSourceIds?: string[]; measurementBasis: 'explicit' | 'derived'; assumptions: string[]; confidence: 'high' | 'limited' };
export type InstallationScheduleSection = { system: ConstructionDrawingSystem; label: string; rows: InstallationScheduleRow[] };

const wallAttachment = (device: NetworkDevice) => deviceHostAttachment(device)?.hostKind === 'wall';
export const usesExteriorHeightCallout = (device: NetworkDevice) => wallAttachment(device);

export function buildInstallationSchedule(nodes: Record<string, NodeData>, overlay: ConduitOverlayDocument, levelId: string, unit: MeasurementUnit, context: PlanContext): InstallationScheduleSection[] {
  const suffix = unit === 'millimeters' ? ' mm' : '';
  const rows = new Map<ConstructionDrawingSystem, Map<string, InstallationScheduleRow>>();
  for (const device of overlay.devices) {
    if (!context.deviceVisible(device) || context.deviceLevel(device) !== levelId || usesExteriorHeightCallout(device)) continue;
    const deviceSystem = device.systems.find(candidate => context.systemVisibility[candidate]);
    // Fire water and fire-signal devices share one 2D fire construction drawing.
    // Their independent Project/Overlay systems remain unchanged.
    const system: ConstructionDrawingSystem | undefined = device.deviceType === 'sensor' ? context.sensorVisible ? 'sensor' : undefined : deviceSystem === 'fire-signal' ? 'sprinkler' : deviceSystem;
    if (!system) continue;
    const attachment = deviceHostAttachment(device);
    const heightInfo = deviceConstructionHeight(device, nodes, overlay, levelId);
    const mounting = device.mount?.kind === 'finished-floor' ? heightInfo.datum ? '完成面 · 上口' : '上口 · 模型地面（完成面待确认）' : device.mount?.kind === 'segment' ? '管段' : device.mount?.kind === 'reference-plane' ? '安装参考面' : attachment?.hostKind === 'ceiling' ? '天花' : attachment?.hostKind === 'slab' ? '楼板' : attachment?.hostKind === 'beam' ? '梁面' : '悬空';
    const heightMeters = heightInfo.heightMeters;
    const height = `${formatMeasurement(heightMeters, unit)}${suffix}`;
    const name = devicePlanLabel(device, overlay);
    const floorSocket = isFloorSocket(device);
    const systemRows = rows.get(system) ?? new Map<string, InstallationScheduleRow>();
    const key = `${device.deviceType}|${name}|${mounting}|${height}`;
    const current = systemRows.get(key);
    if (current) { current.quantity += 1; current.sourceIds.push(device.id); current.evidenceSourceIds = [...new Set([...(current.evidenceSourceIds ?? current.sourceIds), ...heightInfo.evidenceSourceIds])]; }
    else systemRows.set(key, { deviceType: device.deviceType, ...(device.deviceType === 'sprinkler-head' ? { sprinklerDirection: sprinklerDirectionOf(device) } : {}), floorSocket, name, mounting, height, heightMeters, quantity: 1, sourceIds: [device.id], evidenceSourceIds: heightInfo.evidenceSourceIds, measurementBasis: device.mount?.kind === 'reference-plane' && !heightInfo.datum ? 'explicit' : 'derived', confidence: heightInfo.datum ? 'high' : device.mount?.kind === 'finished-floor' ? 'limited' : device.mount?.kind === 'reference-plane' || floorSocket ? 'high' : 'limited', assumptions: [heightInfo.datum || device.mount?.kind === 'finished-floor' ? heightInfo.assumption : device.mount?.kind === 'reference-plane' ? '依据明确保存的外壳中心位置和设备实体尺寸换算下缘，并减去点位处楼板顶面；无楼板时使用楼层基准。' : floorSocket ? '插座明确挂载楼板顶面，按设备下缘相对原始楼板顶面记录高度；完成面高于楼板时允许显示负值。' : heightInfo.assumption] });
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
