# Security policy

## Supported versions

Security fixes are provided for the latest official release. Vidra offers that release as an in-app update.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue for a vulnerability that could put users or their media at risk.

Include the affected version, macOS version and hardware, reproduction steps, expected impact, and any suggested mitigation. Never include private media, credentials, signing material, or other sensitive data.

## What Vidra guarantees

The [threat model](docs/security/threat-model.md) describes the system, its untrusted inputs, and its trust boundaries. These invariants follow from it. A change that breaks one is a security bug.

1. **A source file is never modified or deleted.** Vidra opens sources for reading only. An output can never be a source, or a hard link to one.
2. **A destination file is replaced only on purpose.** Replacement needs the user's confirmation and a successful conversion, and applies only while the file is still the one that was confirmed. Otherwise the output takes a free name.
3. **Vidra writes only its own files.** These are the temporary output in the destination folder, the published output, work files in the system temporary folder, a diagnostic report saved by the user, and the application's data files. Cleanup removes only temporary files Vidra created.
4. **Media stays on the device.** The only network requests are the update check and download from GitHub Releases, and links the user opens.
5. **The interface is not trusted.** Every path and value that reaches a Tauri command is validated in Rust. User text never becomes an FFmpeg option, and the interface has no shell, filesystem, or network permission.
6. **Only a signed, newer, official release is installed.** The update archive must carry a valid signature for the public key in `src-tauri/tauri.conf.json`.
7. **The bundled FFmpeg comes from pinned sources.** Sources and the prepared archive are verified by SHA-256 before use. A system FFmpeg is never used.
8. **Signing secrets stay out of the repository.** They exist only in the protected release environment.

## What to report

- A media file, file name, or metadata value that makes Vidra modify, delete, or overwrite a file it should not, write outside the locations listed above, or run code in the interface or the core.
- A Tauri command that accepts a path or value without validation, or a capability wider than the interface needs.
- An update that installs without a valid signature, installs an older version or a prerelease, or installs while a conversion runs.
- A network request other than those listed above, or media, file paths, or metadata leaving the device.
- A diagnostic report that contains a source or output path, or that can overwrite an existing file.
- A change to the release or FFmpeg pipeline that ships an unpinned or unverified binary, or exposes a signing secret.

## Severity

| Severity | Examples |
| --- | --- |
| Critical | Loss or corruption of a source file. Code execution in the core from a crafted file or from the interface. An unsigned or tampered update installed. A signing secret exposed. |
| High | An unconfirmed overwrite or deletion in a destination folder. A write outside Vidra's own files. Media or paths sent over the network. |
| Medium | Leftover temporary files with user content. A path in a diagnostic report. An update offered that should not be, while signature checks still hold. |
| Low | Denial of service from a crafted file that only stops the current conversion. Information shown only to the local user. |

## Outside this policy

- **Bugs inside FFmpeg or its codec libraries.** Report them upstream. Vidra's part is to ship a fixed version: report a bundled version that is known to be vulnerable when a fixed release exists.
- **An attacker who already runs code as the user**, or who can modify the installed application or its data files.
- **The exclusive-rename fallback.** On volumes that do not support an exclusive rename, Vidra checks that the name is free and then renames. The remaining window is documented in the threat model.
- **Builds that Vidra did not publish.** Only the signed and notarized artifacts on the GitHub Releases page are covered.
