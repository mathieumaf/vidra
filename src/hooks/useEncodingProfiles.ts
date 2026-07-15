import { useEffect, useMemo, useState } from "react";
import {
  BUILT_IN_PROFILES,
  parseStoredProfiles,
  serializeProfiles,
  type EncodingProfile,
  type UserEncodingProfile,
} from "../config/profiles";
import type { EncodingSettings } from "../types/media";

const STORAGE_KEY = "vidra.encoding-profiles.v1";
const PREFERENCES_KEY = "vidra.encoding-profile-preferences.v1";
const FALLBACK_PROFILE_ID = "built-in-balanced";

type ProfilePreferences = {
  defaultProfileId: string | null;
  lastUsedProfileId: string;
};

export function useEncodingProfiles() {
  const [userProfiles, setUserProfiles] = useState<UserEncodingProfile[]>(loadProfiles);
  const [preferences, setPreferences] = useState<ProfilePreferences>(loadPreferences);
  const profiles = useMemo<EncodingProfile[]>(() => [
    ...BUILT_IN_PROFILES,
    ...userProfiles.map((profile) => ({
      ...profile,
      description: null,
      isBuiltIn: false,
    })),
  ], [userProfiles]);
  const validProfileIds = new Set(profiles.map((profile) => profile.id));
  const defaultProfileId = preferences.defaultProfileId === null
    || validProfileIds.has(preferences.defaultProfileId)
    ? preferences.defaultProfileId
    : FALLBACK_PROFILE_ID;
  const lastUsedProfileId = validProfileIds.has(preferences.lastUsedProfileId)
    ? preferences.lastUsedProfileId
    : FALLBACK_PROFILE_ID;
  const effectiveDefaultProfileId = defaultProfileId ?? lastUsedProfileId;
  const effectiveDefaultProfile = profiles.find((profile) => profile.id === effectiveDefaultProfileId)
    ?? profiles[0];

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeProfiles(userProfiles));
    } catch {
      // Profiles remain available for the current session if local storage is unavailable.
    }
  }, [userProfiles]);

  useEffect(() => {
    const normalized = { defaultProfileId, lastUsedProfileId };
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(normalized));
    } catch {
      // Profile preferences remain available for the current session if storage is unavailable.
    }
    if (
      preferences.defaultProfileId !== normalized.defaultProfileId
      || preferences.lastUsedProfileId !== normalized.lastUsedProfileId
    ) {
      setPreferences(normalized);
    }
  }, [defaultProfileId, lastUsedProfileId, preferences]);

  function createProfile(
    requestedName: string,
    settings: EncodingSettings,
    isAdvanced: boolean,
  ): string {
    return addProfile(requestedName, settings, isAdvanced, true);
  }

  function addProfile(
    requestedName: string,
    settings: EncodingSettings,
    isAdvanced: boolean,
    remember: boolean,
  ): string {
    const id = `user-${crypto.randomUUID()}`;
    setUserProfiles((current) => [...current, {
      id,
      name: uniqueName(requestedName, profiles.map((profile) => profile.name)),
      settings: { ...settings },
      isAdvanced,
    }]);
    if (remember) {
      setPreferences((current) => ({ ...current, lastUsedProfileId: id }));
    }
    return id;
  }

  function updateProfile(id: string, settings: EncodingSettings, isAdvanced: boolean) {
    setUserProfiles((current) => current.map((profile) => (
      profile.id === id ? { ...profile, settings: { ...settings }, isAdvanced } : profile
    )));
  }

  function duplicateProfile(id: string): string | null {
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) return null;
    return addProfile(`${profile.name} copy`, profile.settings, profile.isAdvanced, false);
  }

  function renameProfile(id: string, requestedName: string) {
    setUserProfiles((current) => current.map((profile) => (
      profile.id === id
        ? {
            ...profile,
            name: uniqueName(
              requestedName,
              profiles.filter((candidate) => candidate.id !== id).map((candidate) => candidate.name),
            ),
          }
        : profile
    )));
  }

  function deleteProfile(id: string) {
    setUserProfiles((current) => current.filter((profile) => profile.id !== id));
    setPreferences((current) => ({
      defaultProfileId: current.defaultProfileId === id ? FALLBACK_PROFILE_ID : current.defaultProfileId,
      lastUsedProfileId: current.lastUsedProfileId === id ? FALLBACK_PROFILE_ID : current.lastUsedProfileId,
    }));
  }

  function setDefaultProfile(profileId: string | null) {
    if (profileId !== null && !validProfileIds.has(profileId)) return;
    setPreferences((current) => ({ ...current, defaultProfileId: profileId }));
  }

  function rememberProfile(profileId: string) {
    if (!validProfileIds.has(profileId)) return;
    setPreferences((current) => ({ ...current, lastUsedProfileId: profileId }));
  }

  return {
    profiles,
    createProfile,
    updateProfile,
    duplicateProfile,
    renameProfile,
    deleteProfile,
    defaultProfileId,
    lastUsedProfileId,
    effectiveDefaultProfile,
    setDefaultProfile,
    rememberProfile,
  };
}

function loadProfiles(): UserEncodingProfile[] {
  try {
    return parseStoredProfiles(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function loadPreferences(): ProfilePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null") as unknown;
    if (!isRecord(value)) throw new Error("Invalid profile preferences");
    return {
      defaultProfileId: value.defaultProfileId === null || typeof value.defaultProfileId === "string"
        ? value.defaultProfileId
        : FALLBACK_PROFILE_ID,
      lastUsedProfileId: typeof value.lastUsedProfileId === "string"
        ? value.lastUsedProfileId
        : FALLBACK_PROFILE_ID,
    };
  } catch {
    return {
      defaultProfileId: FALLBACK_PROFILE_ID,
      lastUsedProfileId: FALLBACK_PROFILE_ID,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function uniqueName(requestedName: string, existingNames: string[]): string {
  const base = requestedName.trim().slice(0, 60) || "Untitled profile";
  const used = new Set(existingNames.map((name) => name.toLocaleLowerCase()));
  if (!used.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (true) {
    const ending = ` ${suffix}`;
    const candidate = `${base.slice(0, 60 - ending.length)}${ending}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
    suffix += 1;
  }
}
