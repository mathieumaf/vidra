import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import type { EncodingProfile } from "../../config/profiles";
import { localComputerPhrase } from "../../lib/platform";

type ProfileBarProps = {
  profiles: EncodingProfile[];
  selectedProfileId: string | null;
  isModified: boolean;
  readyItemCount: number;
  disabled: boolean;
  onSelect: (profileId: string | null) => void;
  onCreate: (name: string) => void;
  onUpdate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onApplyToAll: () => void;
};

export function ProfileBar({
  profiles,
  selectedProfileId,
  isModified,
  readyItemCount,
  disabled,
  onSelect,
  onCreate,
  onUpdate,
  onRename,
  onDelete,
  onApplyToAll,
}: ProfileBarProps) {
  const [editor, setEditor] = useState<"create" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const nameErrorId = useId();
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const builtInProfiles = profiles.filter((profile) => profile.isBuiltIn);
  const userProfiles = profiles.filter((profile) => !profile.isBuiltIn);

  useEffect(() => {
    setEditor(null);
    setNameError(null);
    setConfirmingDelete(false);
  }, [selectedProfileId]);

  function beginEditor(nextEditor: "create" | "rename") {
    setEditor(nextEditor);
    setName(nextEditor === "rename" ? selectedProfile?.name ?? "" : "");
    setNameError(null);
    setConfirmingDelete(false);
  }

  function closeEditor() {
    setEditor(null);
    setNameError(null);
    setConfirmingDelete(false);
  }

  function submitName(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setNameError("Enter a profile name.");
      return;
    }
    if (editor === "rename") onRename(name);
    else onCreate(name);
    setEditor(null);
    setNameError(null);
  }

  function onEditorKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeEditor();
  }

  return (
    <section className="profile-bar">
      <div className="profile-main-row">
        <div className="profile-heading">
          <span className="section-label">PROFILE</span>
          <div>
            <select
              aria-label="Encoding profile"
              value={selectedProfile?.id ?? "custom"}
              disabled={disabled}
              onChange={(event) => onSelect(event.target.value === "custom" ? null : event.target.value)}
            >
              <option value="custom">Custom settings</option>
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
            <p>
              {selectedProfile?.description
                ?? (selectedProfile
                  ? `Personal profile stored on ${localComputerPhrase()}`
                  : "Current conversion settings")}
              {selectedProfile?.isBuiltIn && <span className="profile-read-only"> · Built-in · Read only</span>}
              {selectedProfile && isModified && <strong> · Modified</strong>}
            </p>
          </div>
        </div>

        <div className="profile-actions">
          {readyItemCount > 1 && (
            <button
              className="profile-apply-all-button"
              type="button"
              disabled={disabled}
              title={`Apply these settings to ${readyItemCount} ready videos`}
              onClick={onApplyToAll}
            >Apply to all</button>
          )}
          {selectedProfile && !selectedProfile.isBuiltIn ? (
            <>
              <button type="button" disabled={disabled || !isModified} onClick={onUpdate}>Update</button>
              <button type="button" disabled={disabled} onClick={() => beginEditor("create")}>Save as new</button>
              <button type="button" disabled={disabled} onClick={() => beginEditor("rename")}>Rename</button>
              <button
                className="profile-delete-button"
                type="button"
                disabled={disabled}
                onClick={() => {
                  setEditor(null);
                  setConfirmingDelete(true);
                }}
              >Delete</button>
            </>
          ) : (
            <button type="button" disabled={disabled} onClick={() => beginEditor("create")}>{selectedProfile?.isBuiltIn ? "Save a copy" : "Save as profile"}</button>
          )}
        </div>
      </div>

      {editor && (
        <form className="profile-editor" onSubmit={submitName} onKeyDown={onEditorKeyDown}>
          <label>
            <span>{editor === "rename" ? "Profile name" : "New profile name"}</span>
            <input
              autoFocus
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? nameErrorId : undefined}
              aria-required="true"
              maxLength={60}
              value={name}
              placeholder="My profile"
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
          <button className="profile-confirm-button" type="submit" disabled={!name.trim()}>
            {editor === "rename" ? "Rename" : "Save profile"}
          </button>
          <button type="button" onClick={closeEditor}>Cancel</button>
        </form>
      )}

      {confirmingDelete && selectedProfile && (
        <div className="profile-delete-confirmation" role="alert" onKeyDown={onEditorKeyDown}>
          <span>Delete “{selectedProfile.name}”? Conversions and media will not be affected.</span>
          <button
            className="profile-delete-button"
            type="button"
            onClick={() => {
              onDelete();
              setConfirmingDelete(false);
            }}
          >Delete profile</button>
          <button type="button" onClick={() => setConfirmingDelete(false)}>Cancel</button>
        </div>
      )}
    </section>
  );
}
