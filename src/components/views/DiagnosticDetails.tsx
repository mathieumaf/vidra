import { useState } from "react";
import { errorMessage } from "../../lib/format";
import {
  copyDiagnosticReport,
  saveDiagnosticReport,
} from "../../services/diagnostics";
import type { DiagnosticReport } from "../../types/media";
import { Icon } from "../ui/Icon";

export function DiagnosticDetails({
  diagnostic,
  sourceName,
}: {
  diagnostic: DiagnosticReport;
  sourceName: string;
}) {
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  async function copyReport() {
    try {
      await copyDiagnosticReport(diagnostic.report);
      setActionStatus("Diagnostic report copied.");
    } catch (error) {
      setActionStatus(errorMessage(error));
    }
  }

  async function saveReport() {
    try {
      if (await saveDiagnosticReport(diagnostic.report, sourceName)) {
        setActionStatus("Diagnostic report saved.");
      }
    } catch (error) {
      setActionStatus(errorMessage(error));
    }
  }

  return (
    <details className="diagnostic-details">
      <summary>
        Technical details
        <span>{diagnostic.code.split("_").join(" ")}</span>
      </summary>
      <div className="diagnostic-panel">
        <div className="diagnostic-panel-heading">
          <p>Source and output paths are redacted. Review the report before sharing it.</p>
          <div>
            <button type="button" onClick={() => void copyReport()}>
              <Icon name="copy" />Copy
            </button>
            <button type="button" onClick={() => void saveReport()}>
              <Icon name="download" />Save report
            </button>
          </div>
        </div>
        {actionStatus && <p className="diagnostic-action-status" role="status">{actionStatus}</p>}
        <pre>{diagnostic.report}</pre>
      </div>
    </details>
  );
}
