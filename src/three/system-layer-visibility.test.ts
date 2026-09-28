// @ts-nocheck -- Vitest runs this Node-only source contract outside the browser bundle.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PROJECT_SYSTEM_LAYER_VISIBILITY,
  PROJECT_SYSTEM_LAYER_OPTIONS,
  isDeviceSystemLayerVisible,
  isRoutingSystemLayerVisible,
  projectSystemLayerForDeviceType,
  projectSystemLayerForRoutingSystem,
} from "./system-layer-visibility";

const conduitScene = readFileSync(new URL("../components/ConduitScene.tsx", import.meta.url), "utf8");
const hvacScene = readFileSync(new URL("../components/HvacScene.tsx", import.meta.url), "utf8");

describe("3D system layer ownership", () => {
  it("keeps all ten Project system containers available and visible by default", () => {
    expect(PROJECT_SYSTEM_LAYER_OPTIONS.map(([key]) => key)).toEqual([
      "ElectricalSystem",
      "PlumbingSystem",
      "LightingSystem",
      "HVACSystem",
      "SmartSystem",
      "WaterPurificationSystem",
      "BathroomSystem",
      "FireProtectionSystem",
      "IrrigationSystem",
      "GasSystem",
    ]);
    expect(Object.values(DEFAULT_PROJECT_SYSTEM_LAYER_VISIBILITY)).toEqual(Array(10).fill(true));
  });

  it("maps shared electrical feeds and lighting routes to their owning containers", () => {
    expect(projectSystemLayerForDeviceType("strong-panel")).toBe("ElectricalSystem");
    expect(projectSystemLayerForDeviceType("weak-panel")).toBe("ElectricalSystem");
    expect(projectSystemLayerForDeviceType("socket")).toBe("ElectricalSystem");
    expect(projectSystemLayerForDeviceType("network-outlet")).toBe("ElectricalSystem");
    expect(projectSystemLayerForRoutingSystem("receptacle")).toBe("ElectricalSystem");
    expect(projectSystemLayerForRoutingSystem("network")).toBe("ElectricalSystem");
    expect(projectSystemLayerForDeviceType("luminaire")).toBe("LightingSystem");
    expect(projectSystemLayerForDeviceType("switch")).toBe("LightingSystem");
    expect(projectSystemLayerForRoutingSystem("lighting")).toBe("LightingSystem");
  });

  it("groups HVAC sensors, smart readers, and fire equipment by Project owner", () => {
    expect(projectSystemLayerForDeviceType("sensor")).toBe("HVACSystem");
    expect(projectSystemLayerForDeviceType("rfid-reader")).toBe("SmartSystem");
    expect(projectSystemLayerForDeviceType("sprinkler-head")).toBe("FireProtectionSystem");
    expect(projectSystemLayerForRoutingSystem("sprinkler")).toBe("FireProtectionSystem");
  });

  it("filters devices and routes by the owning system layer", () => {
    const visibility = { ...DEFAULT_PROJECT_SYSTEM_LAYER_VISIBILITY, ElectricalSystem: false, HVACSystem: false };
    expect(isDeviceSystemLayerVisible(visibility, "strong-panel")).toBe(false);
    expect(isDeviceSystemLayerVisible(visibility, "luminaire")).toBe(true);
    expect(isDeviceSystemLayerVisible(visibility, "sensor")).toBe(false);
    expect(isRoutingSystemLayerVisible(visibility, "network")).toBe(false);
    expect(isRoutingSystemLayerVisible(visibility, "lighting")).toBe(true);
  });

  it("applies container visibility to 3D device, route, chase, and HVAC rendering", () => {
    expect(conduitScene).toContain("overlay.devices.filter(deviceVisible)");
    expect(conduitScene).toContain("systemLayerVisibility ? isDeviceSystemLayerVisible");
    expect(conduitScene).toContain("systemLayerVisibility ? isRoutingSystemLayerVisible");
    expect(conduitScene).toContain("routeVisible(routeSystemById.get(chase.routeElementId)");
    expect(hvacScene).toContain("if (!(systemVisible ?? overlay.hvac.visible)) return null");
  });
});
