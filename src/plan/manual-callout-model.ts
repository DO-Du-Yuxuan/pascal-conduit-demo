import type { NodeData } from '../types';
import type { ConduitOverlayDocument, ManualCallout } from '../domain/overlay';
import { resolveAncestorLevelId, resolveItemPlanTransform } from '../geometry/transform';

export type PlanPoint = [number, number];

export const newManualCalloutDraft = (targetId: string, levelId: string, anchor: PlanPoint, label: PlanPoint): Omit<ManualCallout,'id'|'createdAt'> => ({ targetId, levelId, anchor, label, text: '' });

export function manualCalloutTargetAnchor(nodes: Record<string, NodeData>, overlay: ConduitOverlayDocument | null, targetId: string): { levelId: string; anchor: PlanPoint } | null {
  const device = overlay?.devices.find(item => item.id === targetId);
  if (device) {
    const levelId = device.position.attachment?.levelId ?? (device.mount?.kind === 'reference-plane' ? device.mount.levelId : null);
    return levelId ? { levelId, anchor: [device.position.position[0], device.position.position[2]] } : null;
  }
  const segment = overlay?.segments.find(item => item.id === targetId);
  if (segment) {
    const levels = [...new Set([segment.start.attachment?.levelId, segment.end.attachment?.levelId].filter((id): id is string => Boolean(id)))];
    return levels.length === 1 ? { levelId: levels[0], anchor: [(segment.start.position[0] + segment.end.position[0]) / 2, (segment.start.position[2] + segment.end.position[2]) / 2] } : null;
  }
  const pointObject = [...(overlay?.fittings ?? []), ...(overlay?.junctionBoxes ?? [])].find(item => item.id === targetId);
  if (pointObject) {
    const levelId = pointObject.position.attachment?.levelId;
    return levelId ? { levelId, anchor: [pointObject.position.position[0], pointObject.position.position[2]] } : null;
  }
  const node = nodes[targetId], levelId = node && resolveAncestorLevelId(targetId, nodes).levelId;
  if (!node || !levelId) return null;
  if (node.type === 'wall' && Array.isArray(node.start) && Array.isArray(node.end)) return { levelId, anchor: [(node.start[0] + node.end[0]) / 2, (node.start[1] + node.end[1]) / 2] };
  if ((node.type === 'zone' || node.type === 'slab') && Array.isArray(node.polygon)) {
    const points = node.polygon.filter(Array.isArray);
    if (points.length) return { levelId, anchor: [points.reduce((sum, point) => sum + Number(point[0]), 0) / points.length, points.reduce((sum, point) => sum + Number(point[2] ?? point[1]), 0) / points.length] };
  }
  if (node.type === 'item') { const transform = resolveItemPlanTransform(targetId, nodes); if (transform.status === 'ok') return { levelId, anchor: [transform.x, transform.z] }; }
  if (Array.isArray(node.position)) return { levelId, anchor: [Number(node.position[0]), Number(node.position[2] ?? node.position[1])] };
  return null;
}
