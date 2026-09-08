import type { LightingControlGroup, NetworkDevice, Vec3 } from "./overlay";

export type LightingControlRelationLine = { key: string; deviceIds: [string, string]; points: [Vec3, Vec3] };

const distanceSquared = (a: Vec3, b: Vec3) => a.reduce((sum, value, axis) => sum + (value - b[axis]) ** 2, 0);

/** Displays one logical route as switch -> nearest luminaire -> nearest remaining luminaires. */
export function lightingControlRelationLines(group: LightingControlGroup, devices: readonly NetworkDevice[]): LightingControlRelationLine[] {
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const wallSwitch = devicesById.get(group.switchDeviceId);
  const remaining = group.luminaireDeviceIds.flatMap((id) => {
    const device = devicesById.get(id);
    return device?.deviceType === "luminaire" ? [device] : [];
  });
  if (!wallSwitch || wallSwitch.deviceType !== "switch" || !remaining.length) return [];

  const ordered: NetworkDevice[] = [];
  let from = wallSwitch;
  while (remaining.length) {
    let nearestIndex = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      if (distanceSquared(from.position.position, remaining[index].position.position) < distanceSquared(from.position.position, remaining[nearestIndex].position.position)) nearestIndex = index;
    }
    from = remaining.splice(nearestIndex, 1)[0];
    ordered.push(from);
  }

  return ordered.map((device, index) => {
    const previous = index === 0 ? wallSwitch : ordered[index - 1];
    return { key: `${group.id}:${previous.id}:${device.id}`, deviceIds: [previous.id, device.id], points: [previous.position.position, device.position.position] };
  });
}
