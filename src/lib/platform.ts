export type HostComputer = "mac" | "other";

/**
 * The computer running Vidra, for copy about files that stay on that computer.
 * macOS webviews report a Mac platform or a Macintosh user agent.
 */
export function hostComputer(
  platform = navigatorValue("platform"),
  userAgent = navigatorValue("userAgent"),
): HostComputer {
  if (/\bmac/i.test(platform) || /macintosh|mac os x/i.test(userAgent)) {
    return "mac";
  }
  return "other";
}

/** "this Mac" on macOS, and a generic phrase everywhere else. */
export function localComputerPhrase(computer = hostComputer()): string {
  return computer === "mac" ? "this Mac" : "this computer";
}

/** Sidebar privacy note. The macOS wording stays exactly as shipped. */
export function localFilesPrivacyNote(computer = hostComputer()): string {
  return `Files stay on ${localComputerPhrase(computer)}`;
}

function navigatorValue(key: "platform" | "userAgent"): string {
  if (typeof navigator === "undefined") return "";
  const value = navigator[key];
  return typeof value === "string" ? value : "";
}
