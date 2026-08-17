import { useEffect, useState, type FormEvent } from "react";
import { audioModeLabel, videoCodecLabel } from "../../config/encoding";
import { THIRD_PARTY_NOTICE_GROUPS } from "../../config/legal";
import type { EncodingProfile } from "../../config/profiles";
import { qualityLevel } from "../../config/quality";
import { outputResolutionLabel } from "../../config/resolution";
import type { ApplicationUpdaterState } from "../../hooks/useApplicationUpdater";
import type { ThemePreference } from "../../lib/theme";
import type { FfmpegStatus } from "../../types/media";
import { Icon } from "../ui/Icon";

type SettingsViewProps = {
  status: FfmpegStatus | null;
  isReady: boolean;
  appVersion: string | null;
  releaseTag: string | null;
  applicationError: string | null;
  updaterState: ApplicationUpdaterState;
  isUpdateBlocked: boolean;
  profiles: EncodingProfile[];
  defaultProfileId: string | null;
  lastUsedProfileId: string;
  themePreference: ThemePreference;
  onDuplicateProfile: (profileId: string) => void;
  onRenameProfile: (profileId: string, name: string) => void;
  onDeleteProfile: (profileId: string) => void;
  onDefaultProfileChange: (profileId: string | null) => void;
  onThemePreferenceChange: (preference: ThemePreference) => void;
  onOpenSource: () => void;
  onOpenRelease: () => void;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
};

export function SettingsView({
  status,
  isReady,
  appVersion,
  releaseTag,
  applicationError,
  updaterState,
  isUpdateBlocked,
  profiles,
  defaultProfileId,
  lastUsedProfileId,
  themePreference,
  onDuplicateProfile,
  onRenameProfile,
  onDeleteProfile,
  onDefaultProfileChange,
  onThemePreferenceChange,
  onOpenSource,
  onOpenRelease,
  onCheckForUpdates,
  onInstallUpdate,
}: SettingsViewProps) {
  const [showNotices, setShowNotices] = useState(false);
  const builtInProfiles = profiles.filter((profile) => profile.isBuiltIn);
  const userProfiles = profiles.filter((profile) => !profile.isBuiltIn);
  const lastUsedProfile = profiles.find((profile) => profile.id === lastUsedProfileId);

  return (
    <div className="settings-view">
      <div className="settings-scroll" inert={showNotices}>
        <section className="settings-section">
          <div className="settings-section-heading">
            <div><strong>Encoding profiles</strong><p>Reusable conversion settings stored on this Mac.</p></div>
            <span>{userProfiles.length} personal</span>
          </div>

          <div className="settings-default-profile">
            <div>
              <strong>Default for new conversions</strong>
              <p>{defaultProfileId === null
                ? `Uses the last selected profile${lastUsedProfile ? `: ${lastUsedProfile.name}` : ""}.`
                : "Applied automatically when starting a new conversion."}</p>
            </div>
            <select
              aria-label="Default encoding profile"
              value={defaultProfileId ?? "last-used"}
              onChange={(event) => onDefaultProfileChange(
                event.target.value === "last-used" ? null : event.target.value,
              )}
            >
              <option value="last-used">Last used profile</option>
              <optgroup label="Built-in">
                {builtInProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </optgroup>
              {userProfiles.length > 0 && (
                <optgroup label="My profiles">
                  {userProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="settings-profile-group">
            <span className="settings-group-label">BUILT-IN · READ ONLY</span>
            <div className="settings-card profile-settings-card">
              {builtInProfiles.map((profile) => (
                <SettingsProfileRow
                  key={profile.id}
                  profile={profile}
                  isDefault={defaultProfileId === profile.id}
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
                  isDefault={defaultProfileId === profile.id}
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
            <div className="settings-row settings-appearance-row">
              <div>
                <strong>Appearance</strong>
                <p>Auto follows your system appearance as it changes.</p>
              </div>
              <div className="theme-switch" role="group" aria-label="Appearance">
                {(["auto", "light", "dark"] as const).map((preference) => (
                  <button
                    key={preference}
                    className={themePreference === preference ? "active" : ""}
                    type="button"
                    aria-pressed={themePreference === preference}
                    onClick={() => onThemePreferenceChange(preference)}
                  >
                    {preference[0].toUpperCase() + preference.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <div><strong>Encoding engine</strong><p>Bundled locally with Vidra</p></div>
              <span className={`settings-value ${isReady ? "positive" : ""}`}>
                {isReady ? "Ready" : "Unavailable"}
              </span>
            </div>
            <div className="settings-row">
              <div><strong>Vidra</strong><p>Application version</p></div>
              <span className="settings-value version-value">
                {appVersion ?? "Version unavailable"}
              </span>
            </div>
            <div className="settings-row settings-update-row">
              <div>
                <strong>Application updates</strong>
                <p>{updateDescription(updaterState, isUpdateBlocked)}</p>
                {updaterState.update?.notes && updaterState.phase === "available" && (
                  <p className="settings-update-notes">{updaterState.update.notes}</p>
                )}
              </div>
              <UpdateAction
                state={updaterState}
                isBlocked={isUpdateBlocked}
                onCheck={onCheckForUpdates}
                onInstall={onInstallUpdate}
              />
            </div>
            <div className="settings-row">
              <div><strong>FFmpeg</strong><p>Bundled encoding engine</p></div>
              <span className="settings-value version-text">
                {status?.ffmpegVersion ?? "Version unavailable"}
              </span>
            </div>
            <div className="settings-row">
              <div><strong>Default output</strong><p>MP4 · H.264 video · original resolution · automatic audio</p></div>
              <span className="settings-value">Content adaptive</span>
            </div>
          </section>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <div><strong>About Vidra</strong><p>Open-source software and bundled components.</p></div>
          </div>
          <section className="settings-card">
            <div className="settings-row about-row">
              <div>
                <strong>GPL-3.0-or-later</strong>
                <p>Vidra is open source. All processing happens on your device.</p>
              </div>
              <div className="settings-link-actions">
                <button type="button" onClick={onOpenSource}>
                  Source code <Icon name="external" />
                </button>
                <button type="button" disabled={!releaseTag} onClick={onOpenRelease}>
                  {releaseTag ? `Release ${releaseTag}` : "Release"} <Icon name="external" />
                </button>
              </div>
            </div>
            <div className="settings-row about-row">
              <div>
                <strong>Third-party notices</strong>
                <p>Licenses for FFmpeg, codecs, and application libraries bundled with Vidra.</p>
              </div>
              <button className="settings-notices-button" type="button" onClick={() => setShowNotices(true)}>
                View notices
              </button>
            </div>
          </section>
          {applicationError && <p className="settings-application-error" role="status">{applicationError}</p>}
        </section>
      </div>

      {showNotices && <ThirdPartyNotices onClose={() => setShowNotices(false)} />}
    </div>
  );
}

function UpdateAction({
  state,
  isBlocked,
  onCheck,
  onInstall,
}: {
  state: ApplicationUpdaterState;
  isBlocked: boolean;
  onCheck: () => void;
  onInstall: () => void;
}) {
  if (state.phase === "checking") {
    return <button className="settings-update-button" disabled type="button">Checking…</button>;
  }
  if (state.phase === "installing") {
    return <button className="settings-update-button" disabled type="button">Installing…</button>;
  }
  if (state.phase === "available") {
    return (
      <button
        className="settings-update-button primary"
        disabled={isBlocked}
        type="button"
        onClick={onInstall}
      >
        Install and restart
      </button>
    );
  }
  if (state.phase === "error" && state.update) {
    return (
      <button
        className="settings-update-button primary"
        disabled={isBlocked}
        type="button"
        onClick={onInstall}
      >
        Try installation again
      </button>
    );
  }
  return (
    <button className="settings-update-button" type="button" onClick={onCheck}>
      Check for updates
    </button>
  );
}

function updateDescription(state: ApplicationUpdaterState, isBlocked: boolean): string {
  if (state.phase === "checking") return "Looking for a newer signed release…";
  if (state.phase === "installing") return "Downloading, verifying, and installing the update…";
  if (state.error) return state.error;
  if (state.phase === "available" && state.update) {
    if (isBlocked) {
      return `Version ${state.update.version} is available. Finish or cancel every queued conversion before installing it.`;
    }
    return `Version ${state.update.version} is available and ready to install.`;
  }
  if (state.phase === "up-to-date") return "Vidra is up to date.";
  return "Signed releases are checked automatically when Vidra starts.";
}

function ThirdPartyNotices({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="notices-overlay">
      <section
        aria-describedby="third-party-notices-description"
        aria-labelledby="third-party-notices-title"
        aria-modal="true"
        className="notices-panel"
        role="dialog"
      >
        <header className="notices-heading">
          <div>
            <strong id="third-party-notices-title">Third-party notices</strong>
            <p id="third-party-notices-description">
              Principal components distributed with Vidra and their licenses.
            </p>
          </div>
          <button autoFocus aria-label="Close third-party notices" type="button" onClick={onClose}>
            <Icon name="remove" />
          </button>
        </header>

        <div className="notices-content">
          {THIRD_PARTY_NOTICE_GROUPS.map((group) => (
            <section className="notices-group" key={group.title}>
              <span>{group.title}</span>
              <div>
                {group.notices.map((notice) => (
                  <div className="notice-row" key={notice.name}>
                    <div><strong>{notice.name}</strong><p>{notice.detail}</p></div>
                    <span>{notice.license}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <p className="notices-footer">
            Exact dependency versions are recorded in the Vidra source tree. Corresponding FFmpeg
            sources, checksums, and build configuration are attached to each public release.
          </p>
        </div>
      </section>
    </div>
  );
}

function SettingsProfileRow({
  profile,
  isDefault,
  onDuplicate,
  onRename,
  onDelete,
}: {
  profile: EncodingProfile;
  isDefault: boolean;
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
          {isDefault && <span className="profile-kind default">Default</span>}
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
