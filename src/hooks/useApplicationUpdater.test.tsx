// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type MountedTree } from "../test/dom";
import { UPDATE_CHANNEL_STORAGE_KEY } from "../lib/updateChannel";
import type { AvailableApplicationUpdate } from "../types/applicationUpdate";

const mocks = vi.hoisted(() => ({ check: vi.fn(), install: vi.fn() }));
vi.mock("../services/updates", () => ({
  checkForApplicationUpdate: mocks.check,
  installApplicationUpdate: mocks.install,
}));
import { useApplicationUpdater } from "./useApplicationUpdater";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const betaUpdate: AvailableApplicationUpdate = {
  currentVersion: "0.1.0", version: "0.2.0-beta.1", date: null, notes: null,
};

let updater: ReturnType<typeof useApplicationUpdater>;
function Harness({ checkOnStartup = false }: { checkOnStartup?: boolean }) {
  updater = useApplicationUpdater(checkOnStartup);
  return <p>{updater.state.channel} {updater.state.phase} {updater.state.update?.version}</p>;
}

describe("application update channels", () => {
  let tree: MountedTree | undefined;
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    mocks.check.mockResolvedValue(null);
  });
  afterEach(() => {
    tree?.unmount();
    tree = undefined;
    vi.restoreAllMocks();
  });

  it("defaults to Stable and remembers an explicit Beta choice after remounting", async () => {
    tree = mount(<Harness />);
    expect(updater.state.channel).toBe("stable");
    await act(async () => updater.setChannel("beta"));
    expect(mocks.check).toHaveBeenLastCalledWith("beta");
    expect(localStorage.getItem(UPDATE_CHANNEL_STORAGE_KEY)).toBe("beta");
    tree.unmount();
    tree = mount(<Harness />);
    expect(updater.state.channel).toBe("beta");
  });

  it("checks the saved channel automatically in release builds", async () => {
    localStorage.setItem(UPDATE_CHANNEL_STORAGE_KEY, "beta");
    await act(async () => { tree = mount(<Harness checkOnStartup />); });
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith("beta");
  });

  it("falls back to Stable for invalid or unavailable storage", () => {
    localStorage.setItem(UPDATE_CHANNEL_STORAGE_KEY, "nightly");
    tree = mount(<Harness />);
    expect(updater.state.channel).toBe("stable");
    tree.unmount();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Unavailable"); });
    tree = mount(<Harness />);
    expect(updater.state.channel).toBe("stable");
  });

  it.each(["success", "failure"])("ignores a late %s from the previous channel", async (outcome) => {
    const betaCheck = deferred<AvailableApplicationUpdate | null>();
    mocks.check.mockImplementation((channel) => channel === "beta" ? betaCheck.promise : Promise.resolve(null));
    tree = mount(<Harness />);
    act(() => updater.setChannel("beta"));
    await act(async () => updater.setChannel("stable"));
    await act(async () => {
      if (outcome === "success") betaCheck.resolve(betaUpdate);
      else betaCheck.reject(new Error("Old channel failed"));
    });
    expect(updater.state).toEqual({ channel: "stable", phase: "up-to-date", update: null, error: null });
  });

  it("clears an available beta before checking Stable and prevents stale installation", async () => {
    mocks.check.mockResolvedValueOnce(betaUpdate);
    tree = mount(<Harness />);
    await act(async () => updater.setChannel("beta"));
    expect(updater.state.update).toEqual(betaUpdate);
    const stableCheck = deferred<AvailableApplicationUpdate | null>();
    mocks.check.mockReturnValueOnce(stableCheck.promise);
    await act(async () => {
      updater.setChannel("stable");
      await updater.installUpdate();
    });
    expect(updater.state.update).toBeNull();
    expect(mocks.install).not.toHaveBeenCalled();
    await act(async () => stableCheck.resolve(null));
  });

  it("locks the channel and prevents duplicate installation until an install fails", async () => {
    mocks.check.mockResolvedValue(betaUpdate);
    const installation = deferred<void>();
    mocks.install.mockReturnValue(installation.promise);
    tree = mount(<Harness />);
    await act(async () => updater.setChannel("beta"));
    act(() => {
      void updater.installUpdate();
      void updater.installUpdate();
      updater.setChannel("stable");
      void updater.checkForUpdates();
    });
    expect(mocks.install).toHaveBeenCalledExactlyOnceWith("0.2.0-beta.1", "beta");
    expect(updater.state.channel).toBe("beta");
    expect(updater.state.phase).toBe("installing");
    await act(async () => installation.reject(new Error("Download failed")));
    expect(updater.state.phase).toBe("error");
    mocks.check.mockResolvedValue(null);
    await act(async () => updater.setChannel("stable"));
    expect(updater.state.update).toBeNull();
    expect(updater.state.channel).toBe("stable");
  });
});
