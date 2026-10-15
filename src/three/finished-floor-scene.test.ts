import { describe, expect, it } from "vitest";
import { Group, Matrix4, Object3D, Vector3 } from "three";
import { finishedFloorHasDeviceHit, finishedFloorPointerPoint } from "./FinishedFloorScene";

describe("finished floor scene pointer coordinates", () => {
  it("maps a hit through the active Builder display transform back to authored coordinates", () => {
    const display = new Matrix4().makeRotationY(Math.PI / 2).setPosition(12, 4, -7);
    const authored = new Vector3(2.25, 1.15, -3.5), rendered = authored.clone().applyMatrix4(display);

    const mapped = finishedFloorPointerPoint([rendered.x, rendered.y, rendered.z], display.clone().invert());
    expect(mapped[0]).toBeCloseTo(authored.x);
    expect(mapped[1]).toBeCloseTo(authored.y);
    expect(mapped[2]).toBeCloseTo(authored.z);
  });

  it("allows selecting a buried existing device through the translucent finish", () => {
    const floor = new Object3D(), deviceGroup = new Group(), box = new Object3D();
    deviceGroup.userData.positionedDeviceId = "existing-floor-box";
    deviceGroup.add(box);
    expect(finishedFloorHasDeviceHit([{ object: floor }, { object: box }])).toBe(true);
    expect(finishedFloorHasDeviceHit([{ object: floor }])).toBe(false);
  });
});
