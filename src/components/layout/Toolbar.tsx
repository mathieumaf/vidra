import type { View } from "../../types/media";

type ToolbarProps = {
  view: View;
  title: string;
  subtitle: string;
  hasMedia: boolean;
  isEncoding: boolean;
  onReplaceSource: () => void;
};

export function Toolbar({
  view,
  title,
  subtitle,
  hasMedia,
  isEncoding,
  onReplaceSource,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {view === "convert" && hasMedia && !isEncoding && (
        <button className="toolbar-button" type="button" onClick={onReplaceSource}>
          Replace source
        </button>
      )}
    </header>
  );
}
