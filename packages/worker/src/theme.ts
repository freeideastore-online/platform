/**
 * Shared theme system for all FIS pages.
 * Eliminates white flash by setting background before CSS parses.
 */

/** Inline script for <head> — runs before any rendering. */
export const THEME_BOOT = `<script>
(() => {
  try {
    const r = document.documentElement;
    const s = localStorage.getItem('fis:reader-theme');
    const t = s === 'light' || s === 'dark' ? s : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    r.dataset.theme = t;
    r.style.background = t === 'dark' ? '#0f1518' : '#f8fafc';
    r.style.colorScheme = t;
  } catch {}
})();
</script>`;

/** CSS variables for both themes + toggle button style. */
export const THEME_CSS = `
html{background:#f8fafc;color-scheme:light}
@media(prefers-color-scheme:dark){html:not([data-theme="light"]){background:#0f1518;color-scheme:dark}}
:root,[data-theme="light"]{--page:#f8fafc;--panel:#fff;--panel-alt:#fbfdfe;--topbar-bg:rgba(255,255,255,.95);--ink:#111827;--muted:#334155;--line:#cbd5e1;--accent:#0e7490;--accent-strong:#0f4c5c;--mark:#ecfeff;--body-text:#273646;--title-text:#263445;--strong-text:#17202a;--shadow:0 16px 36px rgba(15,23,42,.06);--bad:#dc2626}
[data-theme="dark"]{color-scheme:dark;--page:#0f1518;--panel:#151d22;--panel-alt:#111a1f;--topbar-bg:rgba(15,21,24,.96);--ink:#edf5f7;--muted:#a9bbc3;--line:#2c3b43;--accent:#22d3ee;--accent-strong:#67e8f9;--mark:#16313a;--body-text:#d5e2e7;--title-text:#d5e2e7;--strong-text:#edf5f7;--shadow:none;--bad:#f87171}
html{background:var(--page)}
body{background:var(--page);color:var(--ink)}
[data-theme="dark"] header,[data-theme="dark"] .book-topbar{background:var(--topbar-bg)}
[data-theme="dark"] .panel,[data-theme="dark"] .chapter-card,[data-theme="dark"] input,[data-theme="dark"] textarea,[data-theme="dark"] select{background:var(--panel);color:var(--ink);border-color:var(--line)}
[data-theme="dark"] .status{background:var(--panel-alt);color:var(--muted);border-color:var(--line)}
[data-theme="dark"] .status.ok{border-color:#065f46;color:#6ee7b7}
[data-theme="dark"] .status.err{border-color:#7f1d1d;color:#fca5a5}
[data-theme="dark"] .button{border-color:var(--accent);background:var(--accent);color:#0f1518}
[data-theme="dark"] .button.secondary{background:var(--panel);color:var(--accent-strong);border-color:var(--line)}
[data-theme="dark"] .button.danger{background:var(--panel);color:var(--bad);border-color:var(--bad)}
[data-theme="dark"] a{color:inherit}
[data-theme="dark"] .brand .mark,[data-theme="dark"] .logo{background:#0c1a1f}
[data-theme="dark"] .chapter-card,.idea-item,.mini-item,.empty-state,.comment{background:var(--panel)}
[data-theme="dark"] .muted,.lead{color:var(--muted)}
[data-theme="dark"] p,[data-theme="dark"] li{color:var(--body-text)}
.theme-toggle{display:grid;width:32px;height:32px;place-items:center;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--muted);cursor:pointer;font-size:.86rem;line-height:1;padding:0}.theme-toggle:hover{border-color:var(--accent);background:var(--mark);color:var(--accent-strong)}
`;

/** Inline script for end of <body> — wires toggle buttons + system media listener. */
export const THEME_SCRIPT = `<script>
(() => {
  const r = document.documentElement;
  const m = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const s = localStorage.getItem('fis:reader-theme');
    const t = s === 'light' || s === 'dark' ? s : (m.matches ? 'dark' : 'light');
    r.dataset.theme = t;
    r.style.background = '';
    document.querySelectorAll('.theme-toggle').forEach(b => {
      b.textContent = t === 'dark' ? '\\u2600' : '\\u263E';
    });
  };
  document.querySelectorAll('.theme-toggle').forEach(b => b.onclick = () => {
    const next = r.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('fis:reader-theme', next);
    apply();
  });
  m.onchange = apply;
  apply();
})();
</script>`;
