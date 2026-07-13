# Third-party notices

## FFmpeg

Vidra uses FFmpeg and FFprobe for media inspection and conversion.

FFmpeg is licensed under the GNU Lesser General Public License 2.1 or later by default. Builds that include optional GPL components, including libx264 and libx265, are covered by the applicable GNU General Public License terms. Vidra is licensed under GPL-3.0-or-later to support GPL-enabled FFmpeg builds.

The macOS Apple Silicon binaries prepared by the current development script are development-only artifacts from [OSXExperts](https://www.osxexperts.net/). They are not committed to this repository and must not be used for a public Vidra release.

Before distributing Vidra, the release pipeline must provide:

- reproducible FFmpeg and FFprobe builds from pinned source;
- the exact source archives and patches used for each binary;
- the complete build configuration;
- license notices for FFmpeg and every linked library;
- checksums for all distributed artifacts.

See [FFmpeg's legal and license documentation](https://ffmpeg.org/legal.html).

## Lucide

Vidra uses icons from [Lucide](https://lucide.dev/) through the `lucide-react` package.
Lucide is licensed under the ISC License.
