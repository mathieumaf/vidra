import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  close: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { checkForApplicationUpdate, installApplicationUpdate } from "./updates";

describe("application update service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("copies update metadata and releases the plugin resource", async () => {
    mocks.check.mockResolvedValue({
      currentVersion: "1.0.0",
      version: "1.1.0",
      date: "2026-08-14T12:00:00Z",
      body: "Security improvements.",
      close: mocks.close,
    });

    await expect(checkForApplicationUpdate()).resolves.toEqual({
      currentVersion: "1.0.0",
      version: "1.1.0",
      date: "2026-08-14T12:00:00Z",
      notes: "Security improvements.",
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("delegates installation to the guarded Rust command", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await installApplicationUpdate("1.1.0");

    expect(mocks.invoke).toHaveBeenCalledWith("install_application_update", {
      expectedVersion: "1.1.0",
    });
  });
});
