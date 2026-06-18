import { THEME_BOOT, THEME_CSS, THEME_SCRIPT } from './theme';

export function readerSettingsBootScript() {
  return THEME_BOOT;
}

export function readerSettingsCss() {
  return `
${THEME_CSS}
:root{--reader-scale:1;--chapter-badge:#e2f3f7;--focus:#cffafe;--hover-line:#67c1d4;--progress-track:#e8eef4}
[data-theme="dark"]{--chapter-badge:#183743;--focus:#164e63;--hover-line:#22d3ee;--progress-track:#24343c}
body{min-height:100vh;font-size:calc(16px * var(--reader-scale))}
[data-theme="dark"] .book-topbar,[data-theme="dark"] .book-sidebar,[data-theme="dark"] .toc-rail,[data-theme="dark"] .mobile-book-nav,[data-theme="dark"] .mobile-page-toc{background:var(--page);color:var(--ink)}
[data-theme="dark"] .chapter-body,[data-theme="dark"] .summary,[data-theme="dark"] .comments,[data-theme="dark"] .chapter-nav a,[data-theme="dark"] .chapter-nav span,[data-theme="dark"] .pill,[data-theme="dark"] .comment,[data-theme="dark"] .mobile-page-toc a,[data-theme="dark"] input,[data-theme="dark"] textarea,[data-theme="dark"] .idea-diagram{background:var(--panel);color:var(--ink);border-color:var(--line)}
[data-theme="dark"] p,[data-theme="dark"] li{color:var(--body-text)}
`;
}

export function readerSettingsControls() {
  return `<button class="theme-toggle" type="button" data-reader-theme-toggle aria-label="Toggle theme">&#9790;</button>`;
}

export function readerSettingsScript() {
  return THEME_SCRIPT;
}
