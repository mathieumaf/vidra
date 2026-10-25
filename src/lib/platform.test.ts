import { describe, expect, it } from "vitest";
import { hostComputer, localComputerPhrase, localFilesPrivacyNote } from "./platform";

describe("local computer copy", () => {
  it("keeps the macOS wording", () => {
    expect(hostComputer("MacIntel", "")).toBe("mac");
    expect(hostComputer("", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(localComputerPhrase("mac")).toBe("this Mac");
    expect(localFilesPrivacyNote("mac")).toBe("Files stay on this Mac");
  });

  it("uses a generic phrase on other platforms", () => {
    expect(hostComputer("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)")).toBe("other");
    expect(hostComputer("Win32", "Mozilla/5.0 (Windows NT 10.0)")).toBe("other");
    expect(hostComputer("", "")).toBe("other");
    expect(localComputerPhrase("other")).toBe("this computer");
    expect(localFilesPrivacyNote("other")).toBe("Files stay on this computer");
  });
});
