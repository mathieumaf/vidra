import type { MouseEvent, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type DragRegionProps = {
  className: string;
  children?: ReactNode;
};

const appWindow = getCurrentWindow();

export function DragRegion({ className, children }: DragRegionProps) {
  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.buttons !== 1) return;

    const action = event.detail === 2
      ? appWindow.toggleMaximize()
      : appWindow.startDragging();

    void action.catch((error) => {
      console.error("Unable to move the Vidra window.", error);
    });
  }

  return (
    <div
      className={className}
      onMouseDown={handleMouseDown}
      {...(children ? {} : { "aria-hidden": true })}
    >
      {children}
    </div>
  );
}
