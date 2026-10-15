// @ts-ignore Node types are not part of the browser app's compile environment.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importProjectJson } from "./project-import";
import { datumWallLineSegments } from "./construction-datum";
import { buildBuilderWallGeometry } from "../three/builder-wall-geometry";

const fixturePath = (globalThis as any).process?.env?.DATUM_WALL_PROJECT_FIXTURE as string | undefined;

describe.skipIf(!fixturePath)("actual project horizontal datum wall corners", () => {
  it("follows the rendered miter edges on the supplied JSON and retains opening gaps", () => {
    const raw = JSON.parse(readFileSync(fixturePath!, "utf8"));
    const { projectRaw, overlay } = importProjectJson(raw, "datum-wall-project.json", "0".repeat(64));
    const nodes = Object.values(projectRaw.nodes) as any[];
    const levelId = "level_85a1fy6iyztkelev";
    const level = nodes.find(node => node.id === levelId)!;
    const datum = overlay.constructionDatums.find(item => item.levelId === levelId)!;
    expect(datum).toBeDefined();
    const walls = nodes.filter(node => node.type.toLowerCase() === "wall" && node.parentId === levelId).map(node => ({
      ...node,
      type: "wall",
      height: node.height ?? level.height ?? 2.5,
      thickness: node.thickness ?? .1,
    }));
    const openingsByWall: Record<string, any[]> = {};
    for (const opening of nodes.filter(node => ["door", "window"].includes(node.type.toLowerCase()))) {
      const wallId = opening.wallId ?? opening.parentId;
      if (wallId) (openingsByWall[wallId] ??= []).push({ ...opening, type: opening.type.toLowerCase(), wallId });
    }
    const levelBaseY = (level.level ?? 0) * 3.2;
    const lines = datumWallLineSegments(datum, walls, openingsByWall, levelBaseY);
    expect(lines.length).toBeGreaterThan(0);

    const meshVertices = new Map<string, [number, number][]>();
    for (const wall of walls) {
      const geometry = buildBuilderWallGeometry(wall, { levelWalls: walls, openings: openingsByWall[wall.id] ?? [], levelY: levelBaseY });
      const positions = geometry.getAttribute("position"), vertices: [number, number][] = [];
      for (let index = 0; index < positions.count; index += 1) vertices.push([positions.getX(index), positions.getZ(index)]);
      meshVertices.set(wall.id, vertices);
      geometry.dispose();
    }
    for (const line of lines) {
      const vertices = meshVertices.get(line.wallId)!;
      for (const point of [line.points[0]!, line.points[line.points.length - 1]!]) {
        const distance = Math.min(...vertices.map(([x, z]) => Math.hypot(point[0] - x, point[2] - z)));
        expect(distance).toBeLessThan(.0031);
      }
    }

    const hostId = "wall_su5b2s3ai6ky0iq4";
    const host = walls.find(wall => wall.id === hostId)!;
    const adjacent = walls.find(wall => wall.id !== hostId && [wall.start, wall.end].some(([x, z]: number[]) => Math.hypot(x + 2, z - 1.5) < .001))!;
    expect(adjacent).toBeDefined();
    const hostLine = lines.find(line => line.wallId === host.id && line.side === 1)!;
    const hostEndpoint = Math.hypot(host.start[0] + 2, host.start[1] - 1.5) < .001
      ? hostLine.points[0]!
      : hostLine.points[hostLine.points.length - 1]!;
    const adjacentEndpoints = lines.filter(line => line.wallId === adjacent.id).flatMap(line => [line.points[0]!, line.points[line.points.length - 1]!]);
    expect(Math.min(...adjacentEndpoints.map(point => Math.hypot(hostEndpoint[0] - point[0], hostEndpoint[2] - point[2])))).toBeLessThan(.0031);
  });
});
