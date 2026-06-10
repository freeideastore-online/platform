// Related Ideas - FreeIdeaStore
(function () {
  const currentStage = document.body.dataset.stage;
  if (!currentStage) return;

  const registryUrl = new URL('registry.json', document.currentScript ? document.currentScript.src : window.location.href);

  fetch(registryUrl)
    .then((response) => response.json())
    .then((data) => {
      const ideas = data.ideas || [];
      const related = ideas.filter((idea) => idea.stage === currentStage).slice(0, 3);
      if (!related.length) return;

      const bar = document.createElement('aside');
      bar.id = 'related-ideas';
      bar.innerHTML = `
        <style>
          #related-ideas{position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;gap:.5rem;align-items:center;overflow-x:auto;border-top:1px solid #dbe3ef;background:#fff;padding:.65rem 1rem;font-family:Manrope,system-ui,sans-serif}
          #related-ideas strong{color:#64748b;font-size:.72rem;text-transform:uppercase}
          #related-ideas a{border:1px solid #dbe3ef;border-radius:8px;color:#111827;padding:.42rem .65rem;text-decoration:none;white-space:nowrap;font-size:.78rem;font-weight:800}
        </style>
        <strong>Related</strong>
        ${related.map((idea) => `<a href="ideas/${idea.id}/">${idea.name}</a>`).join('')}
      `;
      document.body.appendChild(bar);
    })
    .catch(() => {});
})();
