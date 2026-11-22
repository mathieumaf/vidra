import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// node scripts/release/verify-bundle.mjs <Vidra.app>
//
// Checks a built application bundle against the repository it was built from.
// CI runs it on an unsigned bundle for every pull request, and the release
// workflow runs it on the signed one, so a broken bundle is found before a tag.

function infoPlist(bundle) {
  const converted = spawnSync("plutil", ["-convert", "json", "-o", "-", join(bundle, "Contents", "Info.plist")], { encoding: "utf8" });
  if (converted.status !== 0) {
    throw new Error(`Unable to read ${bundle}/Contents/Info.plist: ${converted.stderr || converted.stdout || "plutil failed"}`);
  }
  return JSON.parse(converted.stdout);
}

function reportedVersion(executable) {
  const result = spawnSync(executable, ["-version"], { encoding: "utf8" });
  const line = result.status === 0 ? (result.stdout ?? "").split(/\r?\n/)[0] : "";
  return line.match(/(?:^|\s)version\s+(\S+)/)?.[1] ?? "";
}

/**
 * Every way the bundle differs from what the repository says it should
 * contain. An empty list means the bundle is the application this commit
 * describes, with the pinned engine inside.
 */
export function bundleProblems({ bundle, expected, plist = infoPlist(bundle), versionOf = reportedVersion }) {
  const problems = [];
  const expectPlist = (key, value) => {
    if (plist[key] !== value) {
      problems.push(`Info.plist ${key} is ${JSON.stringify(plist[key])}, expected ${JSON.stringify(value)}.`);
    }
  };
  expectPlist("CFBundleShortVersionString", expected.version);
  expectPlist("CFBundleIdentifier", expected.identifier);
  expectPlist("LSMinimumSystemVersion", expected.minimumSystemVersion);

  const executable = plist.CFBundleExecutable;
  if (typeof executable !== "string" || !/^[^/.][^/]*$/.test(executable)) {
    problems.push(`Info.plist CFBundleExecutable is ${JSON.stringify(executable)}, expected a file name.`);
  } else if (!runnableFile(join(bundle, "Contents", "MacOS", executable))) {
    problems.push(`The bundle has no runnable application executable at Contents/MacOS/${executable}.`);
  }
  for (const name of ["ffmpeg", "ffprobe"]) {
    const sidecar = join(bundle, "Contents", "MacOS", name);
    if (!runnableFile(sidecar)) {
      problems.push(`The bundle has no runnable ${name} sidecar at ${sidecar}.`);
      continue;
    }
    const version = versionOf(sidecar);
    if (version !== expected.ffmpegVersion) {
      problems.push(`The bundled ${name} reports ${version || "no version"}, expected the pinned ${expected.ffmpegVersion}.`);
    }
  }

  let notices = null;
  try {
    notices = readFileSync(join(bundle, "Contents", "Resources", "THIRD_PARTY_NOTICES.md"), "utf8");
  } catch {
    problems.push("The bundle has no Contents/Resources/THIRD_PARTY_NOTICES.md.");
  }
  if (notices !== null && notices !== expected.notices) {
    problems.push("The bundled THIRD_PARTY_NOTICES.md differs from the one in the repository.");
  }
  return problems;
}

function runnableFile(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** What the repository says a bundle built from it contains. */
export async function expectedBundle(rootDirectory) {
  const read = (...path) => readFile(join(rootDirectory, ...path), "utf8");
  const tauri = JSON.parse(await read("src-tauri", "tauri.conf.json"));
  const macos = JSON.parse(await read("src-tauri", "tauri.macos.conf.json"));
  const recipe = JSON.parse(await read("scripts", "ffmpeg", "sources.json")).targets["aarch64-apple-darwin"];
  const minimumSystemVersion = macos.bundle.macOS.minimumSystemVersion;
  if (minimumSystemVersion !== recipe.minimumMacOSVersion) {
    throw new Error(
      `The application requires macOS ${minimumSystemVersion}, but the FFmpeg engine is built for macOS ${recipe.minimumMacOSVersion}. `
      + "Align src-tauri/tauri.macos.conf.json and scripts/ffmpeg/sources.json.",
    );
  }
  return {
    version: tauri.version,
    identifier: tauri.identifier,
    minimumSystemVersion,
    ffmpegVersion: recipe.sources.ffmpeg.version,
    notices: await read("THIRD_PARTY_NOTICES.md"),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [bundleArgument] = process.argv.slice(2).filter((argument) => argument !== "--");
  if (!bundleArgument) throw new Error("Usage: verify-bundle.mjs <Vidra.app>");
  const bundle = resolve(bundleArgument);
  const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const expected = await expectedBundle(rootDirectory);
  const problems = bundleProblems({ bundle, expected });
  if (problems.length > 0) {
    throw new Error(`${bundle} is not the application this commit describes:\n- ${problems.join("\n- ")}`);
  }
  console.log(`${bundle} is Vidra ${expected.version} for macOS ${expected.minimumSystemVersion} or later, with FFmpeg ${expected.ffmpegVersion} and the license notices inside.`);
}
