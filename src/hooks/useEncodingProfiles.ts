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

export function useEncodingProfiles() {
  const [userProfiles, setUserProfiles] = useState<UserEncodingProfile[]>(loadProfiles);
  const profiles = useMemo<EncodingProfile[]>(() => [
    ...BUILT_IN_PROFILES,
    ...userProfiles.map((profile) => ({
      ...profile,
      description: null,
      isBuiltIn: false,
    })),
  ], [userProfiles]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeProfiles(userProfiles));
    } catch {
      // Profiles remain available for the current session if local storage is unavailable.
    }
  }, [userProfiles]);

  function createProfile(
    requestedName: string,
    settings: EncodingSettings,
    isAdvanced: boolean,
  ): string {
    const id = `user-${crypto.randomUUID()}`;
    setUserProfiles((current) => [...current, {
      id,
      name: uniqueName(requestedName, profiles.map((profile) => profile.name)),
      settings: { ...settings },
      isAdvanced,
    }]);
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
    return createProfile(`${profile.name} copy`, profile.settings, profile.isAdvanced);
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
  }

  return {
    profiles,
    createProfile,
    updateProfile,
    duplicateProfile,
    renameProfile,
    deleteProfile,
  };
}

function loadProfiles(): UserEncodingProfile[] {
  try {
    return parseStoredProfiles(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
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
