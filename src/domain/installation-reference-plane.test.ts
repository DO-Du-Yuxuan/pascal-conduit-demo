import { describe, expect, it } from "vitest";
import { createReferencePlaneDevice } from "./devices";
import { ensureInstallationReferencePlane } from "./device-positioning";
import { createEmptyOverlay, parseOverlay } from "./overlay";

describe("installation reference planes", () => {
  it("persists an honest per-level plane and unhosted device point", () => {
    const base = ensureInstallationReferencePlane(createEmptyOverlay("a", "sha"), "L0");
    const device = createReferencePlaneDevice("luminaire", [1, 2.7, 2], "L0", 2700);
    const restored = parseOverlay(JSON.parse(JSON.stringify({ ...base, devices: [device] })));
    expect(restored.installationReferencePlanes).toEqual([{ levelId: "L0", elevationMm: 2700, basis: "finished-floor", derived: true }]);
    expect(restored.devices[0]).toMatchObject({ mount: { kind: "reference-plane", levelId: "L0", elevationMm: 2700 }, position: { position: [1, 2.7, 2] } });
    expect(restored.devices[0].position.attachment).toBeUndefined();
  });

  it("loads older overlay documents with no fabricated reference plane", () => {
    const old = createEmptyOverlay("a", "sha");
    delete (old as Partial<typeof old>).installationReferencePlanes;
    expect(parseOverlay(old).installationReferencePlanes).toEqual([]);
  });
});
