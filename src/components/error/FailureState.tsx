import {
  conversionActivityMessage,
  isConversionInProgress,
  type ConversionActivity,
} from "../../lib/conversionActivity";
import { INTERFACE_REPORT_NAME } from "../../lib/failure";
import type { DiagnosticReport } from "../../types/media";
import { Icon } from "../ui/Icon";
import { DiagnosticDetails } from "../views/DiagnosticDetails";

type FailureStateProps = {
  title: string;
  description: string;
  message?: string;
  activity: ConversionActivity;
  diagnostic: DiagnosticReport;
  retryLabel?: string;
  onRetry: () => void;
  onReload?: () => void;
};

export function FailureState({
  title,
  description,
  message,
  activity,
  diagnostic,
  retryLabel = "Try again",
  onRetry,
  onReload,
}: FailureStateProps) {
  return (
    <div className="failure-state" role="alert">
      <div className="failure-mark"><Icon name="warning" /></div>
      <h2>{title}</h2>
      <p>{description}</p>
      {message && <p className="failure-message">{message}</p>}
      <p className={`failure-activity${isConversionInProgress(activity) ? " running" : ""}`}>
        {conversionActivityMessage(activity)}
      </p>

      <div className="failure-actions">
        <button className="primary-button" type="button" onClick={onRetry}>{retryLabel}</button>
        {onReload && (
          <button className="secondary-button" type="button" onClick={onReload}>
            Reload the window
          </button>
        )}
      </div>

      <DiagnosticDetails diagnostic={diagnostic} sourceName={INTERFACE_REPORT_NAME} />
    </div>
  );
}
