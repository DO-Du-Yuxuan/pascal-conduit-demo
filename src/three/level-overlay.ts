import type { ConduitOverlayDocument, DeviceMount, RoutePoint } from "../domain/overlay";

const mountLevel = (mount?: DeviceMount) => mount?.kind === "host" ? mount.attachment.levelId : mount?.levelId;
const onLevel = (levelId: string, ...candidates: (string | null | undefined)[]) => !candidates.some(Boolean) || candidates.includes(levelId);
const pointLevel = (point: RoutePoint) => point.attachment?.levelId;

/** A render-only slice; the source Overlay and every stored relation remain untouched. */
export function overlayForLevel(overlay: ConduitOverlayDocument, levelId: string): ConduitOverlayDocument {
  if (!levelId) return overlay;
  const segments = overlay.segments.filter((segment) => onLevel(levelId, pointLevel(segment.start), pointLevel(segment.end)));
  const segmentIds = new Set(segments.map((segment) => segment.id));
  const devices = overlay.devices.filter((device) => onLevel(levelId, mountLevel(device.mount), pointLevel(device.position)));
  const deviceIds = new Set(devices.map((device) => device.id));
  const units = overlay.hvac.indoorUnits.filter((unit) => onLevel(levelId, mountLevel(unit.mount), pointLevel(unit.position)));
  const unitIds = new Set(units.map((unit) => unit.id));
  const ducts = overlay.hvac.ducts.filter((duct) => unitIds.has(duct.indoorUnitId));
  const ductIds = new Set(ducts.map((duct) => duct.id));
  const hvacSegmentIds = new Set(ducts.flatMap((duct) => duct.segmentIds));
  const thermostats = overlay.hvac.thermostats.filter((thermostat) => onLevel(levelId, mountLevel(thermostat.mount), pointLevel(thermostat.position)));
  const thermostatIds = new Set(thermostats.map((thermostat) => thermostat.id));
  return {
    ...overlay,
    segments,
    fittings: overlay.fittings.filter((fitting) => onLevel(levelId, pointLevel(fitting.position)) && fitting.segmentIds.some((id) => segmentIds.has(id))),
    junctionBoxes: overlay.junctionBoxes.filter((box) => onLevel(levelId, pointLevel(box.position))),
    devices,
    circuits: overlay.circuits.filter((circuit) => circuit.segmentIds.some((id) => segmentIds.has(id)) || circuit.sourceDeviceId && deviceIds.has(circuit.sourceDeviceId)).map((circuit) => ({ ...circuit, segmentIds: circuit.segmentIds.filter((id) => segmentIds.has(id)) })),
    lightingControlGroups: overlay.lightingControlGroups.filter((group) => deviceIds.has(group.switchDeviceId) && group.luminaireDeviceIds.some((id) => deviceIds.has(id))).map((group) => ({ ...group, luminaireDeviceIds: group.luminaireDeviceIds.filter((id) => deviceIds.has(id)) })),
    hvac: {
      ...overlay.hvac,
      indoorUnits: units,
      ducts,
      segments: overlay.hvac.segments.filter((segment) => hvacSegmentIds.has(segment.id)),
      outlets: overlay.hvac.outlets.filter((outlet) => ductIds.has(outlet.ductId)),
      thermostats,
      controls: overlay.hvac.controls.filter((control) => unitIds.has(control.indoorUnitId) && thermostatIds.has(control.thermostatId)),
      wallPenetrations: overlay.hvac.wallPenetrations.filter((item) => hvacSegmentIds.has(item.segmentId)),
    },
  };
}
