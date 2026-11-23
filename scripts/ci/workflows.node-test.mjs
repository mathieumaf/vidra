import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The workflows cannot be run from a pull request: the release needs a tag and
// the signing secrets. These checks hold the properties a reviewer would
// otherwise have to re-read every time a workflow changes.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...path) => readFileSync(join(root, ...path), "utf8");
const workflowNames = readdirSync(join(root, ".github", "workflows")).sort();
const workflows = Object.fromEntries(workflowNames.map((name) => [name, read(".github", "workflows", name)]));
const setupAction = read(".github", "actions", "setup", "action.yml");
const everyFile = { ...workflows, "actions/setup/action.yml": setupAction };

test("the repository has exactly these workflows", () => {
  assert.deepEqual(workflowNames, ["ci.yml", "ffmpeg-engine.yml", "publish-update-feed.yml", "release.yml"]);
});

test("every third-party action is pinned to a full commit, with its tag in a comment", () => {
  for (const [file, text] of Object.entries(everyFile)) {
    const uses = [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)];
    assert.ok(uses.length > 0, file);
    for (const [, reference, rest] of uses) {
      if (reference.startsWith("./")) continue;
      assert.match(reference, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${file}: ${reference}`);
      assert.match(rest, /#\s*v\d+\.\d+\.\d+/, `${file}: ${reference} needs its version in a comment`);
    }
  }
});

test("every workflow declares its permissions, and only publishing workflows can write", () => {
  for (const [file, text] of Object.entries(workflows)) {
    const permissions = text.match(/^permissions:\n((?:  .*\n)+)/m);
    assert.ok(permissions, `${file} must declare top-level permissions`);
    const expected = file === "ci.yml" ? "  contents: read\n" : "  contents: write\n";
    assert.equal(permissions[1], expected, file);
    assert.doesNotMatch(text, /pull_request_target/, file);
  }
});

test("CI keeps the job names that branch protection requires", () => {
  for (const name of ["Validate Apple Silicon build", "Build the application bundle", "Check Rust dependency policy"]) {
    assert.match(workflows["ci.yml"], new RegExp(`^    name: ${name}$`, "m"), name);
  }
  // A paths filter would leave a required check unreported on other pull requests.
  assert.doesNotMatch(workflows["ci.yml"], /^\s+paths(-ignore)?:/m);
});

test("CI runs every command of `pnpm check`", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  const commands = scripts.check.split(" && ");
  assert.equal(commands.length, 7);
  for (const command of commands) {
    // CI may call the pnpm script or the command that script runs.
    const body = scripts[command.replace(/^pnpm /, "")];
    assert.ok(
      workflows["ci.yml"].includes(`run: ${command}\n`) || (body && workflows["ci.yml"].includes(`run: ${body}\n`)),
      `ci.yml does not run: ${command}`,
    );
  }
});

test("one Rust version is pinned for local builds, CI, and the dependency check", () => {
  const channel = read("rust-toolchain.toml").match(/^channel = "([^"]+)"$/m)?.[1];
  assert.match(channel ?? "", /^\d+\.\d+\.\d+$/);
  // cargo-deny reads the pin instead of keeping a second copy that a toolchain bump would miss.
  assert.match(workflows["ci.yml"], /^ +rust-version: \$\{\{ steps\.rust\.outputs\.version \}\}$/m);
  assert.ok(workflows["ci.yml"].includes(String.raw`sed -n 's/^channel = "\([0-9][0-9.]*\)"$/\1/p' rust-toolchain.toml`));
  assert.doesNotMatch(workflows["ci.yml"], new RegExp(channel.replaceAll(".", "\\.")));
  assert.match(setupAction, /rustup toolchain install\n/);
  assert.equal(read(".node-version").trim(), "26");
  for (const text of Object.values(everyFile)) {
    assert.doesNotMatch(text, /node-version: /, "use node-version-file so .node-version is the one pin");
  }
});

test("a release runs only for a vX.Y.Z tag, on main, in the release environment, and stays a draft", () => {
  const release = workflows["release.yml"];
  assert.match(release, /^on:\n  push:\n    tags:\n      - "v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"\n/m);
  assert.doesNotMatch(release, /workflow_dispatch|pull_request|schedule/);
  assert.match(release, /^    environment: release$/m);
  // The full ref, so a tag named origin/main cannot stand in for the branch.
  assert.match(release, /git merge-base --is-ancestor "\$GITHUB_SHA" refs\/remotes\/origin\/main\n/);
  // One run per tag: a shared group would drop a pending release.
  assert.match(release, /^concurrency:\n  group: release-\$\{\{ github\.ref \}\}\n  cancel-in-progress: false\n/m);
  assert.match(release, /releaseDraft: true/);
  assert.match(release, /prerelease: false/);
  assert.match(release, /gh release edit "\$GITHUB_REF_NAME" --draft /);
  // A release never depends on a cache, and never compiles or overrides FFmpeg.
  assert.match(release, /uses: \.\/\.github\/actions\/setup\n        with:\n          cache: "false"/);
  assert.doesNotMatch(release, /--build|brew install/);
  // Every cache in the setup action obeys that input.
  assert.doesNotMatch(setupAction, /cache: pnpm/);
  assert.match(setupAction, /cache: \$\{\{ inputs\.cache == 'true' && 'pnpm' \|\| '' \}\}/);
  assert.equal(setupAction.match(/if: inputs\.cache == 'true'/g)?.length, 2);
});

test("a release that did not finish leaves no draft that could be published", () => {
  const release = workflows["release.yml"];
  const cleanup = release.indexOf("if: ${{ !success() }}");
  assert.ok(cleanup > release.indexOf("release-complete.json"), "the cleanup must be the last step");
  assert.match(release.slice(cleanup), /--json isDraft --jq \.isDraft[^\n]*= "true"[\s\S]*gh release delete "\$GITHUB_REF_NAME" --yes\n/);
  // The tag is kept, and a published release is never deleted.
  assert.doesNotMatch(release, /--cleanup-tag|git push .*--delete|git tag -d/);
});

test("a release proves the source and verifies what it built before the draft is complete", () => {
  const release = workflows["release.yml"];
  const order = [
    'pnpm release:check -- "$GITHUB_REF_NAME"',
    "run: pnpm check",
    "pnpm ffmpeg:prepare -- --export-sources release-assets/ffmpeg-sources",
    "uses: tauri-apps/tauri-action@",
    "node scripts/release/verify-bundle.mjs",
    "node scripts/release/verify-updater-manifest.mjs",
    "spctl --assess --type execute",
    "gh release upload",
    "node scripts/release/mark-complete.mjs",
    'gh release upload "$GITHUB_REF_NAME" "$RUNNER_TEMP/release-complete.json"',
  ].map((step) => {
    const index = release.indexOf(step);
    assert.ok(index > 0, `release.yml is missing: ${step}`);
    return index;
  });
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "the release steps are out of order");
});

test("signing secrets are read only by the release job", () => {
  const secret = /secrets\.(?!GITHUB_TOKEN)[A-Z_]+/g;
  for (const [file, text] of Object.entries(everyFile)) {
    const found = text.match(secret) ?? [];
    if (file === "release.yml") {
      assert.deepEqual([...new Set(found)].sort(), [
        "secrets.APPLE_CERTIFICATE", "secrets.APPLE_CERTIFICATE_PASSWORD", "secrets.APPLE_ID", "secrets.APPLE_PASSWORD",
        "secrets.APPLE_SIGNING_IDENTITY", "secrets.APPLE_TEAM_ID",
        "secrets.TAURI_SIGNING_PRIVATE_KEY", "secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
      ]);
    } else {
      assert.deepEqual(found, [], file);
    }
  }
});

test("the update feed moves only for a published application release, with scripts from main", () => {
  const feed = workflows["publish-update-feed.yml"];
  assert.match(feed, /^on:\n  release:\n    types: \[published\]\n/m);
  assert.match(feed, /if: startsWith\(github\.event\.release\.tag_name, 'v'\) && !github\.event\.release\.prerelease/);
  assert.match(feed, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  // No argument: the script then trusts the public key in src-tauri/tauri.conf.json.
  assert.match(feed, /run: node scripts\/release\/publish-update-feed\.mjs\n/);
  // Runs are serialized and none is dropped while another one is waiting.
  assert.match(feed, /^concurrency:\n  group: update-feed\n  cancel-in-progress: false\n  queue: max\n/m);
});

test("the engine workflow is manual and never replaces a published archive", () => {
  const engine = workflows["ffmpeg-engine.yml"];
  assert.match(engine, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(engine, /--clobber|gh release upload/);
  // The refusal comes before the compilation, which takes several minutes.
  const refusal = engine.indexOf("A published archive is never replaced");
  assert.ok(refusal > 0 && refusal < engine.indexOf("prepare.mjs --build"));
});

test("untrusted event text never reaches a shell command directly", () => {
  for (const [file, text] of Object.entries(everyFile)) {
    for (const block of text.matchAll(/^\s+run: (?:[|>]-?\n((?:\s{8,}.*\n|\n)+)|(.*)$)/gm)) {
      const script = block[1] ?? block[2] ?? "";
      assert.doesNotMatch(script, /\$\{\{\s*github\.(event|head_ref|base_ref|ref_name)/, `${file}: pass event values through env`);
    }
  }
});

test("Dependabot watches every pinned input", () => {
  const dependabot = read(".github", "dependabot.yml");
  for (const ecosystem of ["npm", "cargo", "github-actions", "rust-toolchain"]) {
    assert.match(dependabot, new RegExp(`package-ecosystem: ${ecosystem}\\b`), ecosystem);
  }
  assert.match(dependabot, /- \/\.github\/actions\/setup/);
});
