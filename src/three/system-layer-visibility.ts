import type { NetworkDeviceType, RoutingSystem } from "../domain/overlay";

export const PROJECT_SYSTEM_LAYER_OPTIONS = [
  ["ElectricalSystem", "电气"],
  ["PlumbingSystem", "给排水"],
  ["LightingSystem", "照明"],
  ["HVACSystem", "空调"],
  ["SmartSystem", "智能"],
  ["WaterPurificationSystem", "净水"],
  ["BathroomSystem", "卫浴"],
  ["FireProtectionSystem", "消防"],
  ["IrrigationSystem", "灌溉"],
  ["GasSystem", "燃气"],
] as const;

export type ProjectSystemLayer = (typeof PROJECT_SYSTEM_LAYER_OPTIONS)[number][0];
export type ProjectSystemLayerVisibility = Record<ProjectSystemLayer, boolean>;

export const DEFAULT_PROJECT_SYSTEM_LAYER_VISIBILITY: ProjectSystemLayerVisibility = Object.fromEntries(
  PROJECT_SYSTEM_LAYER_OPTIONS.map(([key]) => [key, true]),
) as ProjectSystemLayerVisibility;

const ROUTING_SYSTEM_LAYER: Record<RoutingSystem, ProjectSystemLayer> = {
  receptacle: "ElectricalSystem",
  network: "ElectricalSystem",
  lighting: "LightingSystem",
  sprinkler: "FireProtectionSystem",
  "fire-signal": "FireProtectionSystem",
};

const DEVICE_SYSTEM_LAYER: Record<NetworkDeviceType, ProjectSystemLayer> = {
  "strong-panel": "ElectricalSystem",
  "weak-panel": "ElectricalSystem",
  socket: "ElectricalSystem",
  "network-outlet": "ElectricalSystem",
  switch: "LightingSystem",
  luminaire: "LightingSystem",
  "sprinkler-head": "FireProtectionSystem",
  "smoke-detector": "FireProtectionSystem",
  sensor: "HVACSystem",
  "rfid-reader": "SmartSystem",
};

export const projectSystemLayerForRoutingSystem = (system: RoutingSystem): ProjectSystemLayer => ROUTING_SYSTEM_LAYER[system];
export const projectSystemLayerForDeviceType = (deviceType: NetworkDeviceType): ProjectSystemLayer => DEVICE_SYSTEM_LAYER[deviceType];

export function isRoutingSystemLayerVisible(visibility: ProjectSystemLayerVisibility, system: RoutingSystem): boolean {
  return visibility[projectSystemLayerForRoutingSystem(system)];
}

export function isDeviceSystemLayerVisible(visibility: ProjectSystemLayerVisibility, deviceType: NetworkDeviceType): boolean {
  return visibility[projectSystemLayerForDeviceType(deviceType)];
}
