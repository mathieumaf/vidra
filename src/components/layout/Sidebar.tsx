import { Icon } from "../ui/Icon";
import type { EncodeFinished, FfmpegStatus, View } from "../../types/media";
import { DragRegion } from "./DragRegion";

type SidebarProps = {
  view: View;
  status: FfmpegStatus | null;
  isReady: boolean;
  isEncoding: boolean;
  result: EncodeFinished | null;
  onViewChange: (view: View) => void;
  onNewConversion: () => void;
};

const views: View[] = ["convert", "queue", "history", "settings"];

export function Sidebar({
  view,
  status,
  isReady,
  isEncoding,
  result,
  onViewChange,
  onNewConversion,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <DragRegion className="window-drag-region" />
      <div className="brand">
        <div className="brand-mark">V</div>
        <span>Vidra</span>
      </div>

      <button
        className="new-conversion"
        type="button"
        onClick={onNewConversion}
        disabled={isEncoding}
      >
        <Icon name="plus" />
        <span>New conversion</span>
      </button>

      <nav aria-label="Main navigation">
        {views.map((item) => (
          <button
            key={item}
            className={view === item ? "active" : ""}
            type="button"
            onClick={() => onViewChange(item)}
          >
            <Icon name={item} />
            <span>{item[0].toUpperCase() + item.slice(1)}</span>
            {item === "queue" && isEncoding && <span className="nav-badge">1</span>}
            {item === "history" && result && <span className="nav-badge muted">1</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />
      <div className="privacy-note">
        <Icon name="shield" />
        <span>
          <strong>Private by design</strong>
          Files stay on this Mac
        </span>
      </div>
      <div className={`engine-status ${isReady ? "ready" : "unavailable"}`}>
        <span className="status-dot" />
        {status === null ? "Checking engine" : isReady ? "FFmpeg ready" : "Engine unavailable"}
      </div>
    </aside>
  );
}
