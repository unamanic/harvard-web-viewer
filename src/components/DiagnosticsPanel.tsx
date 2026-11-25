import type { Diagnostics } from "../ui/diagnostics";

/**
 * Every warning and missing file, in full, behind a "Show all" toggle that
 * starts closed (the notice box above it lists them in plain words).
 */
export function DiagnosticsPanel({
  diagnostics,
  path,
  summary = "Show all",
}: {
  diagnostics: Diagnostics;
  path: string;
  summary?: string;
}) {
  const { missing, documentWarnings, slideWarnings, slideLabel, count } = diagnostics;
  return (
    <details className="diagnostics">
      <summary>
        {summary} <span className="badge">{count === 0 ? "no problems" : count}</span>
      </summary>
      <div className="panel-body">
        {count === 0 && <p className="muted">No warnings and no missing files.</p>}
        {missing.length > 0 && (
          <section aria-labelledby="diag-missing">
            <h4 id="diag-missing">Missing files</h4>
            <p className="muted">
              These files are named but were not opened. Add them with “Add missing files…”, or open them together with
              this file (or drop the whole folder), to use them.
            </p>
            <ul>
              {missing.map((m, i) => (
                <li key={i}>
                  <code>{m.name}</code>
                  {m.purpose ? ` (${m.purpose})` : ""}
                  {m.requestedBy && m.requestedBy !== path ? `, asked for by ${m.requestedBy}` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}
        {documentWarnings.length > 0 && (
          <section aria-labelledby="diag-doc">
            <h4 id="diag-doc">File warnings</h4>
            <ul>
              {documentWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </section>
        )}
        {slideWarnings.length > 0 && (
          <section aria-labelledby="diag-slide">
            <h4 id="diag-slide">Current slide{slideLabel ? `: ${slideLabel}` : ""}</h4>
            <ul>
              {slideWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </details>
  );
}
