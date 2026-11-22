/* Familiebudget – selvstændig app (GitHub Pages).
   Erstatter Claude-funktionerne med: lokal lagring i browseren + valgfri synk til en privat GitHub-fil. */
(() => {
  'use strict';
  window.STANDALONE = true;
  const KEY = 'familiebudget.data.v1', CFG = 'familiebudget.sync.v1';
  const clone = o => JSON.parse(JSON.stringify(o));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

  /* ---------- lokal database (samme API-udsnit som appen bruger) ---------- */
  let st = { docs: {}, sha: null, pending: false };
  try { const raw = lsGet(KEY); if (raw) st = Object.assign(st, JSON.parse(raw)); } catch (e) {}
  const persist = () => lsSet(KEY, JSON.stringify(st));
  const listeners = new Set();
  let emitT = null;
  const emit = () => { clearTimeout(emitT); emitT = setTimeout(() => listeners.forEach(f => f()), 0); };
  const live = p => st.docs[p] && !st.docs[p].deleted ? st.docs[p].data : undefined;
  const snapDoc = p => ({ id: p.split('/').pop(), exists: live(p) !== undefined, data: () => clone(live(p)), metadata: { fromCache: false, hasPendingWrites: false } });
  function write(path, data){ st.docs[path] = data === null ? { deleted: true, t: Date.now() } : { data: clone(data), t: Date.now() }; st.pending = true; persist(); emit(); Sync.schedule(); }
  const doc = path => ({
    path, id: path.split('/').pop(),
    get: async () => snapDoc(path),
    set: async d => write(path, d),
    update: async d => write(path, Object.assign({}, live(path) || {}, d)),
    delete: async () => write(path, null),
    onSnapshot(next){ let prev; const f = () => { const s = JSON.stringify(live(path) ?? null); if (s !== prev){ prev = s; next(snapDoc(path)); } }; listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f); },
    collection: sub => collection(path + '/' + sub)
  });
  function collection(path){
    const depth = path.split('/').length + 1;
    const ids = () => Object.keys(st.docs).filter(k => k.startsWith(path + '/') && k.split('/').length === depth && live(k) !== undefined).sort();
    return {
      path, doc: id => doc(path + '/' + (id || Math.random().toString(36).slice(2, 12))),
      add: async d => { const r = doc(path + '/' + Math.random().toString(36).slice(2, 12)); await r.set(d); return r; },
      async get(){ const ds = ids().map(snapDoc); return { docs: ds, size: ds.length, empty: !ds.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; },
      onSnapshot(next){
        let prev = new Map();
        const f = () => {
          const ks = ids(), cur = new Map(ks.map(k => [k, JSON.stringify(live(k))])), changes = [];
          ks.forEach(k => { if (!prev.has(k)) changes.push({ type: 'added', doc: snapDoc(k) }); else if (prev.get(k) !== cur.get(k)) changes.push({ type: 'modified', doc: snapDoc(k) }); });
          [...prev.keys()].forEach(k => { if (!cur.has(k)) changes.push({ type: 'removed', doc: { id: k.split('/').pop(), exists: true, data: () => JSON.parse(prev.get(k)) } }); });
          if (!changes.length && prev.size === cur.size && f.ran) return;
          f.ran = true; prev = cur;
          const ds = ks.map(snapDoc);
          next({ docs: ds, size: ds.length, empty: !ds.length, docChanges: () => changes, metadata: { fromCache: false, hasPendingWrites: false } });
        };
        listeners.add(f); setTimeout(f, 0); return () => listeners.delete(f);
      }
    };
  }
  const db = { doc, collection };

  /* ---------- download af filer ---------- */
  const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', json: 'application/json', csv: 'text/csv' };
  const downloads = {
    async save({ filename, data }){
      const ext = filename.split('.').pop().toLowerCase();
      const blob = data instanceof Blob ? data : new Blob([data], { type: MIME[ext] || 'application/octet-stream' });
      const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
      // På iPhone/iPad: brug del-menuen, så filen kan gemmes i Filer eller åbnes i Excel
      if (file && /iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })){
        try { await navigator.share({ files: [file], title: filename }); return { status: 'saved' }; } catch (e) { if (e && e.name === 'AbortError') throw { code: 'declined' }; }
      }
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { status: 'saved' };
    }
  };

  /* ---------- dokumenter: privat GitHub-repo (med synk) eller kun på enheden ---------- */
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('familiebudget-docs', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const idbDo = async (mode, fn) => { const d = await idb(); return new Promise((res, rej) => { const tx = d.transaction('files', mode); const q = fn(tx.objectStore('files')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); }); };
  const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  const assets = {
    async upload(blob, opts = {}){
      const name = String(blob.name || 'fil').replace(/[^\w.\-æøåÆØÅ]+/g, '_').slice(-80), rid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const type = opts.type || blob.type || 'application/octet-stream';
      if (Sync.cfg){
        const path = 'dokumenter/' + rid + '-' + name;
        const r = await fetch(Sync.urlFor(path), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, Sync.headers()), body: JSON.stringify({ message: 'Dokument: ' + name, content: await blobToB64(blob), branch: Sync.cfg.branch }) });
        if (!r.ok) throw { code: r.status === 422 ? 'too_large' : 'upstream_error' };
        return { id: 'gh:' + path, url: null, sizeBytes: blob.size, contentType: type };
      }
      await idbDo('readwrite', st => st.put(blob, rid));
      return { id: 'idb:' + rid, url: null, sizeBytes: blob.size, contentType: type };
    },
    async resolve(id){
      if (id.startsWith('idb:')){ const b = await idbDo('readonly', st => st.get(id.slice(4))); if (!b) throw new Error('Filen findes kun på den enhed, den blev vedhæftet på'); return URL.createObjectURL(b); }
      if (id.startsWith('gh:')){ if (!Sync.cfg) throw new Error('Synk er ikke slået til'); const r = await fetch(Sync.urlFor(id.slice(3)) + '?ref=' + encodeURIComponent(Sync.cfg.branch), { headers: Object.assign({}, Sync.headers(), { Accept: 'application/vnd.github.raw+json' }), cache: 'no-store' }); if (!r.ok) throw new Error('GitHub ' + r.status); return URL.createObjectURL(await r.blob()); }
      return '/_blob/' + id;
    },
    async delete(id){
      if (id.startsWith('idb:')){ await idbDo('readwrite', st => st.delete(id.slice(4))); return { deleted: true }; }
      if (id.startsWith('gh:') && Sync.cfg){ const u = Sync.urlFor(id.slice(3)); const g = await fetch(u + '?ref=' + encodeURIComponent(Sync.cfg.branch), { headers: Sync.headers(), cache: 'no-store' }); if (!g.ok) return { deleted: false }; const j = await g.json();
        await fetch(u, { method: 'DELETE', headers: Object.assign({ 'Content-Type': 'application/json' }, Sync.headers()), body: JSON.stringify({ message: 'Slet dokument', sha: j.sha, branch: Sync.cfg.branch }) }); return { deleted: true }; }
      return { deleted: false };
    },
    async list(){ return { assets: [], usage: {} }; }
  };

  window.claude = { use: async name => name === 'db' ? db : name === 'downloads' ? downloads : name === 'assets' ? assets : null };

  /* ---------- synk via GitHub ---------- */
  const b64enc = s => { const bytes = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64dec = s => { const bin = atob(s.replace(/\s/g, '')); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); };
  function mergeDocs(a, b){ const out = {}; new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => { const x = a[k], y = b[k]; out[k] = !x ? y : !y ? x : ((x.t || 0) >= (y.t || 0) ? x : y); }); return out; }

  const Sync = {
    cfg: null, status: 'off', msg: '', last: null, busy: false, timer: null,
    load(){ try { this.cfg = JSON.parse(lsGet(CFG) || 'null'); } catch (e) { this.cfg = null; } this.status = this.cfg ? 'idle' : 'off'; },
    save(cfg){ this.cfg = cfg; cfg ? lsSet(CFG, JSON.stringify(cfg)) : (() => { try { localStorage.removeItem(CFG); } catch (e) {} })(); this.status = cfg ? 'idle' : 'off'; ui(); },
    urlFor(path){ const c = this.cfg; return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`; },
    url(){ return this.urlFor(this.cfg.path); },
    headers(){ return { 'Authorization': 'Bearer ' + this.cfg.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; },
    async fetchRemote(){
      const r = await fetch(this.url() + '?ref=' + encodeURIComponent(this.cfg.branch) + '&t=' + Date.now(), { headers: this.headers(), cache: 'no-store' });
      if (r.status === 404){
        const rr = await fetch(`https://api.github.com/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}`, { headers: this.headers(), cache: 'no-store' });
        if (rr.status === 404) throw new Error(`Kan ikke finde repoet "${this.cfg.repo}" hos ${this.cfg.owner}. Tjek stavningen, og at nøglen har adgang til netop det repo (Repository access → Only select repositories).`);
        if (rr.status === 401) throw new Error('Nøglen (token) virker ikke – den er forkert eller udløbet.');
        return { sha: null, docs: {}, missing: true };
      }
      if (r.status === 401) throw new Error('Nøglen (token) virker ikke – den er forkert eller udløbet.');
      if (r.status === 403) throw new Error('Nøglen har ikke adgang til repoet.');
      if (!r.ok) throw new Error('GitHub svarede ' + r.status);
      const j = await r.json();
      let text = j.content ? b64dec(j.content) : null;
      if (text == null && j.download_url){ const r2 = await fetch(j.git_url, { headers: this.headers(), cache: 'no-store' }); const j2 = await r2.json(); text = b64dec(j2.content); }
      const data = JSON.parse(text || '{}');
      return { sha: j.sha, docs: data.docs || {} };
    },
    async put(docs, sha){
      const body = { message: 'Budget opdateret ' + new Date().toLocaleString('da-DK'), content: b64enc(JSON.stringify({ app: 'familiebudget', version: 1, updated: new Date().toISOString(), docs }, null, 1)), branch: this.cfg.branch };
      if (sha) body.sha = sha;
      const r = await fetch(this.url(), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, this.headers()), body: JSON.stringify(body) });
      if (r.status === 409 || r.status === 422) return null; // nogen andre har gemt imens
      if (r.status === 401 || r.status === 403) throw new Error('Nøglen har ikke skriveadgang til repoet (Contents: Read and write).');
      if (!r.ok) throw new Error('GitHub svarede ' + r.status);
      const j = await r.json(); return j.content.sha;
    },
    async run(){
      if (!this.cfg || this.busy) return; if (!navigator.onLine){ this.status = 'offline'; ui(); return; }
      this.busy = true; this.status = 'syncing'; ui();
      try {
        for (let attempt = 0; attempt < 4; attempt++){
          const remote = await this.fetchRemote();
          const merged = mergeDocs(st.docs, remote.docs);
          const localChanged = JSON.stringify(merged) !== JSON.stringify(st.docs);
          const remoteNeeds = JSON.stringify(merged) !== JSON.stringify(remote.docs);
          st.docs = merged; st.sha = remote.sha; persist(); if (localChanged) emit();
          this.empty = !!remote.missing && !Object.keys(merged).length;
          if (!remoteNeeds){ st.pending = false; persist(); break; }
          const sha = await this.put(merged, remote.sha);
          if (sha){ st.sha = sha; st.pending = false; persist(); break; }
        }
        this.status = this.empty ? 'empty' : 'ok'; this.msg = this.empty ? `Filen "${this.cfg.path}" findes ikke i ${this.cfg.repo} endnu.` : ''; this.last = new Date();
      } catch (e){ this.status = 'error'; this.msg = e.message || String(e); }
      this.busy = false; ui();
      if (st.pending && this.status === 'ok') this.schedule();
    },
    schedule(delay = 2500){ if (!this.cfg) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), delay); if (this.status !== 'syncing'){ this.status = 'pending'; ui(); } }
  };
  window.FamiliebudgetSync = Sync;

  /* ---------- UI: synk-knap og opsætning ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function label(){
    const t = Sync.last ? Sync.last.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }) : '';
    return { off: ['☁︎', 'Synk ikke slået til'], idle: ['☁︎', 'Synk'], pending: ['☁︎', 'Gemmer…'], syncing: ['⟳', 'Synkroniserer…'], ok: ['☁︎', 'Synkroniseret ' + t], offline: ['☁︎', 'Offline – gemmes senere'], error: ['⚠', 'Synk-fejl'], empty: ['⚠', 'Ingen data på GitHub endnu'] }[Sync.status];
  }
  function ui(){
    const b = document.getElementById('syncBtn'); if (!b) return;
    const [ic, tx] = label(); b.innerHTML = `<span aria-hidden="true">${ic}</span><span class="sb-t">${esc(tx)}</span>`;
    b.title = Sync.msg || tx; b.classList.toggle('err', Sync.status === 'error' || Sync.status === 'empty'); b.classList.toggle('off', Sync.status === 'off');
  }
  function addButton(){
    const top = document.querySelector('.top'); if (!top || document.getElementById('syncBtn')) return;
    const b = document.createElement('button'); b.id = 'syncBtn'; b.className = 'btn small syncbtn'; b.type = 'button';
    b.addEventListener('click', openSetup);
    top.insertBefore(b, document.getElementById('yearSel'));
    const css = document.createElement('style');
    css.textContent = `.syncbtn{gap:6px}.syncbtn.err{color:var(--crit-ink);border-color:var(--crit)}.syncbtn.off{color:var(--ink-3)}
      @media (max-width:899px){.syncbtn .sb-t{display:none}.top .sync{display:none}}
      #syncModal{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;padding:20px}
      #syncModal .sheet{max-width:560px;margin:0}#syncModal ol{padding-left:20px;margin:6px 0;color:var(--ink-2);font-size:13.5px}#syncModal li{margin:3px 0}
      @media (max-width:640px){#syncModal{align-items:flex-end;padding:0}}`;
    document.head.appendChild(css); ui();
  }
  function openSetup(){
    const c = Sync.cfg || { owner: '', repo: 'familiebudget-data', branch: 'main', path: 'budget-data.json', token: '' };
    const m = document.createElement('div'); m.id = 'syncModal';
    m.innerHTML = `<form class="sheet" id="sgForm" role="dialog" aria-modal="true" autocomplete="on" action="#" method="post"><h2>Synk mellem mobil og PC</h2>
      ${storageOK() ? '' : '<div class="banner err">Browseren må ikke gemme data for denne side, så indstillingerne glemmes, når appen lukkes. Tillad cookies/webstedsdata for henrikfriisthuesen-bit.github.io i browserens indstillinger.</div>'}
      <p class="muted" style="margin:0 0 10px">Budgettet gemmes altid på denne enhed. Med synk gemmes det også i en <b>privat</b> fil på GitHub, så I ser de samme tal på alle enheder.</p>
      ${Sync.status === 'error' ? `<div class="banner err">${esc(Sync.msg)}</div>` : Sync.status === 'empty' ? `<div class="banner err">Forbindelsen virker, men ${esc(Sync.msg)} Upload <b>budget-data.json</b> til roden af repoet – eller luk dette vindue, tryk <b>Gendan fra sikkerhedskopi</b> og vælg filen. Så sendes den automatisk til GitHub.</div>` : Sync.cfg ? `<div class="banner">${esc(label()[1])}</div>` : ''}
      <div class="row2"><label class="field">GitHub-brugernavn<input class="inp" id="sgOwner" name="username" autocomplete="username" value="${esc(c.owner)}" autocapitalize="off" autocorrect="off"></label>
      <label class="field">Privat data-repo<input class="inp" id="sgRepo" value="${esc(c.repo)}" autocapitalize="off" autocorrect="off"></label></div>
      <div class="row2" style="margin-top:8px"><label class="field">Gren<input class="inp" id="sgBranch" value="${esc(c.branch)}" autocapitalize="off"></label>
      <label class="field">Filnavn<input class="inp" id="sgPath" value="${esc(c.path)}" autocapitalize="off"></label></div>
      <label class="field" style="margin-top:8px">Adgangsnøgle (fine-grained token)<input class="inp" id="sgToken" name="password" type="password" value="${esc(c.token)}" autocomplete="current-password" placeholder="github_pat_…"></label>
      <details class="fold" style="margin-top:10px"><summary>Sådan laver du nøglen</summary><ol>
        <li>Opret et <b>privat</b> repo på GitHub, fx <i>familiebudget-data</i> (sæt flueben i “Add a README”).</li>
        <li>Gå til GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
        <li>Repository access: <b>Only select repositories</b> → vælg data-repoet.</li>
        <li>Permissions → Repository → <b>Contents: Read and write</b>. Vælg en udløbsdato (fx 1 år).</li>
        <li>Kopiér nøglen og indsæt den her. Gør det samme på mobil, PC og Majbrits telefon.</li></ol>
        <p class="muted" style="font-size:12.5px">Nøglen gemmes kun i denne browser og sendes kun til GitHub.</p></details>
      <p class="muted" style="font-size:12.5px;margin:8px 0 0">Tip: Når du trykker “Gem og synk”, tilbyder browseren at gemme brugernavn og nøgle som en adgangskode. Så udfyldes de automatisk næste gang.</p>
      <div class="acts">${Sync.cfg ? '<button type="button" class="btn danger" id="sgOff">Slå synk fra</button>' : ''}<span class="sp"></span><button type="button" class="btn" id="sgClose">Luk</button>${Sync.cfg ? '<button type="button" class="btn" id="sgNow">Synk nu</button>' : ''}<button type="submit" class="btn primary" id="sgSave">Gem og synk</button></div></form>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('mousedown', e => { if (e.target === m) close(); });
    m.querySelector('#sgClose').onclick = close;
    const off = m.querySelector('#sgOff'); if (off) off.onclick = () => { Sync.save(null); close(); };
    const now = m.querySelector('#sgNow'); if (now) now.onclick = async () => { close(); await Sync.run(); };
    m.querySelector('#sgForm').onsubmit = async ev => { ev.preventDefault();
      const v = id => m.querySelector(id).value.trim();
      const cfg = { owner: v('#sgOwner'), repo: v('#sgRepo'), branch: v('#sgBranch') || 'main', path: v('#sgPath') || 'budget-data.json', token: v('#sgToken') };
      if (!cfg.owner || !cfg.repo || !cfg.token){ alertIn(m, 'Udfyld brugernavn, repo og nøgle.'); return; }
      Sync.save(cfg); askPersist(); m.querySelector('#sgSave').textContent = 'Forbinder…';
      await Sync.run();
      if (Sync.status === 'error'){ m.querySelector('#sgSave').textContent = 'Gem og synk'; alertIn(m, Sync.msg); } else close();
    };
  }
  function storageOK(){ const k = 'familiebudget.probe'; if (!lsSet(k, '1')) return false; const ok = lsGet(k) === '1'; try { localStorage.removeItem(k); } catch (e) {} return ok; }
  function askPersist(){ try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {} }
  function alertIn(m, text){ let b = m.querySelector('.banner'); if (!b){ b = document.createElement('div'); m.querySelector('h2').after(b); } b.className = 'banner err'; b.textContent = text; }

  document.addEventListener('click', e => { if (e.target.closest('[data-act="syncSetup"]')){ e.preventDefault(); openSetup(); } });

  /* ---------- ny version ---------- */
  const APP_VERSION = 'familiebudget-v17';
  let verShown = false, verChecked = 0;
  async function checkVersion(){
    if (verShown || !navigator.onLine || Date.now() - verChecked < 5 * 60e3) return; verChecked = Date.now();
    try { const t = await fetch('sw.js?v=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.text() : ''); const m = t.match(/VERSION\s*=\s*'([^']+)'/);
      if (m && m[1] !== APP_VERSION) showUpdate(m[1]); } catch (e) {}
  }
  function showUpdate(v){
    verShown = true; const d = document.createElement('div'); d.id = 'verBar';
    d.innerHTML = `<span>Der er en ny version af appen.</span><button class="btn small primary" type="button">Opdatér nu</button><button class="btn small ghost" type="button" aria-label="Senere">Senere</button>`;
    d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));z-index:70;background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:var(--shadow);border-radius:12px;padding:10px 12px;display:flex;gap:10px;align-items:center;font-size:14px;max-width:calc(100vw - 24px)';
    const [up, later] = d.querySelectorAll('button');
    later.onclick = () => d.remove();
    up.onclick = async () => { up.textContent = 'Henter…'; up.disabled = true;
      try { await Promise.all(['./', 'index.html', 'standalone.js', 'sw.js', 'manifest.webmanifest'].map(f => fetch(f, { cache: 'reload' }).catch(() => {})));
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update().catch(() => {});
        if (window.caches) for (const k of await caches.keys()) if (k.startsWith('familiebudget-v')) await caches.delete(k);
      } catch (e) {}
      location.reload(); };
    document.body.appendChild(d);
  }
  setTimeout(checkVersion, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
  setInterval(checkVersion, 30 * 60e3);
  Sync.load(); if (Sync.cfg) askPersist();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton); else addButton();
  window.addEventListener('online', () => Sync.run());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.run(); else if (st.pending && Sync.cfg) Sync.run(); });
  setInterval(() => { if (document.visibilityState === 'visible') Sync.run(); }, 60000);
  if (Sync.cfg) setTimeout(() => Sync.run(), 300);

  /* ---------- notifikationer og app-ikon-mærke ---------- */
  const NKEY = 'familiebudget.notify.v1';
  const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator;
  const permOK = async () => { if (!('Notification' in window)) return false; if (Notification.permission === 'granted') return true; try { return (await navigator.permissions.query({ name: 'notifications' })).state === 'granted'; } catch (e) { return false; } };
  window.FBReminders = async items => {
    try { if (navigator.setAppBadge){ items.length ? await navigator.setAppBadge(items.length) : await navigator.clearAppBadge(); } } catch (e) {}
    if (!canNotify() || lsGet(NKEY) !== 'on' || !items.length || !(await permOK())) return;
    const today = new Date().toISOString().slice(0, 10), sig = today + '|' + items.join('|');
    if (lsGet(NKEY + '.last') === sig || (lsGet(NKEY + '.day') === today && lsGet(NKEY + '.count') === String(items.length))) return;
    lsSet(NKEY + '.last', sig); lsSet(NKEY + '.day', today); lsSet(NKEY + '.count', String(items.length));
    try { const reg = await navigator.serviceWorker.ready; reg.showNotification('Familiebudget', { body: items.slice(0, 3).join('\n') + (items.length > 3 ? `\n+${items.length - 3} mere` : ''), icon: 'icon-192.png', badge: 'icon-192.png', tag: 'familiebudget', data: { url: './#oversigt' } }); } catch (e) {}
  };
  async function enableNotify(btn){
    if (!canNotify()){ alertBox('Denne browser understøtter ikke notifikationer. På iPhone skal appen først lægges på hjemmeskærmen (Del → Føj til hjemmeskærm) og åbnes derfra.'); return; }
    if (lsGet(NKEY) === 'on' && await permOK()){ lsSet(NKEY, 'off'); try { const reg = await navigator.serviceWorker.ready; if (reg.periodicSync) await reg.periodicSync.unregister('familiebudget-maaned'); } catch (e) {} bell(); alertBox('Notifikationer er slået fra.'); return; }
    const p = await Notification.requestPermission();
    if (p !== 'granted' && !(await permOK())){ alertBox('Notifikationer blev ikke tilladt. Du kan slå dem til i telefonens indstillinger for appen.'); return; }
    lsSet(NKEY, 'on'); let bg = false;
    try { const reg = await navigator.serviceWorker.ready; if (reg.periodicSync){ await reg.periodicSync.register('familiebudget-maaned', { minInterval: 24 * 60 * 60 * 1000 }); bg = true; } reg.showNotification('Familiebudget', { body: 'Notifikationer er slået til ✓', icon: 'icon-192.png', tag: 'familiebudget-test' }).catch(() => {}); } catch (e) {}
    const bb = document.getElementById('bellBtn'); if (bb) bb.dataset.ok = '1'; bell(); alertBox('Notifikationer er slået til. Du får besked, når du åbner appen og der er noget på huskelisten' + (bg ? ', og den 3.–10. i hver måned om at afstemme – også når appen er lukket.' : '. App-ikonet viser antallet af punkter på huskelisten.'));
  }
  function alertBox(t){ const el = document.getElementById('toast'); if (el){ el.textContent = t; el.classList.add('on'); clearTimeout(el.__t); el.__t = setTimeout(() => el.classList.remove('on'), 5000); } }
  function bell(){ const b = document.getElementById('bellBtn'); if (!b) return; const on = lsGet(NKEY) === 'on' && 'Notification' in window && Notification.permission !== 'denied' || (lsGet(NKEY) === 'on' && b.dataset.ok === '1'); b.textContent = on ? '🔔' : '🔕'; b.title = on ? 'Notifikationer er slået til (tryk for at slå fra)' : 'Slå notifikationer til'; }
  function addBell(){ const top = document.querySelector('.top'); if (!top || document.getElementById('bellBtn')) return; const b = document.createElement('button'); b.id = 'bellBtn'; b.className = 'btn small ghost'; b.type = 'button'; b.setAttribute('aria-label', 'Notifikationer'); b.addEventListener('click', () => enableNotify(b)); top.insertBefore(b, document.getElementById('syncBtn') || document.getElementById('yearSel')); bell(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addBell); else addBell();

  /* ---------- offline-cache ---------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
