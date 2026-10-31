import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { audioModeLabel, videoCodecLabel } from "../../config/encoding";
import { THIRD_PARTY_NOTICE_GROUPS } from "../../config/legal";
import type { EncodingProfile } from "../../config/profiles";
import { qualityLevel } from "../../config/quality";
import { outputResolutionLabel } from "../../config/resolution";
import type { ApplicationUpdaterState } from "../../hooks/useApplicationUpdater";
import { localComputerPhrase } from "../../lib/platform";
import type { ThemePreference } from "../../lib/theme";
import type { UpdateChannel } from "../../types/applicationUpdate";
import type { FfmpegStatus } from "../../types/media";
import { useModalDialog } from "../../hooks/useModalDialog";
import { useRadioGroup } from "../../hooks/useRadioGroup";
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
  onUpdateChannelChange: (channel: UpdateChannel) => void;
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
  onUpdateChannelChange,
  onInstallUpdate,
}: SettingsViewProps) {
  const [showNotices, setShowNotices] = useState(false);
  const builtInProfiles = profiles.filter((profile) => profile.isBuiltIn);
  const userProfiles = profiles.filter((profile) => !profile.isBuiltIn);
  const lastUsedProfile = profiles.find((profile) => profile.id === lastUsedProfileId);

  return (
    <div className="settings-view">
      <div className="settings-scroll" inert={showNotices}>
        <section className="settings-section" aria-labelledby="settings-profiles-heading">
          <div className="settings-section-heading">
            <div><strong id="settings-profiles-heading">Encoding profiles</strong><p>Reusable conversion settings stored on {localComputerPhrase()}.</p></div>
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

        <section className="settings-section" aria-labelledby="settings-application-heading">
          <div className="settings-section-heading">
            <div><strong id="settings-application-heading">Application</strong><p>Local engine and default behavior.</p></div>
          </div>
          <section className="settings-card">
            <div className="settings-row settings-appearance-row">
              <div>
                <strong>Appearance</strong>
                <p>Auto follows your system appearance as it changes.</p>
              </div>
              <AppearanceSwitch
                preference={themePreference}
                onChange={onThemePreferenceChange}
              />
            </div>
            <div className="settings-row">
              <div>
                <strong>Encoding engine</strong>
                <p>{!isReady && status?.error ? status.error : "Bundled locally with Vidra"}</p>
              </div>
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
            <div className="settings-row settings-channel-row">
              <div>
                <strong>Update channel</strong>
                <p>{updaterState.channel === "stable"
                  ? "Official releases only. Recommended for everyday use."
                  : "Official releases, betas, and release candidates. Test builds may have issues."}</p>
                {updaterState.channel === "stable" && releaseTag?.includes("-") && (
                  <p>Your test build will stay installed until a newer stable release is available.</p>
                )}
              </div>
              <select
                aria-label="Update channel"
                value={updaterState.channel}
                disabled={updaterState.phase === "installing"}
                onChange={(event) => onUpdateChannelChange(event.target.value as UpdateChannel)}
              >
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
              </select>
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

        <section className="settings-section" aria-labelledby="settings-about-heading">
          <div className="settings-section-heading">
            <div><strong id="settings-about-heading">About Vidra</strong><p>Open-source software and bundled components.</p></div>
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
  if (state.phase === "checking") return `Checking the ${state.channel === "stable" ? "Stable" : "Beta"} channel…`;
  if (state.phase === "installing") return "Downloading, verifying, and installing the update…";
  if (state.error) return state.error;
  if (state.phase === "available" && state.update) {
    if (isBlocked) {
      return `Version ${state.update.version} is available. Finish or cancel every queued conversion before installing it.`;
    }
    return `Version ${state.update.version} is available and ready to install.`;
  }
  if (state.phase === "up-to-date") {
    return `No newer release is available on the ${state.channel === "stable" ? "Stable" : "Beta"} channel.`;
  }
  return "Signed releases are checked automatically when Vidra starts.";
}

function AppearanceSwitch({
  preference,
  onChange,
}: {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
}) {
  const options = (["auto", "light", "dark"] as const).map((id) => ({ id }));
  const radio = useRadioGroup(options, preference, onChange);
  return (
    <div
      className="theme-switch"
      role="radiogroup"
      aria-label="Appearance"
      onKeyDown={radio.onKeyDown}
    >
      {options.map((option) => (
        <button
          key={option.id}
          className={preference === option.id ? "active" : ""}
          type="button"
          {...radio.optionProps(option.id)}
          onClick={() => onChange(option.id)}
        >
          {option.id[0].toUpperCase() + option.id.slice(1)}
        </button>
      ))}
    </div>
  );
}

function ThirdPartyNotices({ onClose }: { onClose: () => void }) {
  const dialogRef = useModalDialog(onClose);

  return (
    <div className="notices-overlay">
      <section
        aria-describedby="third-party-notices-description"
        aria-labelledby="third-party-notices-title"
        aria-modal="true"
        className="notices-panel"
        ref={dialogRef}
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

        <div className="notices-content" tabIndex={0} role="region" aria-labelledby="third-party-notices-title">
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
  const [nameError, setNameError] = useState<string | null>(null);
  const nameErrorId = useId();

  useEffect(() => {
    setEditor(null);
    setName(profile.name);
    setNameError(null);
  }, [profile.id, profile.name]);

  function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setNameError("Enter a profile name.");
      return;
    }
    onRename?.(name);
    setEditor(null);
  }

  function closeEditor(event?: KeyboardEvent) {
    if (event && event.key !== "Escape") return;
    event?.preventDefault();
    setEditor(null);
    setNameError(null);
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
              setNameError(null);
              setEditor("rename");
            }}>Rename</button>
            <button className="danger" type="button" onClick={() => setEditor("delete")}>Delete</button>
          </>
        )}
      </div>

      {editor === "rename" && (
        <form className="settings-profile-editor" onSubmit={submitRename} onKeyDown={closeEditor}>
          <label className="settings-name-field">
            <input
              autoFocus
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? nameErrorId : undefined}
              aria-label="Profile name"
              aria-required="true"
              maxLength={60}
              value={name}
              onBlur={() => {
                if (!name.trim()) setNameError("Enter a profile name.");
              }}
              onChange={(event) => {
                setName(event.target.value);
                if (event.target.value.trim()) setNameError(null);
              }}
            />
            {nameError && <p className="field-error" id={nameErrorId} role="alert">{nameError}</p>}
          </label>
          <button className="confirm" type="submit" disabled={!name.trim()}>Rename</button>
          <button type="button" onClick={() => closeEditor()}>Cancel</button>
        </form>
      )}

      {editor === "delete" && (
        <div className="settings-profile-editor delete" role="alert" onKeyDown={closeEditor}>
          <span>Delete “{profile.name}”? Conversions and media will not be affected.</span>
          <button className="danger" type="button" onClick={() => onDelete?.()}>Delete profile</button>
          <button type="button" onClick={() => closeEditor()}>Cancel</button>
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
