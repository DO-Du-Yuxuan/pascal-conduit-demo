type WritableFile = { write(data: Blob): Promise<void>; close(): Promise<void> };
type SaveFileHandle = { createWritable(): Promise<WritableFile> };
type SaveFilePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveFileHandle>;

export type JsonFileSaveResult = "saved" | "cancelled" | "downloaded";

export async function saveJsonFile(blob: Blob, suggestedName: string, picker: SaveFilePicker | undefined = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker): Promise<JsonFileSaveResult> {
  if (picker) {
    try {
      const handle = await picker({ suggestedName, types: [{ description: "JSON 文件", accept: { "application/json": [".json"] } }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
