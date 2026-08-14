import { useEffect, useState } from "react";
import { releaseTag, releaseUrl, SOURCE_REPOSITORY_URL } from "../config/legal";
import { errorMessage } from "../lib/format";
import { getApplicationVersion, openExternalUrl } from "../services/application";

export function useApplicationInfo() {
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    void getApplicationVersion()
      .then((value) => {
        if (isMounted) setVersion(value);
      })
      .catch((cause) => {
        if (isMounted) setError(`Vidra version unavailable: ${errorMessage(cause)}`);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  async function openSource(): Promise<void> {
    await openLink(SOURCE_REPOSITORY_URL);
  }

  async function openRelease(): Promise<void> {
    if (!version) return;
    await openLink(releaseUrl(version));
  }

  async function openLink(url: string): Promise<void> {
    setError(null);
    try {
      await openExternalUrl(url);
    } catch (cause) {
      setError(`The link could not be opened: ${errorMessage(cause)}`);
    }
  }

  return {
    version,
    releaseTag: version ? releaseTag(version) : null,
    error,
    openSource,
    openRelease,
  };
}
