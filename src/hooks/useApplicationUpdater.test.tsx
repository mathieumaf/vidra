// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type MountedTree } from "../test/dom";
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

const newerRelease: AvailableApplicationUpdate = {
  currentVersion: "0.1.0", version: "0.2.0", date: null, notes: null,
};

let updater: ReturnType<typeof useApplicationUpdater>;
function Harness({ checkOnStartup = false }: { checkOnStartup?: boolean }) {
  updater = useApplicationUpdater(checkOnStartup);
  return <p>{updater.state.phase} {updater.state.update?.version}</p>;
}

describe("application updates", () => {
  let tree: MountedTree | undefined;
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.check.mockResolvedValue(null);
  });
  afterEach(() => {
    tree?.unmount();
    tree = undefined;
  });

  it("checks automatically in release builds and stays idle in development builds", async () => {
    tree = mount(<Harness />);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(updater.state.phase).toBe("idle");
    tree.unmount();

    await act(async () => { tree = mount(<Harness checkOnStartup />); });
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(updater.state.phase).toBe("up-to-date");
  });

  it("reports an available release, then a failed check without keeping the stale release", async () => {
    mocks.check.mockResolvedValueOnce(newerRelease);
    tree = mount(<Harness />);
    await act(async () => updater.checkForUpdates());
    expect(updater.state).toEqual({ phase: "available", update: newerRelease, error: null });

    mocks.check.mockRejectedValueOnce(new Error("offline"));
    await act(async () => updater.checkForUpdates());
    expect(updater.state).toEqual({
      phase: "error",
      update: null,
      error: "Vidra could not check for updates: offline",
    });
  });

  it.each(["success", "failure"])("ignores a late %s from a superseded check", async (outcome) => {
    const first = deferred<AvailableApplicationUpdate | null>();
    mocks.check.mockReturnValueOnce(first.promise);
    tree = mount(<Harness />);
    act(() => { void updater.checkForUpdates(); });
    await act(async () => updater.checkForUpdates());
    await act(async () => {
      if (outcome === "success") first.resolve(newerRelease);
      else first.reject(new Error("Superseded check failed"));
    });
    expect(updater.state).toEqual({ phase: "up-to-date", update: null, error: null });
  });

  it("does not install before a release is available", async () => {
    tree = mount(<Harness />);
    await act(async () => updater.installUpdate());
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it("prevents duplicate installation and checks until an install fails, then allows a retry", async () => {
    mocks.check.mockResolvedValue(newerRelease);
    const installation = deferred<void>();
    mocks.install.mockReturnValueOnce(installation.promise);
    tree = mount(<Harness />);
    await act(async () => updater.checkForUpdates());
    act(() => {
      void updater.installUpdate();
      void updater.installUpdate();
      void updater.checkForUpdates();
    });
    expect(mocks.install).toHaveBeenCalledExactlyOnceWith("0.2.0");
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(updater.state.phase).toBe("installing");

    await act(async () => installation.reject(new Error("Download failed")));
    expect(updater.state).toEqual({
      phase: "error",
      update: newerRelease,
      error: "Vidra could not install the update: Download failed",
    });

    mocks.install.mockResolvedValueOnce(undefined);
    await act(async () => updater.installUpdate());
    expect(mocks.install).toHaveBeenCalledTimes(2);
  });
});
