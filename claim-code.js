// Prove a YouTube channel by pasting a code in its description. No Google sign-in.
// window.bvxClaimCode.open({ handle?, channelId?, google?: url, onVerified(v) })
// Steps: 1 your channel -> code, 2 paste it in YouTube Studio, 3 Check. The wallet then signs the usual bind.
(() => {
  const css = `
.bcc{border:1px solid rgba(255,210,77,.35);border-radius:22px;background:#0b0b0c;color:#f4f1e8;padding:0;width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 32px)}
.bcc::backdrop{background:rgba(0,0,0,.8)}
.bcc .bcc-b{padding:22px 20px 20px;overflow:auto;max-height:calc(100dvh - 34px)}
.bcc h2{font:700 24px/1.15 'Space Grotesk',sans-serif;margin:0 44px 6px 0}
.bcc .bcc-l{color:#9a968b;font-size:14px;margin:0 0 16px}
.bcc .bcc-x{position:absolute;right:12px;top:10px;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,210,77,.16);background:#000;color:#f4f1e8;font-size:22px;cursor:pointer}
.bcc ol{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.bcc li{position:relative;border:1px solid rgba(255,210,77,.16);border-radius:16px;padding:14px 14px 14px 56px}
.bcc li .n{position:absolute;left:14px;top:14px;width:30px;height:30px;border-radius:50%;border:1px solid #ffd24d;color:#ffd24d;display:grid;place-items:center;font:700 14px 'Space Grotesk',sans-serif}
.bcc li.done .n{background:#ffd24d;color:#000}
.bcc li.off{opacity:.45}
.bcc h3{font:700 16px 'Space Grotesk',sans-serif;margin:3px 0 6px}
.bcc p{margin:0 0 10px;font-size:14px;color:#cfcabd}
.bcc .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bcc input{flex:1 1 180px;min-width:0;min-height:44px;border-radius:999px;border:1px solid rgba(255,210,77,.35);background:#000;color:#f4f1e8;padding:0 16px;font:500 16px 'IBM Plex Sans',sans-serif}
.bcc input:focus{outline:2px solid #ffd24d;outline-offset:1px}
.bcc .code{flex:1 1 160px;min-height:44px;display:flex;align-items:center;justify-content:center;border:1px dashed #ffd24d;border-radius:12px;font:700 20px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;color:#ffd24d;user-select:all;padding:0 12px}
.bcc .msg{font-size:14px;min-height:0;margin:8px 0 0}.bcc .msg:empty{display:none}
.bcc .msg.bad{color:#ff8a7a}.bcc .msg.ok{color:#ffd24d;font-weight:600}
.bcc .alt{margin:14px 0 0;font-size:13px;color:#9a968b;text-align:center}.bcc .alt a{color:#cfcabd}
.bcc .btn{flex:none}
`;
  let dlg = null, opts = {}, state = {};
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const q = (s) => dlg.querySelector(s);
  const say = (el, t, kind) => { el.textContent = t || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); };
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'That didn’t work. Try again.'); e.code = j.code; throw e; }
    return j;
  };
  function build() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    dlg = document.createElement('dialog'); dlg.className = 'bcc'; dlg.setAttribute('aria-labelledby', 'bccH');
    dlg.innerHTML = `<button class="bcc-x" type="button" aria-label="Close">×</button><div class="bcc-b">
<h2 id="bccH">Prove the channel is yours</h2>
<p class="bcc-l">No Google sign-in. Put a short code in your channel description for a minute, and we read it from YouTube’s public page.</p>
<ol>
<li id="bcc1"><span class="n">1</span><h3>Your channel</h3><p>Your YouTube handle or channel link.</p>
  <form class="row" id="bccF"><input id="bccIn" placeholder="@YourHandle" autocomplete="off" aria-label="YouTube handle or link" required><button class="btn btn-gold" id="bccGet">Get my code</button></form>
  <p class="msg" id="bccM1" aria-live="polite"></p></li>
<li id="bcc2" class="off"><span class="n">2</span><h3>Paste it in your description</h3>
  <p>Copy the code and paste it anywhere in your channel description, then press <b>Publish</b> in YouTube Studio.</p>
  <div class="row"><span class="code" id="bccCode">bvx-········</span><button class="btn btn-ghost" type="button" id="bccCopy" disabled>Copy code</button></div>
  <p style="margin:10px 0 0"><a class="btn btn-ghost" id="bccStudio" href="https://studio.youtube.com/channel/UC/editing/details" target="_blank" rel="noopener">Open YouTube Studio › Customisation › Basic info</a></p>
  <p class="msg" id="bccM2" aria-live="polite"></p></li>
<li id="bcc3" class="off"><span class="n">3</span><h3>Check</h3><p>We look for the code on your channel. The code works for 30 minutes and only for this wallet.</p>
  <div class="row"><button class="btn btn-gold" type="button" id="bccCheck" disabled>Check</button></div>
  <p class="msg" id="bccM3" aria-live="polite"></p></li>
</ol>
<p class="alt" id="bccAlt" hidden><a id="bccGoogle" href="#">Sign in with Google instead</a></p>
</div>`;
    document.body.appendChild(dlg);
    q('.bcc-x').onclick = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    q('#bccF').addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = q('#bccGet'); b.disabled = true; b.textContent = 'Getting…'; say(q('#bccM1'), '');
      try {
        const j = await post('/api/claim/code', { handle: q('#bccIn').value });
        state = j;
        q('#bccCode').textContent = j.code; q('#bccCopy').disabled = false; q('#bccCheck').disabled = false;
        q('#bccStudio').href = j.studioUrl || 'https://studio.youtube.com/channel/UC/editing/details';
        q('#bcc1').classList.add('done'); q('#bcc2').classList.remove('off'); q('#bcc3').classList.remove('off');
        say(q('#bccM1'), `✓ ${j.name || j.handle || 'Channel found'}${j.handle && j.name ? ' (' + j.handle + ')' : ''}`, 'ok');
      } catch (err) {
        say(q('#bccM1'), err.code === 'wallet' ? 'Connect bWalletX first (the code is tied to your wallet), then press Get my code.' : err.message, 'bad');
      }
      b.disabled = false; b.textContent = state.code ? 'New code' : 'Get my code';
    });
    q('#bccCopy').onclick = async () => {
      const code = state.code; if (!code) return;
      try { await navigator.clipboard.writeText(code); say(q('#bccM2'), 'Copied. Now paste it in your description.', 'ok'); }
      catch { const r = document.createRange(); r.selectNodeContents(q('#bccCode')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); say(q('#bccM2'), 'Selected. Copy it, then paste it in your description.'); }
    };
    q('#bccCheck').onclick = async () => {
      const b = q('#bccCheck'); b.disabled = true; b.textContent = 'Checking…'; say(q('#bccM3'), '');
      try {
        const j = await post('/api/claim/check');
        q('#bcc2').classList.add('done'); q('#bcc3').classList.add('done');
        say(q('#bccM3'), `✓ Verified: ${j.verified.name || 'the channel'} is yours. You can delete the code from your description now.`, 'ok');
        b.textContent = 'Continue'; b.disabled = false;
        b.onclick = () => { dlg.close(); opts.onVerified?.(j.verified); };
        return;
      } catch (err) {
        say(q('#bccM3'), err.message, 'bad');
        if (err.code === 'expired') { state = {}; q('#bccCode').textContent = 'bvx-········'; q('#bccCopy').disabled = true; q('#bcc1').classList.remove('done'); q('#bccGet').textContent = 'Get my code'; }
      }
      b.textContent = 'Check'; b.disabled = !state.code;
    };
  }
  window.bvxClaimCode = {
    open(o = {}) {
      if (!dlg) build();
      opts = o;
      if (o.handle && !q('#bccIn').value) q('#bccIn').value = o.handle;
      if (o.channelId && !state.code) q('#bccStudio').href = `https://studio.youtube.com/channel/${encodeURIComponent(o.channelId)}/editing/profile`;
      q('#bccAlt').hidden = !o.google; if (o.google) q('#bccGoogle').href = o.google;
      dlg.showModal();
      if (!q('#bccIn').value) q('#bccIn').focus();
    },
  };
})();
