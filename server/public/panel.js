// Keizu Server panel: a small page for accounts, devices and pairing codes.
// The token lives in sessionStorage, so closing the tab signs out.
'use strict';

const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('keizu-panel-token') || '';
let me = null;

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api/v1' + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && path !== '/auth/login') {
    signOut();
    throw new Error('Oturum kapandı.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error((data && data.message) || res.statusText);
  return data;
}

const fmtDate = (s) => (s ? new Date(s).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '');

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c instanceof Node ? c : String(c ?? ''));
  return e;
}

function signOut() {
  token = '';
  sessionStorage.removeItem('keizu-panel-token');
  me = null;
  show();
}

const inviteToken = () => (location.hash.match(/^#davet=([\w-]+)/) || [])[1];

async function showInvite(tok) {
  $('login').hidden = true;
  $('app').hidden = true;
  $('invite').hidden = false;
  try {
    const inv = await api('/invites/' + tok);
    const reset = inv.kind === 'reset';
    $('inv-title').textContent = reset ? `Yeni şifre belirle (${inv.username})` : inv.admin ? 'Yönetici hesabını oluştur' : 'Keizu hesabını oluştur';
    $('inv-intro').textContent = reset
      ? 'Bu link yalnız bir kez kullanılabilir. Yeni şifreni seç; tüm cihazlarının oturumu kapanır ve yeniden bağlanman gerekir.'
      : 'Bu davet linki yalnız bir kez kullanılabilir. Kullanıcı adını ve şifreni sen seç; şifreni kimse (sunucu yöneticisi de) göremez.';
    $('inv-user-label').hidden = reset;
    $('invite-form').username.required = !reset;
    $('inv-submit').textContent = reset ? 'Şifreyi kaydet' : 'Hesabı oluştur';
  } catch (err) {
    $('invite-form').hidden = true;
    $('inv-err').textContent = err.message;
    $('invite-form').after($('inv-err'));
  }
}

async function show() {
  const info = await fetch('/.well-known/keizu').then((r) => r.json()).catch(() => null);
  if (info) $('ver').textContent = 'v' + info.version;
  $('invite').hidden = true;
  const tok = inviteToken();
  if (tok) return showInvite(tok);
  if (!token) {
    $('login').hidden = false;
    $('app').hidden = true;
    $('logout').hidden = true;
    $('who').textContent = '';
    return;
  }
  try {
    me = await api('/me');
  } catch {
    return;
  }
  $('login').hidden = true;
  $('app').hidden = false;
  $('logout').hidden = false;
  $('who').textContent = me.user.username;
  const used = (me.usedBytes / 1048576).toFixed(1);
  $('usage').textContent = me.quotaBytes ? `Kullanım: ${used} MB / ${Math.round(me.quotaBytes / 1048576)} MB` : `Kullanım: ${used} MB (kota yok)`;
  $('admin').hidden = !me.user.admin;
  loadDevices();
  loadTrash();
  if (me.user.admin) {
    loadUsers();
    loadInvites();
  }
}

async function loadInvites() {
  const { invites } = await api('/admin/invites');
  $('invites').replaceChildren(
    ...(invites.length ? invites.map((i) =>
      el('tr', {}, el('td', {}, i.kind === 'reset' ? 'Şifre sıfırlama' : i.admin ? 'Yönetici daveti' : 'Davet'), el('td', {}, i.username || i.note || ''), el('td', {}, fmtDate(i.expiresAt)),
        el('td', {}, el('button', { class: 'btn link danger', onclick: async () => { await api('/admin/invites/' + i.id, { method: 'DELETE' }); loadInvites(); } }, 'İptal et')))) : [el('tr', {}, el('td', { class: 'muted', colspan: '4' }, 'Bekleyen davet yok.'))]),
  );
}

function showLink(link, msg) {
  $('add-out').hidden = false;
  $('add-link').textContent = link;
  $('add-msg').className = 'small okc';
  $('add-msg').textContent = msg;
}
$('add-copy').addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText($('add-link').textContent).then(() => { $('add-copy').textContent = 'Kopyalandı'; setTimeout(() => { $('add-copy').textContent = 'Kopyala'; }, 1500); }));

async function loadDevices() {
  const { devices } = await api('/devices');
  $('devices').replaceChildren(
    ...devices.map((d) =>
      el('tr', {}, el('td', {}, d.device, d.current ? ' (bu tarayıcı)' : ''), el('td', {}, fmtDate(d.createdAt)), el('td', {}, fmtDate(d.lastUsedAt)),
        el('td', {}, d.current ? '' : el('button', { class: 'btn link danger', onclick: async () => { if (confirm(`"${d.device}" cihazının erişimi kaldırılsın mı?`)) { await api('/devices/' + d.id, { method: 'DELETE' }); loadDevices(); } } }, 'Erişimi kaldır')))),
  );
}

async function loadTrash() {
  const { maps } = await api('/trash');
  $('trash').replaceChildren(
    ...(maps.length ? maps.map((m) =>
      el('tr', {}, el('td', {}, m.title || m.id), el('td', {}, fmtDate(m.deletedAt)),
        el('td', {}, el('button', { class: 'btn link', onclick: async () => { await api(`/maps/${encodeURIComponent(m.id)}/restore`, { method: 'POST' }); loadTrash(); } }, 'Geri yükle')))) : [el('tr', {}, el('td', { class: 'muted', colspan: '3' }, 'Çöp kutusu boş.'))]),
  );
}

async function loadUsers() {
  const { users, storage } = await api('/admin/users');
  const gb = (mb) => (mb / 1024).toFixed(1) + ' GB';
  $('storage').textContent = `Sunucuda kullanılan: ${gb(storage.usedMb)}${storage.limitMb ? ' / ' + gb(storage.limitMb) : ''}` +
    (storage.diskFreeMb !== undefined ? ` · diskte boş: ${gb(storage.diskFreeMb)}` : '') +
    ` · görsel sınırı: ${storage.maxImageMb || '∞'} MB · varsayılan kota: ${storage.defaultQuotaMb ? gb(storage.defaultQuotaMb) : 'yok'}`;
  $('add-form').quota.placeholder = String(storage.defaultQuotaMb);
  $('users').replaceChildren(
    ...users.map((u) => {
      const quota = el('input', { type: 'number', min: '0', value: String(u.quotaMb), 'aria-label': `${u.username} kotası` });
      quota.addEventListener('change', () => api('/admin/users/' + u.id, { method: 'PATCH', body: { quotaMb: Number(quota.value) } }));
      return el('tr', {}, el('td', {}, u.username, u.admin ? ' ' : '', u.admin ? el('span', { class: 'badge' }, 'yönetici') : ''),
        el('td', {}, u.maps), el('td', {}, `${u.usedMb} MB`), el('td', {}, quota), el('td', {}, u.devices),
        el('td', {},
          el('button', { class: 'btn link', onclick: async () => { const r = await api('/admin/users/' + u.id, { method: 'PATCH', body: { resetPassword: true } }); showLink(r.resetLink, `${u.username} için şifre sıfırlama linki (7 gün, tek kullanımlık). Yeni şifreyi kendisi seçecek.`); loadInvites(); } }, 'Sıfırlama linki'),
          u.id === me.user.id ? '' : el('button', { class: 'btn link danger', onclick: async () => { if (!confirm(`${u.username} ve tüm haritaları silinsin mi? Geri alınamaz.`)) return; await api('/admin/users/' + u.id, { method: 'DELETE' }); loadUsers(); } }, 'Sil')));
    }),
  );
}

let pairTimer = 0;
$('pair').addEventListener('click', async () => {
  const p = await api('/pair-codes', { method: 'POST' });
  $('pair-out').hidden = false;
  $('pair-code').textContent = p.code.slice(0, 3) + ' ' + p.code.slice(3);
  $('pair-qr').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(p.qrSvg);
  $('pair-server').textContent = p.server;
  clearInterval(pairTimer);
  const tick = () => {
    const s = Math.max(0, Math.round((Date.parse(p.expiresAt) - Date.now()) / 1000));
    $('pair-exp').textContent = s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} içinde geçersiz olur · tek kullanımlık` : 'Süresi doldu, yeni kod üret.';
    if (!s) clearInterval(pairTimer);
  };
  tick();
  pairTimer = setInterval(tick, 1000);
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('login-err').textContent = '';
  try {
    const r = await api('/auth/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password'), device: 'Panel (tarayıcı)' } });
    token = r.token;
    sessionStorage.setItem('keizu-panel-token', token);
    e.target.reset();
    show();
  } catch (err) {
    $('login-err').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  signOut();
});

$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const r = await api('/me/password', { method: 'PUT', body: { current: f.get('current'), next: f.get('next') } });
    token = r.token;
    sessionStorage.setItem('keizu-panel-token', token);
    e.target.reset();
    $('pw-msg').className = 'small okc';
    $('pw-msg').textContent = 'Şifre değişti. Diğer cihazlarda yeniden bağlanman gerekecek.';
    loadDevices();
  } catch (err) {
    $('pw-msg').className = 'small err';
    $('pw-msg').textContent = err.message;
  }
});

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const r = await api('/admin/invites', { method: 'POST', body: { note: f.get('note'), quotaMb: f.get('quota') === '' ? undefined : Number(f.get('quota')), admin: f.get('admin') === 'on' } });
    showLink(r.link, 'Davet linki hazır (7 gün geçerli, tek kullanımlık). Kişiye gönder.');
    e.target.reset();
    loadInvites();
  } catch (err) {
    $('add-msg').className = 'small err';
    $('add-msg').textContent = err.message;
  }
});

$('invite-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('inv-err').textContent = '';
  if (f.get('password') !== f.get('password2')) return ($('inv-err').textContent = 'Şifreler aynı değil.');
  try {
    const r = await api('/invites/' + inviteToken(), { method: 'POST', body: { username: f.get('username'), password: f.get('password'), device: 'Panel (tarayıcı)' } });
    token = r.token;
    sessionStorage.setItem('keizu-panel-token', token);
    history.replaceState(null, '', location.pathname);
    e.target.reset();
    $('welcome').hidden = false;
    $('welcome-server').textContent = location.host;
    show();
  } catch (err) {
    $('inv-err').textContent = err.message;
  }
});

$('backup').addEventListener('click', async () => {
  const res = await fetch('/api/v1/admin/backup', { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return alert('Yedek alınamadı.');
  const url = URL.createObjectURL(await res.blob());
  const a = el('a', { href: url, download: `keizu-yedek-${new Date().toISOString().slice(0, 10)}.db` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

show();
