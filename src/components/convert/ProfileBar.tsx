import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
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
  const selectRef = useRef<HTMLSelectElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<"opener" | "select" | null>(null);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const builtInProfiles = profiles.filter((profile) => profile.isBuiltIn);
  const userProfiles = profiles.filter((profile) => !profile.isBuiltIn);

  useEffect(() => {
    setEditor(null);
    setNameError(null);
    setConfirmingDelete(false);
  }, [selectedProfileId]);

  // Closing the editor or the delete confirmation unmounts the focused control.
  // Put focus back on the control that opened it, or on the profile menu after a change.
  useEffect(() => {
    if (editor || confirmingDelete || !pendingFocus.current) return;
    const target = pendingFocus.current === "opener" && opener.current?.isConnected
      ? opener.current
      : selectRef.current;
    pendingFocus.current = null;
    target?.focus();
  });

  function beginEditor(nextEditor: "create" | "rename", event: MouseEvent<HTMLElement>) {
    opener.current = event.currentTarget;
    setEditor(nextEditor);
    setName(nextEditor === "rename" ? selectedProfile?.name ?? "" : "");
    setNameError(null);
    setConfirmingDelete(false);
  }

  function closeEditor() {
    pendingFocus.current = "opener";
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
    pendingFocus.current = "select";
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
              ref={selectRef}
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
              <button type="button" disabled={disabled} onClick={(event) => beginEditor("create", event)}>Save as new</button>
              <button type="button" disabled={disabled} onClick={(event) => beginEditor("rename", event)}>Rename</button>
              <button
                className="profile-delete-button"
                type="button"
                disabled={disabled}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setEditor(null);
                  setConfirmingDelete(true);
                }}
              >Delete</button>
            </>
          ) : (
            <button type="button" disabled={disabled} onClick={(event) => beginEditor("create", event)}>{selectedProfile?.isBuiltIn ? "Save a copy" : "Save as profile"}</button>
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
              onChange={(event) => {
                setName(event.target.value);
                if (event.target.value.trim()) setNameError(null);
              }}
            />
            {nameError && <p className="field-error" id={nameErrorId} role="alert">{nameError}</p>}
          </label>
          <button className="profile-confirm-button" type="submit">
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
              pendingFocus.current = "select";
              setConfirmingDelete(false);
            }}
          >Delete profile</button>
          {/* Start on Cancel so Escape works at once and Enter does not delete by accident. */}
          <button autoFocus type="button" onClick={closeEditor}>Cancel</button>
        </div>
      )}
    </section>
  );
}
