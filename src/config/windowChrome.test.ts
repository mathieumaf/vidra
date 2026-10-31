import { describe, expect, it } from "vitest";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import {
  HEADER_BAND_HEIGHT,
  SIDEBAR_HEADER_CONTENT_INSET,
  TAHOE_DEFAULT_TITLEBAR_HEIGHT,
  TRAFFIC_LIGHT_BUTTON_SIZE,
  TRAFFIC_LIGHT_INSET_X,
  TRAFFIC_LIGHT_ORIGIN_Y,
  TRAFFIC_LIGHT_POSITION,
  trafficLightCenterFromTop,
  trafficLightInsetY,
  trafficLightTitlebarHeight,
} from "./windowChrome";

describe("macOS window chrome", () => {
  it("centers the traffic lights in the header band on Sonoma, Sequoia, and Tahoe", () => {
    const insetY = trafficLightInsetY();
    const bandCenter = HEADER_BAND_HEIGHT / 2;

    expect(insetY).toBe(TRAFFIC_LIGHT_POSITION.y);
    expect(trafficLightCenterFromTop(insetY, TRAFFIC_LIGHT_ORIGIN_Y.tahoe)).toBe(bandCenter - 1);
    expect(trafficLightCenterFromTop(insetY, TRAFFIC_LIGHT_ORIGIN_Y.sonomaSequoia)).toBe(bandCenter + 1);
  });

  it("asks wry for a title bar taller than the macOS Tahoe default", () => {
    expect(trafficLightTitlebarHeight(TRAFFIC_LIGHT_POSITION.y)).toBeGreaterThan(TAHOE_DEFAULT_TITLEBAR_HEIGHT);
    expect(TRAFFIC_LIGHT_BUTTON_SIZE + 18).toBe(TAHOE_DEFAULT_TITLEBAR_HEIGHT);
  });

  it("keeps the sidebar logo clear of the traffic-light group", () => {
    expect(SIDEBAR_HEADER_CONTENT_INSET).toBeGreaterThan(TRAFFIC_LIGHT_INSET_X);
    expect(SIDEBAR_HEADER_CONTENT_INSET).toBe(90);
  });

  it("matches the window configuration Tauri reads, in points", () => {
    const window = tauriConfig.app.windows[0];

    expect(window.hiddenTitle).toBe(true);
    expect(window.titleBarStyle).toBe("Overlay");
    expect(window.trafficLightPosition).toEqual({
      x: TRAFFIC_LIGHT_POSITION.x,
      y: TRAFFIC_LIGHT_POSITION.y,
    });
  });
});
