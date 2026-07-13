import { useEffect, useState } from "react";
import type { FfmpegStatus } from "../types/media";
import { errorMessage } from "../lib/format";
import { getFfmpegStatus } from "../services/encoding";

export function useFfmpegStatus() {
  const [status, setStatus] = useState<FfmpegStatus | null>(null);

  useEffect(() => {
    void getFfmpegStatus()
      .then(setStatus)
      .catch((error) => {
        setStatus({
          ready: false,
          ffmpegVersion: null,
          ffprobeVersion: null,
          error: errorMessage(error),
        });
      });
  }, []);

  return {
    status,
    isReady: status?.ready === true,
  };
}
