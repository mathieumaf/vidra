# Releasing Vidra

Vidra publishes official releases only, for macOS on Apple Silicon. A release is the tag `vX.Y.Z` on `main`. There are no beta or release-candidate builds: a defect is fixed in the next patch release.

Everything between the tag and a draft release is automatic. Publishing the draft is a maintainer's decision, taken by hand.

```text
pull request ──► CI ──► merge ──► tag vX.Y.Z ──► Release workflow ──► draft ──► publish by hand ──► update feed
                 │                                │                                                  │
                 proves the source                builds, signs, notarizes,                          installed copies
                 and the bundle                   verifies what it built                             offer the update
```

## Release steps

1. **Prepare.** Open a pull request that:
   - sets the new version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the `vidra` entry of `src-tauri/Cargo.lock`;
   - moves the `Unreleased` notes of `CHANGELOG.md` under a `## X.Y.Z - YYYY-MM-DD` heading. That section becomes the release notes.

   `pnpm check` passes, and so does `pnpm release:check -- vX.Y.Z`. Merge it.

2. **Tag** the merged commit on `main`:

   ```sh
   git switch main && git pull
   git tag -s vX.Y.Z -m "Vidra X.Y.Z"
   git push origin vX.Y.Z
   ```

3. **Approve** the `release` environment when GitHub asks. The Release workflow runs for about fifteen minutes and leaves a draft release.

4. **Try the draft.** Download the DMG from the draft and run the [checks a person makes](#checks-a-person-makes).

5. **Publish** the draft as the latest release. The "Publish the update feed" workflow then moves the update feed to it. Installed copies offer the update the next time they start.

6. **Confirm** that the workflow succeeded and that the feed names the release:

   ```sh
   gh release download updater-manifest --pattern latest.json --output - | grep '"version"'
   ```

## What runs automatically

| When | Workflow | What it proves |
| --- | --- | --- |
| Every pull request | `ci.yml`, job "Validate Apple Silicon build" | The frontend builds. Vitest, the script tests, `cargo fmt`, Clippy, and the Rust tests pass. The conversion corpus encodes with the pinned FFmpeg engine. The version files agree. |
| Every pull request | `ci.yml`, job "Build the application bundle" | The application bundles, unsigned, exactly as the release does. The bundle has the right version, identifier, and minimum macOS version, the pinned FFmpeg and FFprobe, and the license notices. |
| Every pull request | `ci.yml`, job "Check Rust dependency policy" | Crate licenses, advisories, and sources (`cargo-deny`). |
| A `vX.Y.Z` tag | `release.yml` | See below. |
| A release published by hand | `publish-update-feed.yml` | The release is published, official, and complete: it has the marker of a finished run and everything that marker lists. Its manifest announces its own version and downloads its own archive, and its signatures verify that archive with the committed public key. The feed only moves forward. |

The Release workflow, in order:

1. refuses a tag that is not on `main`, a tag that is not exactly `v` plus the version in the four version files, and a release whose changelog section is missing, undated, or empty;
2. installs the pinned toolchains and the pinned FFmpeg engine, without any cache;
3. runs `pnpm check`: the same proof as CI, on the tagged commit;
4. exports the engine's GPL corresponding sources and checks each one against the checksum the recipe pins;
5. builds, signs, and notarizes the application and the DMG, and creates a draft release with the update archive, its signature, and its manifest. The manifest's note, which the app shows with the update, is one fixed line that points to the release page;
6. checks the signed bundle: version, identifier, minimum macOS version, engine version, license notices;
7. checks the update manifest on the draft: it announces the tag's version, its signatures verify the archive built on the runner with the committed public key, they were made for that version, and it downloads that archive;
8. checks the code signature, the notarization ticket, and Gatekeeper's verdict on the application inside the DMG;
9. attaches the DMG checksum and the corresponding sources, and writes the changelog section as the release notes;
10. reads back what is attached and, when nothing is missing, uploads `release-complete.json`. The update feed refuses a release without that marker.

If a step fails, or the run is cancelled or times out, the workflow deletes the draft, so a release that did not pass every check cannot be published. The tag stays: delete it, fix the cause, and tag again.

## Checks a person makes

The workflow cannot use the application. Before publishing the draft, on a Mac, ideally one without development tools:

- [ ] The DMG opens, Vidra moves to Applications and starts without a Gatekeeper warning.
- [ ] Settings shows the new version and the pinned FFmpeg version.
- [ ] One conversion with H.264 and one with H.265 or AV1 finish. The outputs play. The sources are unchanged.
- [ ] A cancelled conversion leaves no temporary file in the destination folder.

After publishing, from the previous release:

- [ ] "Check for updates" in Settings offers the new version, installs it, and restarts Vidra on it. Profiles and history are still there.

The update itself can only be observed after publication, because the feed is what offers it. The workflow's manifest check covers the failure that made the 0.2.0-rc.2 update impossible to install.

## When a release is wrong

Never replace the files of a published release. Publish a fixed version with a new tag.

The update feed only moves forward, so publishing an older release changes nothing. To stop offering a bad release before its fix exists, put the previous release's manifest back by hand:

```sh
gh release download vX.Y.(Z-1) --pattern latest.json --dir /tmp/previous
cp /tmp/previous/latest.json /tmp/previous/beta.json
gh release upload updater-manifest /tmp/previous/latest.json /tmp/previous/beta.json --clobber
```

Copies that already installed the bad release stay on it until the fixed version is published. Vidra never downgrades.

## The update feed

Installed copies read one file: the `latest.json` asset of the rolling `updater-manifest` release. It is not an application release. Copies installed from a 0.2.0 beta or release candidate read `beta.json` there first, so both assets receive every official release. A missing asset is filled by the next release that is published. The publication stops instead when the other asset already offers something newer, so a gap is never filled with an older release.

The app offers an update only for a newer official version. It installs it only when the archive's signature verifies with the public key in `src-tauri/tauri.conf.json` and was made for the announced version (`requireSignedVersion`), and only while no conversion is queued, running, or paused.

## The FFmpeg engine

The engine is the FFmpeg and FFprobe build that Vidra bundles. One archive is used everywhere: development, CI, and the release all install it with `pnpm ffmpeg:prepare`, which checks its SHA-256 first. What CI tests is what ships.

| File | Role |
| --- | --- |
| `scripts/ffmpeg/sources.json` | The recipe: every source archive with its version, URL, and SHA-256. |
| `scripts/ffmpeg/build.mjs` | The commands that compile the recipe. `BUILD_RECIPE_VERSION` in `recipe.mjs` changes when they do. |
| `scripts/ffmpeg/engine.json` | The pin: the published archive's URL and SHA-256, and the fingerprint of the recipe it was built from. |

A change to the sources or to the recipe version changes the fingerprint. Preparation then refuses the pinned archive, and CI fails until a new archive is published and pinned. To update the engine:

1. **Change the recipe.** Edit `scripts/ffmpeg/sources.json`, and raise `BUILD_RECIPE_VERSION` in `recipe.mjs` if the build commands change.
2. **Describe the new archive** in `scripts/ffmpeg/engine.json`: the new `version`, `recipeVersion`, and `recipeFingerprint`, a new `tag` (`ffmpeg-engine-<version>-r<recipe>`), `archiveName`, and `url`. Remove `archiveRoot`, and set `sha256` to `"placeholder"`. `node --test scripts/ffmpeg/target.node-test.mjs` prints the new fingerprint when it fails: put it in that test too.
3. **Follow the version through.** For a new FFmpeg version, update the tests that name the old one (`git grep -n "8\.1\.3" -- scripts src src-tauri/src`) and the component versions in `THIRD_PARTY_NOTICES.md` and `src/config/legal.ts`.
4. **Compile it locally and prove it**, full corpus included. The locally compiled engine stays installed until the recipe changes again, so `pnpm check` and `pnpm tauri dev` use it while the checksum is still the placeholder.

   ```sh
   brew install autoconf automake libtool cmake meson ninja pkgconf nasm
   pnpm ffmpeg:prepare -- --build
   pnpm check
   VIDRA_CORPUS_MATRIX=full pnpm test:corpus
   ```

5. **Publish the archive.** Push the branch and run the "FFmpeg engine" workflow on it. It refuses a tag that already has an archive, compiles the recipe on a GitHub runner, checks the result, and uploads the archive with its `.sha256` file to that tag.
6. **Pin it.** Replace the placeholder with the published SHA-256. CI now installs the new archive and goes green.

That checksum is what everything else trusts. When `sha256` changes in a pull request, check that it is the value in the `.sha256` file of the release the workflow created from that pull request's commit. The archive pinned today, `ffmpeg-dev-8.1.3-r6`, was built by this workflow's predecessor from the same recipe.

A source download retries transport errors, and the Opus source has a mirror. Every location must match the same pinned SHA-256.

## One-time setup

**Apple.** Direct distribution needs an Apple Developer Program membership and a Developer ID Application certificate. The Release workflow reads these GitHub Actions secrets:

- `APPLE_CERTIFICATE`: the certificate exported as a base64-encoded PKCS #12 file;
- `APPLE_CERTIFICATE_PASSWORD`: the export password;
- `APPLE_SIGNING_IDENTITY`: the full Developer ID Application identity;
- `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password), and `APPLE_TEAM_ID`, for notarization.

The workflow downloads Apple's Developer ID G2 intermediate certificate and checks its pinned SHA-256 before importing it. Change that checksum only after confirming the new certificate on Apple's PKI page.

**Update signing.** Every update is verified with a dedicated key. Its public half is in `src-tauri/tauri.conf.json`. The workflow reads:

- `TAURI_SIGNING_PRIVATE_KEY`: the private key file made by `pnpm tauri signer generate`;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password.

GitHub does not show a stored secret again, so keep an encrypted recovery copy outside the repository. Losing the key means no installed copy can ever accept another update. Do not replace the public key directly: a key change needs one release, signed with the current key, that ships trust in the new one.

**GitHub.**

- Store all of the secrets above in an environment named `release` that requires a maintainer's approval and accepts only `v*` tags.
- Protect `main`: pull requests required, branch up to date, and the three CI job names above as required checks.
