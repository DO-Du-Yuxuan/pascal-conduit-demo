import { describe, expect, it } from "vitest";
import { syncExternalDeviceSelection } from "./device-selection";

describe("2D to 3D device selection", () => {
  const devices = new Set(["socket-a", "light-b"]);

  it("turns a 2D-selected device into the active 3D device selection", () => {
    expect(syncExternalDeviceSelection(["light-b"], "socket-a", devices)).toEqual(["socket-a"]);
  });

  it("keeps an existing 3D additive selection when its active device remains selected", () => {
    expect(syncExternalDeviceSelection(["socket-a", "light-b"], "light-b", devices)).toEqual(["socket-a", "light-b"]);
  });

  it("clears the local device selection for an empty or non-device 2D selection", () => {
    expect(syncExternalDeviceSelection(["socket-a"], null, devices)).toEqual([]);
    expect(syncExternalDeviceSelection(["socket-a"], "wall-a", devices)).toEqual([]);
  });
});
