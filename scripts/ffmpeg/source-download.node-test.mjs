import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureDownloaded } from "./source-download.mjs";

const contents = "pinned source archive\n";
const artifact = {
  archiveName: "source.tar.gz",
  sha256: createHash("sha256").update(contents).digest("hex"),
};

async function fixture(t, handler = (_request, response) => response.end(contents)) {
  const directory = await mkdtemp(join(tmpdir(), "vidra-source-download-"));
  const server = createHttpServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, url: `http://127.0.0.1:${server.address().port}/source.tar.gz` };
}

test("retries TLS handshake failures before using a checksummed mirror", async (t) => {
  const { directory, url } = await fixture(t);
  let connections = 0;
  const brokenTls = createTcpServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise((resolve) => brokenTls.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => brokenTls.close(resolve)));
  const primary = `https://127.0.0.1:${brokenTls.address().port}/source.tar.gz`;
  const archive = await ensureDownloaded({ ...artifact, url: primary }, directory, [url]);
  assert.equal(connections, 4, "one initial TLS connection plus three retries");
  assert.equal(await readFile(archive, "utf8"), contents);
  assert.deepEqual(await readdir(directory), [artifact.archiveName]);
});

test("rejects incorrect mirror bytes and leaves no cached or partial archive", async (t) => {
  let requests = 0;
  const { directory, url } = await fixture(t, (_request, response) => {
    requests += 1;
    response.end("wrong bytes");
  });
  await assert.rejects(
    ensureDownloaded({ ...artifact, url }, directory, [url]),
    /Checksum mismatch/,
  );
  assert.equal(requests, 2, "both the primary and mirror must be checked");
  assert.deepEqual(await readdir(directory), []);
});

test("reuses only a verified cache and recovers from an interrupted download", async (t) => {
  let requests = 0;
  const { directory, url } = await fixture(t, (_request, response) => {
    requests += 1;
    response.end(contents);
  });
  const archive = join(directory, artifact.archiveName);
  await writeFile(archive, "interrupted download");
  await writeFile(`${archive}.partial`, "stale partial");
  await ensureDownloaded({ ...artifact, url }, directory);
  assert.equal(await readFile(archive, "utf8"), contents);
  assert.equal(requests, 1);
  await ensureDownloaded({ ...artifact, url }, directory);
  assert.equal(requests, 1, "a verified cache needs no network request");
  assert.deepEqual(await readdir(directory), [artifact.archiveName]);
});

test("keeps a verified primary and never contacts the mirror", async (t) => {
  const { directory, url } = await fixture(t);
  const archive = await ensureDownloaded({ ...artifact, url }, directory, ["https://invalid.invalid/"]);
  assert.equal(await readFile(archive, "utf8"), contents);
});
