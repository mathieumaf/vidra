import type { ConversionActivity } from "../../lib/conversionActivity";
import { DragRegion } from "../layout/DragRegion";
import type { BoundaryFailure } from "./AppErrorBoundary";
import { FailureState } from "./FailureState";

type AppFailureWindowProps = {
  failure: BoundaryFailure;
  activity: ConversionActivity;
  onReload: () => void;
};

export function AppFailureWindow({ failure, activity, onReload }: AppFailureWindowProps) {
  const retryFailed = failure.attempts > 1;

  return (
    <div className="failure-window">
      <DragRegion className="native-titlebar" />
      <div className="failure-window-body">
        <FailureState
          title="Vidra could not display this window"
          description={retryFailed
            ? `Rebuilding the interface failed again after ${failure.attempts} attempts. Reload the window to start the interface from scratch. Your videos are never modified.`
            : "The interface stopped drawing, so the window could not be shown. Rebuilding it keeps your queue. Your videos are never modified."}
          message={failure.message}
          activity={activity}
          diagnostic={failure.diagnostic}
          retryLabel="Rebuild the interface"
          onRetry={failure.retry}
          onReload={onReload}
        />
      </div>
    </div>
  );
}
