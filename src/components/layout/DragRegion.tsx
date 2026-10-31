import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type DragRegionProps = {
  className: string;
};

const appWindow = getCurrentWindow();

export function DragRegion({ className }: DragRegionProps) {
  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.buttons !== 1) return;

    const action = event.detail === 2
      ? appWindow.toggleMaximize()
      : appWindow.startDragging();

    void action.catch((error) => {
      console.error("Unable to move the Vidra window.", error);
    });
  }

  return <div className={className} onMouseDown={handleMouseDown} aria-hidden="true" />;
}
