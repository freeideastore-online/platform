/**
 * Shared mobile navigation (hamburger) for every FIS page.
 *
 * Each surface used to hide its site nav below the mobile breakpoint
 * (`nav{display:none}`) with nothing in its place, so phones got no site
 * navigation at all. The toggle is hidden on desktop and opens the same nav as
 * a drawer under the sticky header on small screens.
 *
 * The static pages in store/ carry inline copies of this CSS and script — keep
 * them in sync when changing anything here.
 */

/** Hamburger button. Place it last inside <header>, after the theme toggle. */
export const NAV_TOGGLE =
  '<button class="nav-toggle" type="button" aria-label="Menu" aria-controls="site-nav" aria-expanded="false">&#9776;</button>';

/**
 * Drawer styles. Pass the page's existing mobile breakpoint so the nav becomes
 * a drawer exactly when the rest of that page's desktop layout collapses.
 */
export function navCss(breakpoint: number): string {
  return `
.nav-toggle{display:none;width:34px;height:34px;place-items:center;border:1px solid var(--line);border-radius:8px;background:var(--panel,#fff);color:var(--muted);cursor:pointer;font:inherit;font-size:1.05rem;line-height:1;padding:0}
.nav-toggle:hover{border-color:var(--accent);color:var(--accent-strong,var(--accent))}
@media(max-width:${breakpoint}px){
.nav-toggle{display:grid}
.site-nav{position:absolute;top:100%;right:0;left:0;z-index:30;display:none;flex-direction:column;align-items:stretch;gap:.1rem;max-height:80vh;overflow-y:auto;border-bottom:1px solid var(--line);background:var(--panel,#fff);margin:0;padding:.45rem .95rem .75rem;box-shadow:0 18px 30px rgba(15,23,42,.14)}
.site-nav.open{display:flex}
.site-nav a{display:flex;align-items:center;min-height:44px;border-radius:8px;padding:.55rem .5rem;font-size:.95rem}
.site-nav a:hover{background:var(--mark,#ecfeff)}
}`;
}

/** Wires the toggle. Include once, before </body>. */
export const NAV_SCRIPT = `<script>
(() => {
  const btn = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.site-nav');
  if (!btn || !nav) return;
  const set = (open) => {
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    set(!nav.classList.contains('open'));
  });
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) set(false);
  });
  document.addEventListener('click', (event) => {
    if (!nav.contains(event.target) && !btn.contains(event.target)) set(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') set(false);
  });
  addEventListener('resize', () => {
    if (getComputedStyle(btn).display === 'none') set(false);
  });
})();
</script>`;
