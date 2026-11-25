import type { ReactNode } from "react";

/**
 * The header bar: the app's name and tagline, then `children` (buttons or
 * links) on the right. The empty state leaves the tagline out.
 */
export function AppHeader({
  tagline = true,
  heading = true,
  children,
}: {
  tagline?: boolean;
  /** The name is the page's h1 (false where the page has its own h1). */
  heading?: boolean;
  children?: ReactNode;
}) {
  const Name = heading ? "h1" : "p";
  return (
    <header className="app-header">
      <Name className="app-name">Harvard Web Viewer</Name>
      {tagline && <p className="app-tagline">Old Harvard Graphics files, readable again.</p>}
      <div className="app-actions">{children}</div>
    </header>
  );
}
