import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = join(scriptDirectory, "..", "..");
const manifest = JSON.parse(await readFile(join(scriptDirectory, "sources.json"), "utf8"));

const target = `${process.arch === "arm64" ? "aarch64" : process.arch}-apple-darwin`;

if (process.platform !== "darwin" || target !== "aarch64-apple-darwin") {
  throw new Error(`FFmpeg preparation is not implemented for ${process.platform}/${process.arch} yet.`);
}

const release = manifest[target];
const cacheDirectory = join(rootDirectory, ".cache", "ffmpeg", target);
const binaryDirectory = join(rootDirectory, "src-tauri", "binaries");

await mkdir(cacheDirectory, { recursive: true });
await mkdir(binaryDirectory, { recursive: true });

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
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function extractExecutable(archive, executable, destination) {
  const listing = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" });
  if (listing.status !== 0) {
    throw new Error(`Unable to inspect ${basename(archive)}: ${listing.stderr}`);
  }

  const entry = listing.stdout
    .split("\n")
    .find((candidate) => basename(candidate.trim()) === executable);

  if (!entry) {
    throw new Error(`${executable} was not found in ${basename(archive)}.`);
  }

  const temporaryDestination = `${destination}.tmp`;
  const output = await open(temporaryDestination, "w");
  const extraction = spawnSync("unzip", ["-p", archive, entry], {
    stdio: ["ignore", output.fd, "pipe"],
    encoding: "utf8"
  });
  await output.close();

  if (extraction.status !== 0) {
    await rm(temporaryDestination, { force: true });
    throw new Error(`Unable to extract ${executable}: ${extraction.stderr}`);
  }

  await chmod(temporaryDestination, 0o755);
  await rename(temporaryDestination, destination);
}

function signExecutable(executable, destination) {
  spawnSync("xattr", ["-cr", destination], { stdio: "ignore" });
  const signing = spawnSync("codesign", ["--force", "--sign", "-", destination], {
    encoding: "utf8"
  });
  if (signing.status !== 0) {
    throw new Error(`Unable to ad-hoc sign ${executable}: ${signing.stderr}`);
  }
}

for (const [name, artifact] of Object.entries(release.binaries)) {
  const destination = join(binaryDirectory, `${name}-${target}`);
  const marker = join(binaryDirectory, `.${name}-${target}.sha256`);
  const markerMatches =
    (await exists(marker)) &&
    (await readFile(marker, "utf8")).trim() === artifact.binarySha256;

  if ((await exists(destination)) && markerMatches) {
    console.log(`${name} ${release.version} is ready for ${target}.`);
    continue;
  }

  const archive = join(cacheDirectory, `${name}-${release.version}.zip`);
  if (!(await exists(archive))) {
    console.log(`Downloading ${name} ${release.version} for ${target}...`);
    await download(artifact.url, archive);
  }

  await extractExecutable(archive, name, destination);
  const digest = await sha256(destination);
  if (digest !== artifact.binarySha256) {
    await rm(destination, { force: true });
    await rm(archive, { force: true });
    throw new Error(
      `Checksum mismatch for ${name}: expected ${artifact.binarySha256}, received ${digest}.`
    );
  }

  signExecutable(name, destination);
  await writeFile(marker, `${artifact.binarySha256}\n`);
  console.log(`${name} ${release.version} is ready for ${target}.`);
}
