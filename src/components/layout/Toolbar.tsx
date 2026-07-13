import type { View } from "../../types/media";

type ToolbarProps = {
  view: View;
  title: string;
  subtitle: string;
  hasMedia: boolean;
  isEncoding: boolean;
  onAddSources: () => void;
};

export function Toolbar({
  view,
  title,
  subtitle,
  hasMedia,
  isEncoding,
  onAddSources,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {view === "convert" && hasMedia && !isEncoding && (
        <button className="toolbar-button" type="button" onClick={onAddSources}>
          Add videos
        </button>
      )}
    </header>
  );
}
