import { availableParallelism, platform, arch } from "node:os";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BUILD_RECIPE_VERSION = 2;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, "..", "..");
const manifest = JSON.parse(await readFile(join(scriptDirectory, "sources.json"), "utf8"));
const release = manifest.release;
const hostPlatform = platform();
const hostArchitecture = arch();
const target = `${hostArchitecture === "arm64" ? "aarch64" : hostArchitecture}-apple-darwin`;

if (hostPlatform !== "darwin" || target !== release.target) {
  throw new Error(`Release FFmpeg builds require macOS Apple Silicon, received ${hostPlatform}/${hostArchitecture}.`);
}

const jobs = String(Math.max(1, availableParallelism()));
const cacheDirectory = join(rootDirectory, ".cache", "ffmpeg", "release", target);
const downloadDirectory = join(cacheDirectory, "downloads");
const sourceDirectory = join(cacheDirectory, "sources");
const buildDirectory = join(cacheDirectory, "build");
const prefixDirectory = join(cacheDirectory, "prefix");
const ffmpegPrefix = join(cacheDirectory, "ffmpeg-install");
const binaryDirectory = join(rootDirectory, "src-tauri", "binaries");
const assetDirectory = join(rootDirectory, "release-assets", "ffmpeg-sources");
const markerPath = join(cacheDirectory, "build-marker.json");
const reproducibleSourceRoot = "/usr/src/vidra-ffmpeg";
const prefixMapFlags = [
  `-ffile-prefix-map=${cacheDirectory}=${reproducibleSourceRoot}`,
  `-fdebug-prefix-map=${cacheDirectory}=${reproducibleSourceRoot}`,
].join(" ");
const recipeFingerprint = createHash("sha256")
  .update(JSON.stringify({ version: BUILD_RECIPE_VERSION, release }))
  .digest("hex");
const deploymentTarget = release.minimumMacOSVersion;
const commonEnvironment = {
  ...process.env,
  LC_ALL: "C",
  TZ: "UTC",
  SOURCE_DATE_EPOCH: "1781653620",
  ZERO_AR_DATE: "1",
  MACOSX_DEPLOYMENT_TARGET: deploymentTarget,
  CFLAGS: `-O2 -mmacosx-version-min=${deploymentTarget} ${prefixMapFlags}`,
  CXXFLAGS: `-O2 -mmacosx-version-min=${deploymentTarget} ${prefixMapFlags}`,
  LDFLAGS: `-mmacosx-version-min=${deploymentTarget}`,
  PKG_CONFIG_PATH: [
    join(prefixDirectory, "lib", "pkgconfig"),
    join(prefixDirectory, "lib64", "pkgconfig"),
  ].join(":"),
};

await Promise.all([
  mkdir(downloadDirectory, { recursive: true }),
  mkdir(sourceDirectory, { recursive: true }),
  mkdir(buildDirectory, { recursive: true }),
  mkdir(binaryDirectory, { recursive: true }),
  mkdir(assetDirectory, { recursive: true }),
]);

for (const command of ["curl", "tar", "make", "cmake", "pkg-config", "codesign", "strip", "ditto"]) {
  requireCommand(command);
}

const sources = {};
for (const [name, artifact] of Object.entries(release.sources)) {
  sources[name] = await prepareSource(name, artifact);
}

const currentMarker = await readJson(markerPath);
const builtFfmpeg = join(ffmpegPrefix, "bin", "ffmpeg");
const builtFfprobe = join(ffmpegPrefix, "bin", "ffprobe");
if (
  currentMarker?.fingerprint !== recipeFingerprint
  || !(await exists(builtFfmpeg))
  || !(await exists(builtFfprobe))
) {
  await rm(buildDirectory, { recursive: true, force: true });
  await rm(prefixDirectory, { recursive: true, force: true });
  await rm(ffmpegPrefix, { recursive: true, force: true });
  await Promise.all([
    mkdir(buildDirectory, { recursive: true }),
    mkdir(prefixDirectory, { recursive: true }),
    mkdir(ffmpegPrefix, { recursive: true }),
  ]);

  buildX264(sources.x264);
  buildOpus(sources.opus);
  buildX265(sources.x265);
  buildSvtAv1(sources.svtAv1);
  buildFfmpeg(sources.ffmpeg);
  await writeFile(markerPath, `${JSON.stringify({ fingerprint: recipeFingerprint }, null, 2)}\n`);
} else {
  console.log(`Release FFmpeg ${release.sources.ffmpeg.version} is already built.`);
}

for (const name of ["ffmpeg", "ffprobe"]) {
  const source = join(ffmpegPrefix, "bin", name);
  const destination = join(binaryDirectory, `${name}-${target}`);
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  run("strip", ["-x", destination]);
  run("codesign", ["--force", "--sign", "-", destination]);
}

verifyReleaseBinary(join(binaryDirectory, `ffmpeg-${target}`));
await packageCorrespondingSources();
console.log(`Release FFmpeg ${release.sources.ffmpeg.version} is ready for ${target}.`);

function buildX264(source) {
  const build = join(buildDirectory, "x264");
  copySourceTree(source, build);
  run(join(build, "configure"), [
    `--prefix=${prefixDirectory}`,
    "--enable-static",
    "--enable-pic",
    "--disable-cli",
    "--disable-opencl",
  ], { cwd: build });
  run("make", ["-j", jobs], { cwd: build });
  run("make", ["install"], { cwd: build });
}

function buildOpus(source) {
  const build = join(buildDirectory, "opus");
  copySourceTree(source, build);
  run(join(build, "configure"), [
    `--prefix=${prefixDirectory}`,
    "--disable-shared",
    "--enable-static",
    "--disable-doc",
    "--disable-extra-programs",
  ], { cwd: build });
  run("make", ["-j", jobs], { cwd: build });
  run("make", ["install"], { cwd: build });
}

function buildX265(source) {
  const build = join(buildDirectory, "x265");
  run("cmake", [
    "-S", join(source, "source"),
    "-B", build,
    `-DCMAKE_INSTALL_PREFIX=${prefixDirectory}`,
    `-DCMAKE_OSX_DEPLOYMENT_TARGET=${deploymentTarget}`,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DENABLE_SHARED=OFF",
    "-DENABLE_CLI=OFF",
    "-DENABLE_LIBNUMA=OFF",
  ]);
  run("cmake", ["--build", build, "--parallel", jobs]);
  run("cmake", ["--install", build]);
}

function buildSvtAv1(source) {
  const build = join(buildDirectory, "svt-av1");
  run("cmake", [
    "-S", source,
    "-B", build,
    `-DCMAKE_INSTALL_PREFIX=${prefixDirectory}`,
    `-DCMAKE_OSX_DEPLOYMENT_TARGET=${deploymentTarget}`,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DBUILD_APPS=OFF",
    "-DBUILD_TESTING=OFF",
  ]);
  run("cmake", ["--build", build, "--parallel", jobs]);
  run("cmake", ["--install", build]);
}

function buildFfmpeg(source) {
  const build = join(buildDirectory, "ffmpeg");
  copySourceTree(source, build);
  const configuration = ffmpegConfiguration();
  run(join(build, "configure"), configuration, { cwd: build });
  run("make", ["-j", jobs], { cwd: build });
  run("mkdir", ["-p", join(ffmpegPrefix, "bin")]);
  run("ditto", [join(build, "ffmpeg"), join(ffmpegPrefix, "bin", "ffmpeg")]);
  run("ditto", [join(build, "ffprobe"), join(ffmpegPrefix, "bin", "ffprobe")]);
}

function ffmpegConfiguration() {
  return [
    "--prefix=/opt/vidra-ffmpeg",
    "--pkg-config-flags=--static",
    "--extra-cflags=-I../../prefix/include",
    "--extra-ldflags=-L../../prefix/lib",
    "--extra-libs=-lpthread -lm -lc++",
    "--enable-static",
    "--disable-shared",
    "--disable-debug",
    "--disable-doc",
    "--disable-ffplay",
    "--disable-network",
    "--enable-gpl",
    "--enable-libx264",
    "--enable-libx265",
    "--enable-libsvtav1",
    "--enable-libopus",
    "--enable-videotoolbox",
    "--enable-audiotoolbox",
  ];
}

async function prepareSource(name, artifact) {
  const archive = join(downloadDirectory, artifact.archiveName);
  if (!(await exists(archive))) {
    console.log(`Downloading ${name} ${artifact.version}...`);
    run("curl", ["-fL", "--retry", "3", artifact.url, "-o", archive]);
  }
  const digest = await sha256(archive);
  if (digest !== artifact.sha256) {
    await rm(archive, { force: true });
    throw new Error(`Checksum mismatch for ${artifact.archiveName}: expected ${artifact.sha256}, received ${digest}.`);
  }

  const destination = join(sourceDirectory, `${name}-${artifact.version}`);
  const marker = join(destination, ".vidra-source-sha256");
  if ((await exists(marker)) && (await readFile(marker, "utf8")).trim() === artifact.sha256) {
    return destination;
  }

  const temporary = `${destination}.tmp`;
  await rm(temporary, { recursive: true, force: true });
  await rm(destination, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  run("tar", ["-xf", archive, "-C", temporary]);
  const entries = (await readdir(temporary, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) {
    throw new Error(`${artifact.archiveName} must contain exactly one source directory.`);
  }
  await rename(join(temporary, entries[0].name), destination);
  await rm(temporary, { recursive: true, force: true });
  await writeFile(marker, `${artifact.sha256}\n`);
  return destination;
}

function copySourceTree(source, destination) {
  run("ditto", [source, destination]);
}

function verifyReleaseBinary(ffmpeg) {
  const result = run(ffmpeg, ["-hide_banner", "-encoders"], { capture: true });
  for (const encoder of [
    "libx264",
    "libx265",
    "libsvtav1",
    "h264_videotoolbox",
    "hevc_videotoolbox",
    "aac",
    "libopus",
  ]) {
    if (!result.includes(encoder)) {
      throw new Error(`Release FFmpeg is missing the required ${encoder} encoder.`);
    }
  }
}

async function packageCorrespondingSources() {
  await rm(assetDirectory, { recursive: true, force: true });
  await mkdir(assetDirectory, { recursive: true });
  const checksumLines = [];
  for (const artifact of Object.values(release.sources)) {
    const source = join(downloadDirectory, artifact.archiveName);
    const destination = join(assetDirectory, artifact.archiveName);
    await copyFile(source, destination);
    checksumLines.push(`${artifact.sha256}  ${artifact.archiveName}`);
  }
  await writeFile(join(assetDirectory, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);
  await writeFile(join(assetDirectory, "BUILD_CONFIGURATION.txt"), [
    `Vidra FFmpeg release build recipe ${BUILD_RECIPE_VERSION}`,
    `Target: ${target}`,
    `Minimum macOS: ${deploymentTarget}`,
    "",
    "FFmpeg configure arguments:",
    ...ffmpegConfiguration().map((argument) => `  ${argument}`),
    "",
    "All source archives and their checksums are included in this directory.",
    "The complete executable build recipe is scripts/ffmpeg/build-release.mjs in the Vidra source tree.",
    "No local patches are applied.",
    "",
  ].join("\n"));
}

function requireCommand(command) {
  const result = spawnSync("/usr/bin/env", ["which", command], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`The release build requires ${command}. Install the documented build prerequisites first.`);
  }
}

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDirectory,
    env: commonEnvironment,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}.${result.stderr ? `\n${result.stderr}` : ""}`);
  }
  return options.capture ? `${result.stdout ?? ""}\n${result.stderr ?? ""}` : "";
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
