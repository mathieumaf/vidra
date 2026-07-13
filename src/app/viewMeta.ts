import type { EncodeQueueItem, View } from "../types/media";

export function viewMeta(view: View, items: EncodeQueueItem[]): [string, string] {
  switch (view) {
    case "convert":
      return [
        "Convert",
        items.length > 0
          ? `${items.length} ${items.length === 1 ? "video" : "videos"} selected`
          : "Start a local video conversion",
      ];
    case "queue": {
      const current = items.find((item) => item.status === "encoding" || item.status === "paused");
      const pending = items.filter((item) => item.status === "queued").length;
      const ready = items.filter((item) => item.status === "ready").length;
      if (current) {
        return ["Queue", `${current.media.name} · ${current.status === "paused" ? "paused" : `${pending} waiting`}`];
      }
      if (ready > 0) return ["Queue", `${ready} ready to encode`];
      return ["Queue", "No active encoding jobs"];
    }
    case "history":
      return ["History", "Recent conversions from this session"];
    case "settings":
      return ["Settings", "Application and encoding engine"];
  }
}
