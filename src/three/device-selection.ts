export function syncExternalDeviceSelection(currentIds: readonly string[], selectedId: string | null, deviceIds: ReadonlySet<string>): string[] {
  if (!selectedId || !deviceIds.has(selectedId)) return [];
  return currentIds.includes(selectedId) ? [...currentIds] : [selectedId];
}
