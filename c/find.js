// "Enter your YouTube handle" box: resolves via /api/channel?handle= and opens /c/<slug> (or its claim page).
document.querySelectorAll('[data-find]').forEach((f) => f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = f.parentElement.querySelector('[data-find-msg]'), btn = f.querySelector('button');
  const h = f.h.value.trim(); if (!h) return;
  btn.disabled = true; msg.textContent = 'Looking up ' + h + '…';
  try {
    const r = await fetch('/api/channel?handle=' + encodeURIComponent(h)); const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Not found');
    location.href = '/c/' + encodeURIComponent(j.channel.slug) + (f.dataset.to === 'claim' ? '' : '');
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
}));
