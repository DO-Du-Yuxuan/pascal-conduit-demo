import type { ConduitOverlayDocument, LightingControlGroup } from "./overlay";

export type LightingControlRejection = "empty-group" | "invalid-switch" | "invalid-luminaire" | "luminaire-already-bound" | "missing-group";
export type LightingControlResult = { status: "committed"; overlay: ConduitOverlayDocument; group: LightingControlGroup | null } | { status: "rejected"; overlay: ConduitOverlayDocument; reason: LightingControlRejection };
export type LightingControlCreateResult = { status: "committed"; overlay: ConduitOverlayDocument; group: LightingControlGroup } | { status: "rejected"; overlay: ConduitOverlayDocument; reason: LightingControlRejection };

const unique = (ids: readonly string[]) => [...new Set(ids)];
const nextGroupId = (overlay: ConduitOverlayDocument) => {
  const used = new Set(overlay.lightingControlGroups.map((group) => group.id));
  let sequence = overlay.lightingControlGroups.length + 1;
  while (used.has(`lighting-control-${sequence}`)) sequence += 1;
  return `lighting-control-${sequence}`;
};

function validateMembers(overlay: ConduitOverlayDocument, switchDeviceId: string, luminaireDeviceIds: readonly string[], ignoredGroupId?: string): LightingControlRejection | null {
  if (overlay.devices.find((device) => device.id === switchDeviceId)?.deviceType !== "switch") return "invalid-switch";
  if (!luminaireDeviceIds.length) return "empty-group";
  if (luminaireDeviceIds.some((id) => overlay.devices.find((device) => device.id === id)?.deviceType !== "luminaire")) return "invalid-luminaire";
  const bound = new Set(overlay.lightingControlGroups.filter((group) => group.id !== ignoredGroupId).flatMap((group) => group.luminaireDeviceIds));
  return luminaireDeviceIds.some((id) => bound.has(id)) ? "luminaire-already-bound" : null;
}

export function createLightingControlGroup(overlay: ConduitOverlayDocument, switchDeviceId: string, luminaireDeviceIds: readonly string[]): LightingControlCreateResult {
  const members = unique(luminaireDeviceIds), reason = validateMembers(overlay, switchDeviceId, members);
  if (reason) return { status: "rejected", overlay, reason };
  const group: LightingControlGroup = { id: nextGroupId(overlay), switchDeviceId, luminaireDeviceIds: members, createdAt: new Date().toISOString() };
  return { status: "committed", overlay: { ...overlay, lightingControlGroups: [...overlay.lightingControlGroups, group] }, group };
}

export function replaceLightingControlGroup(overlay: ConduitOverlayDocument, groupId: string, luminaireDeviceIds: readonly string[]): LightingControlResult {
  const existing = overlay.lightingControlGroups.find((group) => group.id === groupId);
  if (!existing) return { status: "rejected", overlay, reason: "missing-group" };
  const members = unique(luminaireDeviceIds);
  if (!members.length) return { status: "committed", overlay: removeLightingControlGroup(overlay, groupId), group: null };
  const reason = validateMembers(overlay, existing.switchDeviceId, members, groupId);
  if (reason) return { status: "rejected", overlay, reason };
  const group = { ...existing, luminaireDeviceIds: members };
  return { status: "committed", overlay: { ...overlay, lightingControlGroups: overlay.lightingControlGroups.map((item) => item.id === groupId ? group : item) }, group };
}

export function removeLightingControlGroup(overlay: ConduitOverlayDocument, groupId: string): ConduitOverlayDocument {
  const lightingControlGroups = overlay.lightingControlGroups.filter((group) => group.id !== groupId);
  return lightingControlGroups.length === overlay.lightingControlGroups.length ? overlay : { ...overlay, lightingControlGroups };
}

export function cleanLightingControlGroupsAfterDeviceDeletion(overlay: ConduitOverlayDocument, deviceId: string): LightingControlGroup[] {
  return overlay.lightingControlGroups
    .filter((group) => group.switchDeviceId !== deviceId)
    .map((group) => ({ ...group, luminaireDeviceIds: group.luminaireDeviceIds.filter((id) => id !== deviceId) }))
    .filter((group) => group.luminaireDeviceIds.length > 0);
}
