// @ts-ignore Node types are intentionally not part of the browser app's compile environment.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DoubleSide, FrontSide, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from "three";
import { importProjectJson } from "../domain/project-import";
import { datumWallLineSegments } from "../domain/construction-datum";
import { buildBuilderWallGeometry } from "./builder-wall-geometry";
import { constructionDatumLabelFrame } from "./construction-datum-label";
import { getWallCurveFrameAt } from "../geometry/walls/curve";
import { DatumWallAnnotation } from "./PascalScenePreview";
import { context as fiberContext } from "@react-three/fiber";
import { Line } from "@react-three/drei";

const realProjectPath = (globalThis as any).process?.env?.DATUM_WALL_PROJECT_FIXTURE as string | undefined;

function assertPhysicalLabelVisibility(walls: any[], datum: any, openings: Record<string, any[]>, levelBaseY: number) {
  const lines = datumWallLineSegments(datum, walls, openings, levelBaseY);
  expect(lines.length).toBeGreaterThan(0);
  const material = new MeshBasicMaterial({ side: FrontSide });
  const raycaster = new Raycaster();
  let checked = 0;
  for (const line of lines) {
    const wall = walls.find((candidate) => candidate.id === line.wallId)!;
    const wallGeometry = buildBuilderWallGeometry(wall, { levelWalls: walls, openings: openings[wall.id] ?? [], levelY: levelBaseY });
    const wallMesh = new Mesh(wallGeometry, new MeshBasicMaterial({ side: DoubleSide }));
    const frame = constructionDatumLabelFrame(line.points, line.side, line.labelPosition)!;
    const labelMesh = new Mesh(new PlaneGeometry(0.2, 0.072), material);
    labelMesh.position.set(frame.position[0], frame.position[1] + 0.035, frame.position[2]);
    labelMesh.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(
      new Vector3(...frame.right), new Vector3(...frame.up), new Vector3(...frame.normal),
    ));
    wallMesh.updateMatrixWorld(true);
    labelMesh.updateMatrixWorld(true);

    const center = labelMesh.position.clone();
    const normal = new Vector3(...frame.normal);
    const camera = center.clone().addScaledVector(normal, 1);
    raycaster.set(camera, center.clone().sub(camera).normalize());
    const intersections = raycaster.intersectObjects([wallMesh, labelMesh], false);
    expect(intersections[0]?.object).toBe(labelMesh);
    expect(normal.dot(labelMesh.getWorldDirection(new Vector3()))).toBeGreaterThan(0.999);
    const tangent = new Vector3(...frame.right);
    expect(Math.abs(tangent.y)).toBeLessThan(1e-9);
    const halfThickness = (wall.thickness ?? 0.1) / 2;
    const wallCenter = getWallCurveFrameAt(wall, 0.5).point;
    const outsideDistance = (center.x - wallCenter.x) * normal.x + (center.z - wallCenter.y) * normal.z;
    expect(outsideDistance).toBeGreaterThan(halfThickness);
    checked += 1;
    wallGeometry.dispose();
  }
  expect(checked).toBe(lines.length);
}

describe("construction datum wall render contract", () => {
  it("mounts the label beside Drei Line rather than under its material primitive", () => {
    const marker = createElement("span", { "data-datum-label": "true" }, "H01");
    const fiberStore = ((selector?: (state: any) => any) => { const state = { size: { width: 800, height: 600 } }; return selector ? selector(state) : state; }) as any;
    const tree = createElement(fiberContext.Provider, { value: fiberStore },
      createElement(DatumWallAnnotation, { points: [[0, 1, 0], [1, 1, 0]], label: marker, onSelect: () => undefined }));
    const oldNestingTree = createElement(fiberContext.Provider, { value: fiberStore },
      createElement(Line, { points: [[0, 1, 0], [1, 1, 0]] }, marker));
    const markup = renderToStaticMarkup(tree);
    const oldNestingMarkup = renderToStaticMarkup(oldNestingTree);
    expect(markup).toContain("data-datum-label=\"true\"");
    expect(markup).toMatch(/<\/primitive><span data-datum-label/);
    expect(oldNestingMarkup).toContain("data-datum-label=\"true\"");
    expect(oldNestingMarkup).not.toMatch(/<\/primitive><span data-datum-label/);
  });

  it("keeps the physical label plane outside the actual wall face and first on a same-side camera ray", () => {
    const wall = { id: "wall", type: "wall", start: [-2, 0], end: [2, 0], height: 2.5 };
    const datum = { id: "datum", levelId: "level", label: "H01", elevationMm: 1350, heightAboveRawMm: 1300, rawReference: { kind: "slab-top", sourceObjectId: "slab", elevationMm: 50, basis: "explicit" }, finishedFloorOffsetMm: 300, localRegionFinishOffsets: [] };
    assertPhysicalLabelVisibility([wall], datum, {}, 0);
  });

  if (realProjectPath) it("checks the supplied project walls against their actual wall geometry", () => {
    const raw = JSON.parse(readFileSync(realProjectPath, "utf8"));
    const { projectRaw, overlay } = importProjectJson(raw, "real-project.json", "0".repeat(64));
    const nodes = Object.values(projectRaw.nodes) as any[];
    const level = nodes.find((node) => node.type.toLowerCase() === "level" && node.constructionDatums?.length);
    const datum = overlay.constructionDatums.find((item) => item.levelId === level.id)!;
    const walls = nodes.filter((node) => node.type.toLowerCase() === "wall" && node.parentId === level.id).map((node) => ({
      ...node,
      type: "wall",
      height: node.height ?? level.height ?? 2.5,
      thickness: node.thickness ?? 0.1,
    }));
    const openingsByWall: Record<string, any[]> = {};
    for (const opening of nodes.filter((node) => ["door", "window"].includes(node.type.toLowerCase()))) {
      const wallId = opening.wallId ?? opening.parentId;
      if (wallId) (openingsByWall[wallId] ??= []).push({ ...opening, type: opening.type.toLowerCase(), wallId });
    }
    assertPhysicalLabelVisibility(walls, datum, openingsByWall, (level.level ?? 0) * 3.2);
  });
});
