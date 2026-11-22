import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { checkForApplicationUpdate, installApplicationUpdate } from "./updates";

describe("application update service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks for an update through the Rust boundary", async () => {
    const update = { currentVersion: "0.1.0", version: "0.2.0", date: null, notes: null };
    mocks.invoke.mockResolvedValue(update);

    await expect(checkForApplicationUpdate()).resolves.toEqual(update);
    expect(mocks.invoke).toHaveBeenCalledWith("check_application_update");
  });

  it("passes the expected version to the guarded installation command", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await installApplicationUpdate("0.1.1");

    expect(mocks.invoke).toHaveBeenCalledWith("install_application_update", {
      expectedVersion: "0.1.1",
    });
  });
});
