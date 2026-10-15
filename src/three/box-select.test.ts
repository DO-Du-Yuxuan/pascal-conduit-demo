import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Matrix4, Mesh, Scene, Vector3 } from "three";
import { boxSelectBounds, boxSelectRect, collectBoxSelection, mergeBoxSelection } from "./box-select";

describe("box selection helpers", () => {
  it("treats sub-threshold movement as a click and normalizes drag direction", () => {
    expect(boxSelectRect({ x: 1, y: 1 }, { x: 3, y: 3 })).toBeNull();
    expect(boxSelectRect({ x: 20, y: 30 }, { x: 5, y: 10 })).toEqual({ left: 5, top: 10, right: 20, bottom: 30 });
  });

  it("replaces by default and appends unique IDs with Ctrl/Command", () => {
    expect(mergeBoxSelection(["old"], ["new", "new"], false)).toEqual(["new"]);
    expect(mergeBoxSelection(["old", "same"], ["same", "new"], true)).toEqual(["old", "same", "new"]);
  });

  it("selects thin crossing pipes even when their endpoints and center lie outside the rectangle", () => {
    const scene = new Scene(), mesh = new Mesh(new BoxGeometry(8, .002, .002));
    mesh.userData.boxSelectId = "thin-pipe";
    scene.add(mesh);
    expect(collectBoxSelection(scene, { minX: 2, maxX: 3, minZ: -.1, maxZ: .1 }, new Matrix4())).toEqual(["thin-pipe"]);
  });

  it("honors hidden ancestors, nearest node identity and ignored annotations", () => {
    const scene = new Scene(), group = new Group();
    group.userData.boxSelectId = "wall";
    const body = new Mesh(new BoxGeometry(2, 2, 2));
    const child = new Mesh(new BoxGeometry(.2, .2, .2)); child.userData.boxSelectId = "window";
    const annotation = new Mesh(new BoxGeometry(1, 1, 1)); annotation.userData.boxSelectId = "label"; annotation.userData.boxSelectIgnore = true;
    group.add(body, child, annotation); scene.add(group);
    const bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    expect(collectBoxSelection(scene, bounds, new Matrix4())).toEqual(["wall", "window"]);
    group.visible = false;
    expect(collectBoxSelection(scene, bounds, new Matrix4())).toEqual([]);
  });

  it("keeps selection in editing coordinates under a rotated, translated building", () => {
    const scene = new Scene(), display = new Group();
    display.position.set(14, 3, -7); display.rotation.y = Math.PI / 3;
    const mesh = new Mesh(new BoxGeometry(1, 1, 1)); mesh.position.set(2, 0, 3); mesh.userData.boxSelectId = "device";
    display.add(mesh); scene.add(display); scene.updateMatrixWorld(true);
    const worldToEditing = display.matrixWorld.clone().invert();
    expect(collectBoxSelection(scene, boxSelectBounds(new Vector3(1, 0, 2), new Vector3(3, 0, 4)), worldToEditing)).toEqual(["device"]);
    expect(collectBoxSelection(scene, { minX: -4, maxX: -3, minZ: -4, maxZ: -3 }, worldToEditing)).toEqual([]);
  });

  it("unions multiple body meshes without duplicating selected node IDs", () => {
    const scene = new Scene(), group = new Group(); group.userData.boxSelectId = "unit";
    for (const x of [-2, 2]) { const mesh = new Mesh(new BoxGeometry(1, 1, 1)); mesh.position.x = x; group.add(mesh); }
    scene.add(group);
    expect(collectBoxSelection(scene, { minX: -3, maxX: 3, minZ: -1, maxZ: 1 }, new Matrix4())).toEqual(["unit"]);
  });
});
