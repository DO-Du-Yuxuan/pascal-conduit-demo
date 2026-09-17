import { describe, expect, it, vi } from "vitest";
import { saveJsonFile } from "./save-json-file";

describe("JSON export save-as", () => {
  it("opens the native save dialog with the proposed filename and writes the chosen file", async () => {
    const write = vi.fn().mockResolvedValue(undefined), close = vi.fn().mockResolvedValue(undefined);
    const picker = vi.fn().mockResolvedValue({ createWritable: vi.fn().mockResolvedValue({ write, close }) });
    await expect(saveJsonFile(new Blob(["{}"], { type: "application/json" }), "my-project.json", picker)).resolves.toBe("saved");
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: "my-project.json" }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not treat a cancelled save dialog as an exported file", async () => {
    const picker = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    await expect(saveJsonFile(new Blob(["{}"]), "my-project.json", picker)).resolves.toBe("cancelled");
  });
});
