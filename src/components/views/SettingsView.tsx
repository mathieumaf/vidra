import type { FfmpegStatus } from "../../types/media";

export function SettingsView({ status, isReady }: { status: FfmpegStatus | null; isReady: boolean }) {
  return (
    <div className="settings-view">
      <section className="settings-card">
        <div className="settings-row">
          <div><strong>Encoding engine</strong><p>Bundled locally with Vidra</p></div>
          <span className={`settings-value ${isReady ? "positive" : ""}`}>
            {isReady ? "Ready" : "Unavailable"}
          </span>
        </div>
        <div className="settings-row">
          <div><strong>FFmpeg</strong><p className="version-text">{status?.ffmpegVersion ?? "Version unavailable"}</p></div>
        </div>
        <div className="settings-row">
          <div><strong>Default output</strong><p>MP4 · H.264 video · original resolution · automatic audio</p></div>
          <span className="settings-value">Content adaptive</span>
        </div>
      </section>
      <p className="license-copy">
        Vidra is open source under GPL-3.0-or-later. All processing happens on your device.
      </p>
    </div>
  );
}
