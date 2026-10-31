import { describe, expect, it } from "vitest";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import {
  TAHOE_DEFAULT_TITLEBAR_HEIGHT,
  TRAFFIC_LIGHT_MARGIN,
  TRAFFIC_LIGHT_ORIGIN_Y,
  trafficLightPosition,
  trafficLightTitlebarHeight,
  trafficLightTopMargin,
} from "./windowChrome";

describe("macOS traffic light margins", () => {
  it("uses one corner margin for the left edge and, within a point, for the top edge", () => {
    const position = trafficLightPosition();

    expect(position.x).toBe(TRAFFIC_LIGHT_MARGIN);
    expect(trafficLightTopMargin(position.y, TRAFFIC_LIGHT_ORIGIN_Y.sonomaSequoia)).toBe(TRAFFIC_LIGHT_MARGIN + 1);
    expect(trafficLightTopMargin(position.y, TRAFFIC_LIGHT_ORIGIN_Y.tahoe)).toBe(TRAFFIC_LIGHT_MARGIN - 1);
  });

  it("grows the Tahoe title bar so the vertical inset is not ignored", () => {
    const position = trafficLightPosition();

    expect(trafficLightTitlebarHeight(position.y)).toBeGreaterThan(TAHOE_DEFAULT_TITLEBAR_HEIGHT);
  });

  it("matches the window configuration Tauri reads, in points", () => {
    const window = tauriConfig.app.windows[0];

    expect(window.hiddenTitle).toBe(true);
    expect(window.titleBarStyle).toBe("Overlay");
    expect(window.trafficLightPosition).toEqual(trafficLightPosition());
  });
});
