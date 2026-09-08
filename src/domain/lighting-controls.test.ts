import { describe, expect, it } from "vitest";
import { createNetworkDevice } from "./devices";
import { createLightingControlGroup, removeLightingControlGroup, replaceLightingControlGroup } from "./lighting-controls";
import { lightingControlRelationLines } from "./lighting-control-layout";
import { createEmptyOverlay, type ConduitOverlayDocument, type NetworkDeviceType } from "./overlay";
import { deleteNetworkObject } from "./routing";

const device = (deviceType: NetworkDeviceType, x: number) => createNetworkDevice(deviceType, deviceType === "switch"
  ? { position: [x, 1, 0], attachment: { hostId: "wall", hostKind: "wall", surface: "interior", normal: [0, 0, 1], levelId: "L0" } }
  : { position: [x, 2.7, 0], attachment: { hostId: "ceiling", hostKind: "ceiling", surface: "ceiling-face", normal: [0, -1, 0], levelId: "L0" } });
const fixture = () => {
  const wallSwitch = device("switch", 0), first = device("luminaire", 1), second = device("luminaire", 2), otherSwitch = device("switch", 3);
  const overlay: ConduitOverlayDocument = { ...createEmptyOverlay("a.json", "sha"), devices: [wallSwitch, first, second, otherSwitch] };
  return { overlay, wallSwitch, first, second, otherSwitch };
};

describe("lighting control groups", () => {
  it("renders one group as a continuous lamp chain with only one switch connection", () => {
    const { wallSwitch, first, second } = fixture(), third = device("luminaire", 3);
    const lines = lightingControlRelationLines(
      { id: "group", switchDeviceId: wallSwitch.id, luminaireDeviceIds: [third.id, first.id, second.id], createdAt: "now" },
      [wallSwitch, first, second, third],
    );

    expect(lines.map((line) => line.deviceIds)).toEqual([
      [wallSwitch.id, first.id],
      [first.id, second.id],
      [second.id, third.id],
    ]);
  });

  it("creates one switch control group from unbound luminaires without conduit", () => {
    const { overlay, wallSwitch, first, second } = fixture();
    const result = createLightingControlGroup(overlay, wallSwitch.id, [first.id, second.id]);
    expect(result).toMatchObject({ status: "committed", group: { switchDeviceId: wallSwitch.id, luminaireDeviceIds: [first.id, second.id] } });
    if (result.status === "committed") expect(result.overlay.lightingControlGroups).toEqual([result.group]);
  });

  it("rejects invalid members and luminaires already assigned to any group", () => {
    const { overlay, wallSwitch, first, second, otherSwitch } = fixture();
    const firstGroup = createLightingControlGroup(overlay, wallSwitch.id, [first.id]);
    expect(firstGroup.status).toBe("committed");
    if (firstGroup.status !== "committed") return;
    expect(createLightingControlGroup(firstGroup.overlay, otherSwitch.id, [first.id, second.id])).toMatchObject({ status: "rejected", reason: "luminaire-already-bound" });
    expect(createLightingControlGroup(overlay, first.id, [second.id])).toMatchObject({ status: "rejected", reason: "invalid-switch" });
    expect(createLightingControlGroup(overlay, wallSwitch.id, [wallSwitch.id])).toMatchObject({ status: "rejected", reason: "invalid-luminaire" });
  });

  it("atomically replaces a group and removes it when the staged selection is empty", () => {
    const { overlay, wallSwitch, first, second } = fixture();
    const created = createLightingControlGroup(overlay, wallSwitch.id, [first.id]);
    if (created.status !== "committed") throw new Error("fixture failed");
    const replaced = replaceLightingControlGroup(created.overlay, created.group.id, [second.id]);
    expect(replaced).toMatchObject({ status: "committed", group: { luminaireDeviceIds: [second.id] } });
    if (replaced.status !== "committed") return;
    expect(replaceLightingControlGroup(replaced.overlay, created.group.id, [])).toMatchObject({ status: "committed", group: null, overlay: { lightingControlGroups: [] } });
  });

  it("unbinds a whole group and cleans relationships when devices are deleted", () => {
    const { overlay, wallSwitch, first, second } = fixture();
    const created = createLightingControlGroup(overlay, wallSwitch.id, [first.id, second.id]);
    if (created.status !== "committed") throw new Error("fixture failed");
    expect(removeLightingControlGroup(created.overlay, created.group.id).lightingControlGroups).toEqual([]);
    expect(deleteNetworkObject(created.overlay, first.id).lightingControlGroups[0].luminaireDeviceIds).toEqual([second.id]);
    expect(deleteNetworkObject(created.overlay, wallSwitch.id).lightingControlGroups).toEqual([]);
  });
});
