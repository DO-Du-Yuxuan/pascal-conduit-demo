import { describe, expect, it } from "vitest";
import passingDemo from "../../sample-data/Bellevue passing demo.json";
import { buildEvaluationHandoff } from "../parser/evaluation-handoff";
import { parseProject } from "../parser/parse";
import { buildRoomConnectivityGraph } from "./connectivity";
import { grossStorageVolume, interpolateStorageScore, scoreS1StorageConfiguration } from "./s1-storage-configuration";
import { S1_STORAGE_ARRIVAL_ANCHORS, S1_STORAGE_BEDROOM_ANCHORS, S1_STORAGE_KITCHEN_ANCHORS } from "./s1-storage-configuration-config";

describe("S1 SN storage configuration", () => {
  it("interpolates the frozen bedroom curve and only accepts valid dimensions", () => {
    expect(interpolateStorageScore(0, S1_STORAGE_BEDROOM_ANCHORS)).toBe(0);
    expect(interpolateStorageScore(1.15, S1_STORAGE_BEDROOM_ANCHORS)).toBeCloseTo(55);
    expect(interpolateStorageScore(3.4, S1_STORAGE_BEDROOM_ANCHORS)).toBe(100);
    expect(interpolateStorageScore(1.5, S1_STORAGE_KITCHEN_ANCHORS)).toBe(55);
    expect(interpolateStorageScore(0.5, S1_STORAGE_ARRIVAL_ANCHORS)).toBe(55);
    expect(grossStorageVolume([2, 0.6, 2.2])).toBeCloseTo(2.64);
    expect(grossStorageVolume(null)).toBeNull();
  });

  it("measures Bellevue bedroom, pantry-chain and garage-arrival storage from authoritative tags", () => {
    const handoff = buildEvaluationHandoff(parseProject(passingDemo));
    const report = scoreS1StorageConfiguration(handoff, buildRoomConnectivityGraph(handoff));
    expect(report).toMatchObject({ status: "scored", score: 81.4 });
    expect(report.sn01).toMatchObject({ status: "scored", score: 44.1 });
    expect(report.sn01.bedrooms.map((bedroom) => [bedroom.bedroomName, bedroom.bedroomStorageVolumeCubicMeters, bedroom.score])).toEqual([
      ["BEDROOM 2", 0, 0], ["BEDROOM 3", 1.71873, 76.2], ["MASTER BEDROOM", 3.17304, 100], ["BEDROOM 1", 0, 0],
    ]);
    expect(report.sn01.closets.map((closet) => [closet.zoneName, closet.status])).toEqual([["WALK-IN CLOSET", "dedicated"], ["WALK-IN CLOSET", "shared"], ["WIC 2", "shared"]]);
    expect(report.sn02).toMatchObject({ status: "scored", score: 100 });
    expect(report.sn02.kitchenSystems[0]).toMatchObject({ kitchenStorageVolumeCubicMeters: 2.4710112, pantryStorageVolumeCubicMeters: 3.830385456, totalStorageVolumeCubicMeters: 6.301396656, score: 100 });
    expect(report.sn03).toMatchObject({ status: "scored", grossStorageVolumeCubicMeters: 1.903824, score: 100, entranceKind: "garage_origin" });
  });
});
