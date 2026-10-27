import type { ReactNode } from 'react';

export const LEGAL_LAST_UPDATED = '27 October 2026';

export default function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="container legal-container">
      <article className="card legal-card">
        <p className="small muted" style={{ marginTop: 0 }}>
          Last updated: {LEGAL_LAST_UPDATED}
        </p>
        <h1>{title}</h1>
        <div className="legal-content">{children}</div>
        <nav className="legal-nav" aria-label="Legal pages">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Use</a>
          <a href="/data-deletion">Data Deletion</a>
        </nav>
      </article>
    </main>
  );
}
