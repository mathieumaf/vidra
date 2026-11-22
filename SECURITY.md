# Security policy

## Supported versions

Security fixes are provided for the latest official release. The app offers that release as an update once the update feed announces it.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue for a vulnerability that could put users or their media at risk.

Include the affected version, macOS version and hardware, reproduction steps, expected impact, and any suggested mitigation. Never include private media, credentials, signing material, or other sensitive data.

## What Vidra is built to guarantee

The [threat model](docs/security/threat-model.md) describes the system, its untrusted inputs, its trust boundaries, and the known limits of each mechanism below. A change that breaks one of these is a security bug.

1. **A source file is never modified or deleted.** The engine opens sources for reading. An output path that names a source, or a hard link to one, is refused.
2. **A destination file is replaced only on purpose.** The save panel asks the user, and the interface then sets a replace flag when the chosen name is already in the folder. The core replaces a file only with that flag, only after a successful conversion, and only if the file at that path is still the one that was there when the job was queued. Otherwise the finished video is saved under another name.
3. **A finished video is not discarded because its name is taken.** It is saved under the next free numbered name, or kept under a recovery name or at its temporary name.
4. **Conversion writes only Vidra's own files:** the temporary output in the destination folder, the published output, and work files in a folder Vidra creates under the system temporary folder. Cleanup removes only files and folders Vidra created or recorded as its own.
5. **Media stays on the device.** The only network requests are the update check at the fixed endpoint in `src-tauri/tauri.conf.json`, the download of the archive that the update feed names, and the two kinds of GitHub link the user can open from Settings.
6. **The interface is not trusted.** Every source and output path is validated in Rust. Text from the user or from a media file reaches FFmpeg only as an argument value or a file, never as an option or a shell string. The interface has no shell, filesystem, or HTTP plugin permission: it reaches files only through Vidra's own commands.
7. **An update is offered only for a newer official version, and installed only with a valid signature** for the public key in `src-tauri/tauri.conf.json`. The signature must have been made for the version the update announces. Nothing is installed while a conversion is queued, running, or paused.
8. **The bundled FFmpeg comes from pinned sources.** The sources and the engine archive are checked against a pinned SHA-256 when they are downloaded. Development, CI, and the release install that same archive. A system FFmpeg is never used.
9. **The repository holds no signing secret.** The release workflow reads the signing key and the Apple credentials from GitHub Actions secrets.

## What to report

- A media file, file name, or metadata value that makes Vidra modify, delete, or overwrite a file it should not, write outside the locations listed above, or run code in the interface or the core.
- A Tauri command that uses a path or value without validating it, or a capability wider than the interface needs.
- An update that installs without a valid signature, an older version or a prerelease that is offered, or an update that installs while a conversion runs.
- A network request other than those listed above, or media, file paths, or metadata leaving the device.
- A diagnostic report that Vidra builds with a source or output path in it, or a way to make the save command overwrite an existing file.
- A change to the release or FFmpeg pipeline that ships an unpinned or unverified binary, or exposes a signing secret.
- A way around one of the known limits in the threat model that makes it worse than described there.

## Severity

| Severity | Examples |
| --- | --- |
| Critical | Loss or corruption of a source file. Code execution in the core from a crafted file or from the interface. An unsigned or tampered update installed. A signing secret exposed. |
| High | An unconfirmed overwrite or deletion in a destination folder. A write outside Vidra's own files. Media or paths sent over the network. |
| Medium | Leftover temporary files with user content. A path in a diagnostic report built by Vidra. An update offered that should not be, while signature checks still hold. |
| Low | Denial of service from a crafted file that only stops the current conversion. Information shown only to the local user. |

## Outside this policy

- **Bugs inside FFmpeg or its codec libraries.** Report them upstream. Vidra's part is to ship a fixed version: report a bundled version that is known to be vulnerable when a fixed release exists.
- **An attacker who already runs code as the user and attacks the application, its bundle, or its data files directly.** Interference with files in a destination folder while a job waits or runs is in scope.
- **The known limits listed in the threat model**, as described there: confirmation inferred by the interface, the check-then-rename windows when publishing an output, the temporary output addressed by path, recovery by recorded path, and a kept video that depends on the ledger.
- **Builds that Vidra did not publish.** Only the signed and notarized artifacts on the GitHub Releases page are covered.
