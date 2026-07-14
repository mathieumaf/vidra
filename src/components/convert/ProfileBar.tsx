import { useEffect, useState, type FormEvent } from "react";
import type { EncodingProfile } from "../../config/profiles";

type ProfileBarProps = {
  profiles: EncodingProfile[];
  selectedProfileId: string | null;
  isModified: boolean;
  disabled: boolean;
  onSelect: (profileId: string | null) => void;
  onCreate: (name: string) => void;
  onUpdate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
};

export function ProfileBar({
  profiles,
  selectedProfileId,
  isModified,
  disabled,
  onSelect,
  onCreate,
  onUpdate,
  onRename,
  onDelete,
}: ProfileBarProps) {
  const [editor, setEditor] = useState<"create" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const builtInProfiles = profiles.filter((profile) => profile.isBuiltIn);
  const userProfiles = profiles.filter((profile) => !profile.isBuiltIn);

  useEffect(() => {
    setEditor(null);
    setConfirmingDelete(false);
  }, [selectedProfileId]);

  function beginEditor(nextEditor: "create" | "rename") {
    setEditor(nextEditor);
    setName(nextEditor === "rename" ? selectedProfile?.name ?? "" : "");
    setConfirmingDelete(false);
  }

  function submitName(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    if (editor === "rename") onRename(name);
    else onCreate(name);
    setEditor(null);
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
                ?? (selectedProfile ? "Personal profile stored on this Mac" : "Current conversion settings")}
              {selectedProfile?.isBuiltIn && <span className="profile-read-only"> · Built-in · Read only</span>}
              {selectedProfile && isModified && <strong> · Modified</strong>}
            </p>
          </div>
        </div>

        <div className="profile-actions">
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
        <form className="profile-editor" onSubmit={submitName}>
          <label>
            <span>{editor === "rename" ? "Profile name" : "New profile name"}</span>
            <input
              autoFocus
              maxLength={60}
              value={name}
              placeholder="My profile"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button className="profile-confirm-button" type="submit" disabled={!name.trim()}>
            {editor === "rename" ? "Rename" : "Save profile"}
          </button>
          <button type="button" onClick={() => setEditor(null)}>Cancel</button>
        </form>
      )}

      {confirmingDelete && selectedProfile && (
        <div className="profile-delete-confirmation" role="alert">
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
