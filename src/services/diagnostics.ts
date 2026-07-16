import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export async function copyDiagnosticReport(report: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(report);
    return;
  }

  const field = document.createElement("textarea");
  field.value = report;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Unable to copy the diagnostic report.");
}

export async function saveDiagnosticReport(
  report: string,
  sourceName: string,
): Promise<boolean> {
  const path = await save({
    title: "Save diagnostic report",
    defaultPath: diagnosticFileName(sourceName),
    filters: [{ name: "Text report", extensions: ["txt"] }],
  });
  if (!path) return false;
  await invoke("save_diagnostic_report", { path, report });
  return true;
}

function diagnosticFileName(sourceName: string): string {
  const extension = sourceName.lastIndexOf(".");
  const base = (extension > 0 ? sourceName.slice(0, extension) : sourceName)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim()
    .slice(0, 80);
  return `${base || "conversion"}-vidra-diagnostic.txt`;
}
