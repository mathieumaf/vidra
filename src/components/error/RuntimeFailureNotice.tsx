import { INTERFACE_REPORT_NAME } from "../../lib/failure";
import type { RuntimeFailure } from "../../lib/runtimeFailures";
import { Icon } from "../ui/Icon";
import { DiagnosticDetails } from "../views/DiagnosticDetails";

type RuntimeFailureNoticeProps = {
  failure: RuntimeFailure;
  onDismiss: () => void;
};

export function RuntimeFailureNotice({ failure, onDismiss }: RuntimeFailureNoticeProps) {
  return (
    <aside className="runtime-failure-notice" role="alert">
      <div className="runtime-failure-heading">
        <div className="failure-mark"><Icon name="warning" /></div>
        <div>
          <strong>Something failed in the background</strong>
          <p>{failure.message}</p>
          {failure.occurrences > 1 && (
            <p className="runtime-failure-count">Reported {failure.occurrences} times.</p>
          )}
        </div>
        <button
          className="runtime-failure-dismiss"
          type="button"
          aria-label="Dismiss this failure"
          onClick={onDismiss}
        >
          <Icon name="remove" />
        </button>
      </div>
      <p className="runtime-failure-copy">
        Conversions already running are not affected. Copy the report if you want to file an issue.
      </p>
      <DiagnosticDetails diagnostic={failure.diagnostic} sourceName={INTERFACE_REPORT_NAME} />
    </aside>
  );
}
