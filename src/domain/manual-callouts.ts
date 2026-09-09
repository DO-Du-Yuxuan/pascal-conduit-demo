import type { ConduitOverlayDocument, ManualCallout } from './overlay';

let sequence = 0;
const nextId = (overlay: ConduitOverlayDocument) => {
  const used = new Set(overlay.manualCallouts.map(item => item.id));
  let id = `manual-callout-${Date.now()}-${++sequence}`;
  while (used.has(id)) id = `manual-callout-${Date.now()}-${++sequence}`;
  return id;
};

export function addManualCallout(overlay: ConduitOverlayDocument, value: Omit<ManualCallout, 'id' | 'createdAt'>): { overlay: ConduitOverlayDocument; callout: ManualCallout } {
  const callout: ManualCallout = { ...value, id: nextId(overlay), createdAt: new Date().toISOString() };
  return { overlay: { ...overlay, manualCallouts: [...overlay.manualCallouts, callout] }, callout };
}

export const updateManualCallout = (overlay: ConduitOverlayDocument, id: string, update: Partial<Pick<ManualCallout, 'text' | 'label'>>): ConduitOverlayDocument => ({
  ...overlay,
  manualCallouts: overlay.manualCallouts.map(item => item.id === id ? { ...item, ...update } : item),
});

export const deleteManualCallout = (overlay: ConduitOverlayDocument, id: string): ConduitOverlayDocument => ({ ...overlay, manualCallouts: overlay.manualCallouts.filter(item => item.id !== id) });
