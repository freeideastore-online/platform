export function readerSettingsBootScript() {
  return `<script>
(() => {
  try {
    const root = document.documentElement;
    const storedTheme = localStorage.getItem('fis:reader-theme');
    const theme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'system';
    const size = localStorage.getItem('fis:reader-size') || 'normal';
    const resolvedTheme = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
    root.dataset.readerTheme = resolvedTheme;
    root.dataset.readerThemeChoice = theme;
    root.dataset.readerSize = size;
  } catch {}
})();
</script>`;
}

export function readerSettingsCss() {
  return `
:root{--reader-scale:1}
:root[data-reader-theme="light"]{color-scheme:light;--page:#f8fafc;--panel:#fff;--panel-soft:#f1f7fb;--panel-alt:#fbfdfe;--topbar-bg:rgba(255,255,255,.95);--ink:#111827;--muted:#334155;--line:#cbd5e1;--accent:#0e7490;--accent-dark:#0f4c5c;--accent-strong:#0f4c5c;--mark:#ecfeff;--body-text:#273646;--title-text:#263445;--strong-text:#17202a;--chapter-badge:#e2f3f7;--focus:#cffafe;--hover-line:#67c1d4;--progress-track:#e8eef4;--shadow:0 16px 36px rgba(15,23,42,.06)}
:root[data-reader-theme="dark"]{color-scheme:dark;--paper:#0f1518;--page:#0f1518;--panel:#151d22;--panel-soft:#1d2a31;--panel-alt:#111a1f;--topbar-bg:rgba(15,21,24,.96);--ink:#edf5f7;--muted:#a9bbc3;--line:#2c3b43;--accent:#22d3ee;--accent-dark:#67e8f9;--accent-strong:#67e8f9;--mark:#16313a;--body-text:#d5e2e7;--title-text:#d5e2e7;--strong-text:#edf5f7;--chapter-badge:#183743;--focus:#164e63;--hover-line:#22d3ee;--progress-track:#24343c;--shadow:none}
:root[data-reader-size="large"]{--reader-scale:1.08}
:root[data-reader-size="xlarge"]{--reader-scale:1.16}
html{background:var(--page)}
body{min-height:100vh;font-size:calc(16px * var(--reader-scale))}
.reader-controls{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
.reader-controls button{display:grid;width:32px;height:32px;place-items:center;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--muted);cursor:pointer;font:inherit;font-size:.86rem;font-weight:900;line-height:1;padding:0}
.reader-controls button:hover,.reader-controls button.active{border-color:var(--accent);background:var(--mark);color:var(--accent-dark)}
.reader-controls [data-reader-size-option="large"]{font-size:.84rem}
.reader-controls [data-reader-size-option="xlarge"]{font-size:.96rem}
:root[data-reader-theme="dark"] body,:root[data-reader-theme="dark"] header,:root[data-reader-theme="dark"] .book-topbar,:root[data-reader-theme="dark"] .book-sidebar,:root[data-reader-theme="dark"] .toc-rail,:root[data-reader-theme="dark"] .mobile-book-nav,:root[data-reader-theme="dark"] .mobile-book-home-nav,:root[data-reader-theme="dark"] .mobile-page-toc{background:var(--paper);color:var(--ink)}
:root[data-reader-theme="dark"] .doc,:root[data-reader-theme="dark"] .side,:root[data-reader-theme="dark"] .book-home-nav,:root[data-reader-theme="dark"] .comments,:root[data-reader-theme="dark"] .chapter-body,:root[data-reader-theme="dark"] .summary,:root[data-reader-theme="dark"] .chapter-nav a,:root[data-reader-theme="dark"] .chapter-nav span,:root[data-reader-theme="dark"] .pill,:root[data-reader-theme="dark"] .store-link,:root[data-reader-theme="dark"] .book-actions a,:root[data-reader-theme="dark"] .comment,:root[data-reader-theme="dark"] .mobile-page-toc a,:root[data-reader-theme="dark"] input,:root[data-reader-theme="dark"] textarea{background:var(--panel);color:var(--ink)}
:root[data-reader-theme="dark"] p,:root[data-reader-theme="dark"] li,:root[data-reader-theme="dark"] .doc p,:root[data-reader-theme="dark"] .doc li{color:#d5e2e7}
:root[data-reader-theme="light"] body,:root[data-reader-theme="light"] .book-topbar,:root[data-reader-theme="light"] .book-sidebar,:root[data-reader-theme="light"] .toc-rail,:root[data-reader-theme="light"] .mobile-book-nav,:root[data-reader-theme="light"] .mobile-book-home-nav,:root[data-reader-theme="light"] .mobile-page-toc{background:var(--page);color:var(--ink)}
:root[data-reader-theme="light"] .book-sidebar,:root[data-reader-theme="light"] .mobile-book-nav,:root[data-reader-theme="light"] .mobile-book-home-nav,:root[data-reader-theme="light"] .chapter-body,:root[data-reader-theme="light"] .summary,:root[data-reader-theme="light"] .comments,:root[data-reader-theme="light"] .chapter-nav a,:root[data-reader-theme="light"] .chapter-nav span,:root[data-reader-theme="light"] .pill,:root[data-reader-theme="light"] .store-link,:root[data-reader-theme="light"] .book-actions a,:root[data-reader-theme="light"] .comment,:root[data-reader-theme="light"] .mobile-page-toc a,:root[data-reader-theme="light"] input,:root[data-reader-theme="light"] textarea{background:var(--panel);color:var(--ink)}
:root[data-reader-theme="light"] p,:root[data-reader-theme="light"] li,:root[data-reader-theme="light"] .doc p,:root[data-reader-theme="light"] .doc li{color:var(--body-text)}
@media(max-width:820px){header .reader-controls{display:none}}
`;
}

export function readerSettingsControls() {
  return `<div class="reader-controls" aria-label="Reader settings">
  <button type="button" data-reader-theme-option="light" aria-label="Light mode" title="Light mode">&#9728;</button>
  <button type="button" data-reader-theme-option="dark" aria-label="Dark mode" title="Dark mode">&#9790;</button>
  <button type="button" data-reader-size-option="normal" aria-label="Normal font size" title="Normal font size">A</button>
  <button type="button" data-reader-size-option="large" aria-label="Large font size" title="Large font size">A+</button>
  <button type="button" data-reader-size-option="xlarge" aria-label="Largest font size" title="Largest font size">A++</button>
</div>`;
}

export function readerSettingsScript() {
  return `<script>
(() => {
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const storedTheme = localStorage.getItem('fis:reader-theme');
    const theme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'system';
    const size = localStorage.getItem('fis:reader-size') || 'normal';
    const resolvedTheme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    root.dataset.readerTheme = resolvedTheme;
    root.dataset.readerThemeChoice = theme;
    root.dataset.readerSize = size;
    document.querySelectorAll('[data-reader-theme-option]').forEach((button) => {
      const active = button.dataset.readerThemeOption === theme;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-reader-size-option]').forEach((button) => {
      const active = button.dataset.readerSizeOption === size;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  document.querySelectorAll('[data-reader-theme-option]').forEach((button) => button.onclick = () => {
    const theme = button.dataset.readerThemeOption;
    if (theme === 'light' || theme === 'dark') localStorage.setItem('fis:reader-theme', theme);
    else localStorage.removeItem('fis:reader-theme');
    apply();
  });
  document.querySelectorAll('[data-reader-size-option]').forEach((button) => button.onclick = () => {
    localStorage.setItem('fis:reader-size', button.dataset.readerSizeOption || 'normal');
    apply();
  });
  media.onchange = apply;
  apply();
})();
</script>`;
}
