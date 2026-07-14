import { useEffect, useState, type FormEvent } from "react";
import { audioModeLabel, videoCodecLabel } from "../../config/encoding";
import type { EncodingProfile } from "../../config/profiles";
import { qualityLevel } from "../../config/quality";
import { outputResolutionLabel } from "../../config/resolution";
import type { FfmpegStatus } from "../../types/media";

type SettingsViewProps = {
  status: FfmpegStatus | null;
  isReady: boolean;
  profiles: EncodingProfile[];
  onDuplicateProfile: (profileId: string) => void;
  onRenameProfile: (profileId: string, name: string) => void;
  onDeleteProfile: (profileId: string) => void;
};

export function SettingsView({
  status,
  isReady,
  profiles,
  onDuplicateProfile,
  onRenameProfile,
  onDeleteProfile,
}: SettingsViewProps) {
  const builtInProfiles = profiles.filter((profile) => profile.isBuiltIn);
  const userProfiles = profiles.filter((profile) => !profile.isBuiltIn);

  return (
    <div className="settings-view">
      <div className="settings-scroll">
        <section className="settings-section">
          <div className="settings-section-heading">
            <div><strong>Encoding profiles</strong><p>Reusable conversion settings stored on this Mac.</p></div>
            <span>{userProfiles.length} personal</span>
          </div>

          <div className="settings-profile-group">
            <span className="settings-group-label">BUILT-IN · READ ONLY</span>
            <div className="settings-card profile-settings-card">
              {builtInProfiles.map((profile) => (
                <SettingsProfileRow
                  key={profile.id}
                  profile={profile}
                  onDuplicate={() => onDuplicateProfile(profile.id)}
                />
              ))}
            </div>
          </div>

          <div className="settings-profile-group">
            <span className="settings-group-label">MY PROFILES</span>
            <div className="settings-card profile-settings-card">
              {userProfiles.length > 0 ? userProfiles.map((profile) => (
                <SettingsProfileRow
                  key={profile.id}
                  profile={profile}
                  onDuplicate={() => onDuplicateProfile(profile.id)}
                  onRename={(name) => onRenameProfile(profile.id, name)}
                  onDelete={() => onDeleteProfile(profile.id)}
                />
              )) : (
                <div className="settings-empty-profiles">
                  Personal profiles created in Convert will appear here.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <div><strong>Application</strong><p>Local engine and default behavior.</p></div>
          </div>
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
        </section>
        <p className="license-copy">
          Vidra is open source under GPL-3.0-or-later. All processing happens on your device.
        </p>
      </div>
    </div>
  );
}

function SettingsProfileRow({
  profile,
  onDuplicate,
  onRename,
  onDelete,
}: {
  profile: EncodingProfile;
  onDuplicate: () => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
}) {
  const [editor, setEditor] = useState<"rename" | "delete" | null>(null);
  const [name, setName] = useState(profile.name);

  useEffect(() => {
    setEditor(null);
    setName(profile.name);
  }, [profile.id, profile.name]);

  function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onRename?.(name);
    setEditor(null);
  }

  return (
    <div className="settings-profile-row">
      <div className="settings-profile-details">
        <div>
          <strong>{profile.name}</strong>
          <span className={`profile-kind ${profile.isBuiltIn ? "built-in" : "personal"}`}>
            {profile.isBuiltIn ? "Built-in · Read only" : "Personal"}
          </span>
        </div>
        <p>{profileSummary(profile)}</p>
      </div>

      <div className="settings-profile-actions">
        <button type="button" onClick={onDuplicate}>Duplicate</button>
        {!profile.isBuiltIn && (
          <>
            <button type="button" onClick={() => {
              setName(profile.name);
              setEditor("rename");
            }}>Rename</button>
            <button className="danger" type="button" onClick={() => setEditor("delete")}>Delete</button>
          </>
        )}
      </div>

      {editor === "rename" && (
        <form className="settings-profile-editor" onSubmit={submitRename}>
          <input
            autoFocus
            aria-label="Profile name"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="confirm" type="submit" disabled={!name.trim()}>Rename</button>
          <button type="button" onClick={() => setEditor(null)}>Cancel</button>
        </form>
      )}

      {editor === "delete" && (
        <div className="settings-profile-editor delete" role="alert">
          <span>Delete “{profile.name}”? Conversions and media will not be affected.</span>
          <button className="danger" type="button" onClick={() => onDelete?.()}>Delete profile</button>
          <button type="button" onClick={() => setEditor(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function profileSummary(profile: EncodingProfile): string {
  const settings = profile.settings;
  return [
    profile.isAdvanced ? "Advanced" : "Simple",
    settings.container.toUpperCase(),
    videoCodecLabel(settings.videoCodec),
    qualityLevel(settings.quality).label,
    outputResolutionLabel(settings.outputResolution),
    `${audioModeLabel(settings.audioMode)} audio`,
  ].join(" · ");
}
