import { Icon } from "../ui/Icon";
import vidraMark from "../../assets/vidra-mark.svg";
import { localFilesPrivacyNote } from "../../lib/platform";
import type { FfmpegStatus, View } from "../../types/media";
import { DragRegion } from "./DragRegion";

type SidebarProps = {
  view: View;
  status: FfmpegStatus | null;
  isReady: boolean;
  queueCount: number;
  onViewChange: (view: View) => void;
  onNewConversion: () => void;
};

const views: View[] = ["convert", "queue", "history", "settings"];

export function Sidebar({
  view,
  status,
  isReady,
  queueCount,
  onViewChange,
  onNewConversion,
}: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <DragRegion className="window-drag-region" />
      <div className="brand">
        <img className="brand-mark" src={vidraMark} alt="" />
        <span>Vidra</span>
      </div>

      <button
        className="new-conversion"
        type="button"
        onClick={onNewConversion}
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
            aria-current={view === item ? "page" : undefined}
            onClick={() => onViewChange(item)}
          >
            <Icon name={item} />
            <span>{item[0].toUpperCase() + item.slice(1)}</span>
            {item === "queue" && queueCount > 0 && (
              <span className="nav-badge">
                <span className="visually-hidden">
                  {queueCount === 1 ? ", 1 video" : `, ${queueCount} videos`}
                </span>
                <span aria-hidden="true">{queueCount}</span>
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />
      <div className="privacy-note">
        <Icon name="shield" />
        <span>
          <strong>Private by design</strong>
          {localFilesPrivacyNote()}
        </span>
      </div>
      <div className={`engine-status ${isReady ? "ready" : "unavailable"}`} role="status">
        <span className="status-dot" aria-hidden="true" />
        {status === null ? "Checking engine" : isReady ? "FFmpeg ready" : "Engine unavailable"}
      </div>
    </aside>
  );
}
