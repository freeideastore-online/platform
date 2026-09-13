export const AUTH_ERROR_FRAGMENT_SCRIPT = `
(() => {
  const messages = {
    denied: 'Sign-in was cancelled. Choose a provider to try again.',
    invalid_state: 'That sign-in link expired or was already used. Start sign-in again.',
    provider_error: 'The provider did not finish sign-in. Try again in a moment.',
  };
  const fragment = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const reason = new URLSearchParams(fragment).get('auth_error');
  if (!reason) return;
  const message = messages[reason] || 'Sign-in did not finish. Start sign-in again.';
  const host = document.querySelector('[data-auth-error-host]');
  if (host) {
    const banner = document.createElement('div');
    banner.setAttribute('role', 'alert');
    banner.style.cssText = 'margin:0 auto 16px;max-width:760px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;color:#7f1d1d;padding:12px 14px;font:700 14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    banner.textContent = message;
    host.appendChild(banner);
  }
  const clean = new URL(window.location.href);
  clean.hash = '';
  window.history.replaceState(null, '', clean);
})();
`;
