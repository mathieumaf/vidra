import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { checkForApplicationUpdate, installApplicationUpdate } from "./updates";

describe("application update service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks the selected channel through the Rust boundary", async () => {
    const update = { currentVersion: "0.1.0", version: "0.2.0-beta.1", date: null, notes: null };
    mocks.invoke.mockResolvedValue(update);

    await expect(checkForApplicationUpdate("beta")).resolves.toEqual(update);
    expect(mocks.invoke).toHaveBeenCalledWith("check_application_update", { channel: "beta" });
  });

  it("passes the version and channel to the guarded installation command", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await installApplicationUpdate("0.1.1", "stable");

    expect(mocks.invoke).toHaveBeenCalledWith("install_application_update", {
      expectedVersion: "0.1.1",
      channel: "stable",
    });
  });
});
