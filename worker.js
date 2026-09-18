export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-password"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (path === "/" || path === "/admin") {
      return new Response(ADMIN_HTML, {
        headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-store" }
      });
    }

    if (path === "/api/generate" && request.method === "POST") {
      const pass = request.headers.get("x-admin-password");
      if (pass !== env.ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401, cors);
      const body = await request.json();
      const gameSlug = body.gameSlug || "ular-tangga-cinta";
      const game = await env.DB.prepare("SELECT id FROM games WHERE slug = ?").bind(gameSlug).first();
      if (!game) return json({ error: "Game tidak ditemukan" }, 404, cors);
      const code = generateCode();
      await env.DB.prepare("INSERT INTO codes (code, game_id, status) VALUES (?, ?, 'UNUSED')").bind(code, game.id).run();
      return json({ code }, 200, cors);
    }

    if (path === "/api/codes" && request.method === "GET") {
      const pass = request.headers.get("x-admin-password");
      if (pass !== env.ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401, cors);
      const { results } = await env.DB.prepare(
        `SELECT codes.id, codes.code, codes.status, codes.device_id, codes.device_name, codes.activated_at, games.name as game_name, games.slug as game_slug
         FROM codes JOIN games ON codes.game_id = games.id
         ORDER BY codes.id DESC LIMIT 1000`
      ).all();
      return json({ codes: results }, 200, cors);
    }

    // ====== API: DAFTAR GAME UNTUK MENU (publik, tanpa password) ======
    if (path === "/api/games-list" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT name, slug, theme_color, available FROM games ORDER BY id ASC`
      ).all();
      return json({ games: results }, 200, cors);
    }

    if (path === "/api/games" && request.method === "GET") {
      const pass = request.headers.get("x-admin-password");
      if (pass !== env.ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401, cors);
      const { results } = await env.DB.prepare(`SELECT id, name, slug FROM games ORDER BY name ASC`).all();
      return json({ games: results }, 200, cors);
    }

    if (path === "/api/admin/game-content" && request.method === "GET") {
      const pass = request.headers.get("x-admin-password");
      if (pass !== env.ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401, cors);
      const slug = url.searchParams.get("gameSlug");
      const game = await env.DB.prepare("SELECT content FROM games WHERE slug = ?").bind(slug).first();
      if (!game) return json({ error: "Game tidak ditemukan" }, 404, cors);
      return json({ content: game.content ? JSON.parse(game.content) : {} }, 200, cors);
    }

    if (path === "/api/admin/game-content" && request.method === "POST") {
      const pass = request.headers.get("x-admin-password");
      if (pass !== env.ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401, cors);
      const body = await request.json();
      const { gameSlug, content } = body;
      if (!gameSlug || !content) return json({ error: "Data tidak lengkap" }, 400, cors);
      await env.DB.prepare("UPDATE games SET content = ? WHERE slug = ?").bind(JSON.stringify(content), gameSlug).run();
      return json({ success: true }, 200, cors);
    }

    if (path === "/api/get-content" && request.method === "GET") {
      const deviceId = url.searchParams.get("deviceId");
      const gameSlug = url.searchParams.get("gameSlug");
      if (!deviceId || !gameSlug) return json({ error: "Data tidak lengkap" }, 400, cors);
      const row = await env.DB.prepare(
        `SELECT games.content FROM codes JOIN games ON codes.game_id = games.id
         WHERE codes.device_id = ? AND codes.status = 'ACTIVATED' AND games.slug = ? LIMIT 1`
      ).bind(deviceId, gameSlug).first();
      if (!row) return json({ error: "Device belum teraktivasi untuk game ini" }, 403, cors);
      return json({ content: row.content ? JSON.parse(row.content) : {} }, 200, cors);
    }

    if (path === "/api/activate" && request.method === "POST") {
      const body = await request.json();
      const { code, deviceId, deviceName } = body;
      if (!code || !deviceId) return json({ success: false, message: "Data tidak lengkap" }, 400, cors);
      const row = await env.DB.prepare("SELECT * FROM codes WHERE code = ?").bind(code.trim().toUpperCase()).first();
      if (!row) return json({ success: false, message: "Kode tidak valid" }, 404, cors);
      if (row.status === "ACTIVATED") {
        if (row.device_id === deviceId) return json({ success: true, message: "Sudah aktif di device ini" }, 200, cors);
        return json({ success: false, message: "Kode sudah dipakai di device lain" }, 403, cors);
      }
      await env.DB.prepare("UPDATE codes SET status = 'ACTIVATED', device_id = ?, device_name = ?, activated_at = datetime('now') WHERE id = ?").bind(deviceId, deviceName || null, row.id).run();
      return json({ success: true, message: "Aktivasi berhasil" }, 200, cors);
    }

    if (path === "/api/check-device" && request.method === "GET") {
      const deviceId = url.searchParams.get("deviceId");
      if (!deviceId) return json({ activated: false }, 200, cors);
      const row = await env.DB.prepare("SELECT id FROM codes WHERE device_id = ? AND status = 'ACTIVATED' LIMIT 1").bind(deviceId).first();
      return json({ activated: !!row }, 200, cors);
    }

    return json({ error: "Not found" }, 404, cors);
  }
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `LD-${part()}-${part()}-${part()}`;
}

const ADMIN_HTML = `
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LoveDare Admin Panel</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
  body { background: #0b0b14; color: #e5e7eb; }

  /* LOGIN */
  .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .login-box { width: 100%; max-width: 380px; background: #14141f; padding: 32px 28px; border-radius: 20px; box-shadow: 0 0 40px rgba(168,85,247,0.15); border: 1px solid #232336; }
  .login-box .logo { font-size: 1.5rem; font-weight: 800; margin-bottom: 4px; }
  .login-box .logo span:first-child { color: #ec4899; }
  .login-box p.sub { color: #8b8b9e; font-size: 0.85rem; margin-bottom: 20px; }
  .login-box input { width: 100%; padding: 13px 14px; margin-bottom: 12px; border-radius: 10px; border: 1px solid #2a2a3d; background: #0b0b14; color: #eee; font-size: 0.95rem; }
  .login-box button { width: 100%; padding: 13px; border: none; border-radius: 10px; background: linear-gradient(135deg,#a855f7,#ec4899); color: white; font-weight: 700; cursor: pointer; font-size: 0.95rem; }
  .login-err { color: #f87171; font-size: 0.85rem; margin-top: 10px; text-align: center; }

  /* LAYOUT */
  #app { display: none; }
  .layout { display: flex; min-height: 100vh; }
  .sidebar { width: 240px; background: #10101a; border-right: 1px solid #1e1e2e; padding: 20px 16px; display: flex; flex-direction: column; flex-shrink: 0; }
  .sidebar .logo { font-size: 1.3rem; font-weight: 800; margin-bottom: 28px; padding: 0 8px; }
  .sidebar .logo span:first-child { color: #ec4899; }
  .navitem { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border-radius: 10px; color: #9ca3af; cursor: pointer; margin-bottom: 4px; font-size: 0.9rem; font-weight: 600; }
  .navitem:hover { background: #1a1a29; color: #e5e7eb; }
  .navitem.active { background: linear-gradient(135deg, rgba(168,85,247,0.25), rgba(236,72,153,0.25)); color: #fff; border: 1px solid rgba(168,85,247,0.4); }
  .navitem .ic { font-size: 1.05rem; }
  .promo-card { margin-top: auto; background: linear-gradient(160deg, #3b0f2e, #1a0b2e); border-radius: 16px; padding: 20px 16px; border: 1px solid #3a2050; }
  .promo-card .heart { font-size: 1.8rem; margin-bottom: 8px; }
  .promo-card h4 { font-size: 1.05rem; margin-bottom: 4px; }
  .promo-card p { font-size: 0.78rem; color: #c4b5d8; line-height: 1.4; }
  .sidebar-footer { font-size: 0.72rem; color: #55556b; margin-top: 16px; padding: 0 8px; }

  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-bottom: 1px solid #1e1e2e; gap: 16px; }
  .search-box { flex: 1; max-width: 420px; display: flex; align-items: center; gap: 8px; background: #14141f; border: 1px solid #232336; border-radius: 10px; padding: 9px 14px; color: #6b7280; }
  .search-box input { background: transparent; border: none; outline: none; color: #eee; flex: 1; font-size: 0.88rem; }
  .top-right { display: flex; align-items: center; gap: 16px; color: #9ca3af; }
  .admin-chip { display: flex; align-items: center; gap: 10px; }
  .avatar { width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg,#a855f7,#ec4899); display: flex; align-items: center; justify-content: center; font-size: 1rem; }
  .admin-chip .name { font-size: 0.85rem; font-weight: 700; color: #fff; }
  .admin-chip .role { font-size: 0.72rem; color: #8b8b9e; }
  .logout-btn { font-size: 0.75rem; color: #f87171; cursor: pointer; background: none; border: none; margin-left: 8px; }

  .content { padding: 24px; overflow-y: auto; }
  .page-title { font-size: 1.6rem; font-weight: 800; margin-bottom: 4px; }
  .page-sub { color: #8b8b9e; font-size: 0.88rem; margin-bottom: 22px; }

  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 20px; }
  .stat-card { background: #14141f; border: 1px solid #232336; border-radius: 14px; padding: 18px; }
  .stat-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.15rem; margin-bottom: 10px; }
  .stat-label { font-size: 0.8rem; color: #8b8b9e; margin-bottom: 2px; }
  .stat-value { font-size: 1.5rem; font-weight: 800; color: #fff; }

  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  select#filterGame { background: #14141f; border: 1px solid #232336; color: #e5e7eb; padding: 10px 14px; border-radius: 10px; font-size: 0.85rem; }
  .btn-gradient { background: linear-gradient(135deg,#a855f7,#ec4899); color: white; border: none; padding: 11px 20px; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 0.88rem; }
  #newCodeBanner { display: none; background: #14141f; border: 1px solid #3a2050; border-radius: 12px; padding: 14px 18px; margin-bottom: 16px; color: #ec4899; font-weight: 700; }

  .table-card { background: #14141f; border: 1px solid #232336; border-radius: 14px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; padding: 13px 16px; color: #8b8b9e; font-weight: 600; border-bottom: 1px solid #232336; white-space: nowrap; }
  td { padding: 13px 16px; border-bottom: 1px solid #1c1c2b; color: #d1d5db; }
  tr:last-child td { border-bottom: none; }
  .game-cell { display: flex; align-items: center; gap: 8px; }
  .code-cell { display: flex; align-items: center; gap: 8px; font-family: monospace; }
  .copy-btn { cursor: pointer; opacity: 0.6; }
  .copy-btn:hover { opacity: 1; }
  .badge { padding: 4px 11px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; }
  .badge.used { background: #123924; color: #4ade80; }
  .badge.unused { background: #26262f; color: #9ca3af; }
  .muted { color: #55556b; }

  .pagination { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; font-size: 0.8rem; color: #8b8b9e; }
  .page-btns { display: flex; gap: 6px; }
  .page-btns button { background: #1a1a29; border: 1px solid #232336; color: #d1d5db; padding: 6px 11px; border-radius: 8px; cursor: pointer; font-size: 0.8rem; }
  .page-btns button.active { background: linear-gradient(135deg,#a855f7,#ec4899); border: none; color: #fff; }
  .page-btns button:disabled { opacity: 0.4; cursor: default; }

  .view { display: none; }
  .view.active { display: block; }

  .content-editor { background: #14141f; border: 1px solid #232336; border-radius: 14px; padding: 18px; margin-top: 14px; }
  .content-editor textarea { width: 100%; min-height: 260px; background: #0b0b14; border: 1px solid #232336; border-radius: 10px; color: #e5e7eb; padding: 12px; font-family: monospace; font-size: 0.8rem; margin-bottom: 12px; }
  .save-msg { font-size: 0.82rem; margin-top: 8px; }
  .save-msg.ok { color: #4ade80; }
  .save-msg.err { color: #f87171; }

  @media (max-width: 720px) {
    .sidebar { display: none; }
    .content { padding: 16px; }
    .search-box { display: none; }
  }
</style>
</head>
<body>

<div class="login-wrap" id="loginWrap">
  <div class="login-box">
    <div class="logo"><span>Love</span><span style="color:#fff">Dare</span> Admin</div>
    <p class="sub">Masuk untuk mengelola game & kode aktivasi</p>
    <input type="password" id="passInput" placeholder="Password admin" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false">
    <label style="display:flex; align-items:center; gap:10px; font-size:0.85rem; color:#8b8b9e; margin-bottom:14px; cursor:pointer; user-select:none;">
      <input type="checkbox" id="showPassChk" onclick="togglePassVisibility()" style="width:16px; height:16px; margin:0; flex-shrink:0; accent-color:#ec4899; cursor:pointer;">
      <span>Tampilkan Password</span>
    </label>
    <button onclick="login()">Masuk</button>
    <div class="login-err" id="loginErr"></div>
  </div>
</div>

<div id="app">
  <div class="layout">
    <div class="sidebar">
      <div class="logo"><span>Love</span><span style="color:#fff">Dare</span></div>
      <div class="navitem active" data-view="dashboard"><span class="ic">📊</span> Dashboard</div>
      <div class="navitem" data-view="games"><span class="ic">🎮</span> Games</div>
      <div class="navitem" data-view="codes"><span class="ic">🎟️</span> Activation Codes</div>
      <div class="navitem" data-view="generate"><span class="ic">➕</span> Generate Code</div>
      <div class="navitem" data-view="used"><span class="ic">✅</span> Used Codes</div>
      <div class="navitem" data-view="settings"><span class="ic">⚙️</span> Settings</div>

      <div class="promo-card">
        <div class="heart">💎</div>
        <h4>LoveDare</h4>
        <p>Spice up fun.<br>Share the love.</p>
      </div>
      <div class="sidebar-footer">© 2026 LoveDare<br>All rights reserved.</div>
    </div>

    <div class="main">
      <div class="topbar">
        <div class="search-box">
          <span>🔍</span>
          <input type="text" id="searchInput" placeholder="Search codes, games, device ID...">
        </div>
        <div class="top-right">
          <span>🔔</span>
          <div class="admin-chip">
            <div class="avatar">👤</div>
            <div>
              <div class="name">Admin</div>
              <div class="role">Super Admin</div>
            </div>
            <button class="logout-btn" onclick="logout()">Keluar</button>
          </div>
        </div>
      </div>

      <div class="content">

        <div class="view active" id="view-dashboard">
          <div class="page-title">Dashboard</div>
          <div class="page-sub">Overview of your games and activation codes</div>
          <div class="stat-grid">
            <div class="stat-card"><div class="stat-icon" style="background:#2a1f4d;color:#a855f7;">🎮</div><div class="stat-label">Total Games</div><div class="stat-value" id="statGames">0</div></div>
            <div class="stat-card"><div class="stat-icon" style="background:#4d1f3a;color:#ec4899;">🏷️</div><div class="stat-label">Total Codes</div><div class="stat-value" id="statTotal">0</div></div>
            <div class="stat-card"><div class="stat-icon" style="background:#4d1f24;color:#f87171;">✅</div><div class="stat-label">Used Codes</div><div class="stat-value" id="statUsed">0</div></div>
            <div class="stat-card"><div class="stat-icon" style="background:#3a1f4d;color:#c084fc;">🎁</div><div class="stat-label">Available Codes</div><div class="stat-value" id="statAvailable">0</div></div>
          </div>

          <div class="toolbar">
            <select id="filterGame"><option value="">All Games</option></select>
            <button class="btn-gradient" onclick="generateCode()">+ Generate New Code</button>
          </div>
          <div id="newCodeBanner"></div>

          <div class="table-card">
            <table>
              <thead><tr><th>Game Name</th><th>Code</th><th>Status</th><th>Device</th><th>Activation Date</th></tr></thead>
              <tbody id="codeBody"></tbody>
            </table>
            <div class="pagination">
              <span id="pageInfo"></span>
              <div class="page-btns" id="pageBtns"></div>
            </div>
          </div>
        </div>

        <div class="view" id="view-games">
          <div class="page-title">Games</div>
          <div class="page-sub">Kelola daftar game & konten challenge-nya</div>
          <div id="gamesList"></div>
        </div>

        <div class="view" id="view-codes">
          <div class="page-title">Activation Codes</div>
          <div class="page-sub">Semua kode aktivasi yang pernah dibuat</div>
          <div class="table-card">
            <table>
              <thead><tr><th>Game Name</th><th>Code</th><th>Status</th><th>Device</th><th>Activation Date</th></tr></thead>
              <tbody id="allCodesBody"></tbody>
            </table>
          </div>
        </div>

        <div class="view" id="view-generate">
          <div class="page-title">Generate Code</div>
          <div class="page-sub">Buat kode aktivasi baru untuk pembeli</div>
          <div class="table-card" style="padding:22px;">
            <select id="generateGameSelect" style="width:100%; margin-bottom:14px; background:#0b0b14; border:1px solid #232336; color:#eee; padding:12px; border-radius:10px;"></select>
            <button class="btn-gradient" style="width:100%;" onclick="generateCode()">+ Generate Kode Baru</button>
            <div id="newCodeBanner2" style="margin-top:14px;"></div>
          </div>
        </div>

        <div class="view" id="view-used">
          <div class="page-title">Used Codes</div>
          <div class="page-sub">Kode yang sudah diaktivasi pembeli</div>
          <div class="table-card">
            <table>
              <thead><tr><th>Game Name</th><th>Code</th><th>Device</th><th>Activation Date</th></tr></thead>
              <tbody id="usedCodesBody"></tbody>
            </table>
          </div>
        </div>

        <div class="view" id="view-settings">
          <div class="page-title">Settings</div>
          <div class="page-sub">Pengaturan akun admin</div>
          <div class="table-card" style="padding:20px; color:#9ca3af; font-size:0.88rem; line-height:1.6;">
            Password admin diatur lewat <b>Secret ADMIN_PASSWORD</b> di Cloudflare Worker Settings, bukan dari sini (demi keamanan).<br><br>
            Untuk ganti password, buka Worker <b>lovedare-api → Settings → Variables and Secrets</b>.
          </div>
        </div>

      </div>
    </div>
  </div>
</div>

<script>
window.onerror = function(msg, url, line, col, err) {
  var el = document.getElementById('loginErr');
  if (el) el.textContent = 'JS ERROR: ' + msg + ' (baris ' + line + ')';
  return false;
};
window.addEventListener('unhandledrejection', function(e) {
  var el = document.getElementById('loginErr');
  var reason = e.reason && e.reason.message ? e.reason.message : e.reason;
  if (el) el.textContent = 'PROMISE ERROR: ' + reason;
});

let adminPass = "";
let allCodes = [];
let allGames = [];
let currentPage = 1;
const PAGE_SIZE = 8;

function togglePassVisibility() {
  const inp = document.getElementById('passInput');
  const chk = document.getElementById('showPassChk');
  inp.type = chk.checked ? 'text' : 'password';
}

function login() {
  adminPass = document.getElementById('passInput').value;
  fetch('/api/codes', { headers: { 'x-admin-password': adminPass } })
    .then(r => {
      if (r.status === 401) throw new Error('WRONG_PASSWORD');
      if (!r.ok) throw new Error('SERVER_ERROR_' + r.status);
      return r.json();
    })
    .then(data => {
      document.getElementById('loginWrap').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      allCodes = data.codes;
      loadGames();
      renderAll();
    })
    .catch((e) => {
      if (e.message === 'WRONG_PASSWORD') {
        document.getElementById('loginErr').textContent = 'Password salah! (Server merespons: Unauthorized)';
      } else if (e.message && e.message.startsWith('SERVER_ERROR_')) {
        document.getElementById('loginErr').textContent = 'Error server: ' + e.message.replace('SERVER_ERROR_', 'kode ');
      } else {
        document.getElementById('loginErr').textContent = 'Gagal terhubung ke server (cek koneksi internet / CORS): ' + e.message;
      }
    });
}

function logout() {
  adminPass = "";
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginWrap').style.display = 'flex';
  document.getElementById('passInput').value = '';
}

document.querySelectorAll('.navitem').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.navitem').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('view-' + item.dataset.view).classList.add('active');
  });
});

function loadGames() {
  fetch('/api/games', { headers: { 'x-admin-password': adminPass } })
    .then(r => r.json())
    .then(data => {
      allGames = data.games;
      const filterSel = document.getElementById('filterGame');
      const genSel = document.getElementById('generateGameSelect');
      filterSel.innerHTML = '<option value="">All Games</option>' + allGames.map(function(g){ return '<option value="' + g.slug + '">' + g.name + '</option>'; }).join('');
      genSel.innerHTML = allGames.map(function(g){ return '<option value="' + g.slug + '">' + g.name + '</option>'; }).join('');
      renderGamesList();
    });
}

function generateCode() {
  const slug = document.getElementById('generateGameSelect') ? document.getElementById('generateGameSelect').value : (allGames[0] ? allGames[0].slug : 'ular-tangga-cinta');
  fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPass },
    body: JSON.stringify({ gameSlug: slug || (allGames[0] ? allGames[0].slug : 'ular-tangga-cinta') })
  })
  .then(r => r.json())
  .then(data => {
    const msg = '✨ Kode baru: ' + data.code;
    const b1 = document.getElementById('newCodeBanner');
    const b2 = document.getElementById('newCodeBanner2');
    b1.style.display = 'block'; b1.textContent = msg;
    b2.style.display = 'block'; b2.textContent = msg;
    loadCodes();
  });
}

function loadCodes() {
  fetch('/api/codes', { headers: { 'x-admin-password': adminPass } })
    .then(r => r.json())
    .then(data => { allCodes = data.codes; renderAll(); });
}

function renderAll() {
  renderStats();
  currentPage = 1;
  renderDashboardTable();
  renderAllCodesTable();
  renderUsedCodesTable();
}

function renderStats() {
  document.getElementById('statGames').textContent = allGames.length || new Set(allCodes.map(c => c.game_slug)).size;
  document.getElementById('statTotal').textContent = allCodes.length;
  document.getElementById('statUsed').textContent = allCodes.filter(c => c.status === 'ACTIVATED').length;
  document.getElementById('statAvailable').textContent = allCodes.filter(c => c.status === 'UNUSED').length;
}

function getFiltered() {
  const gameFilter = document.getElementById('filterGame').value;
  const search = document.getElementById('searchInput').value.toLowerCase();
  return allCodes.filter(c => {
    if (gameFilter && c.game_slug !== gameFilter) return false;
    if (search && !(c.code.toLowerCase().includes(search) || c.game_name.toLowerCase().includes(search) || (c.device_id||'').toLowerCase().includes(search))) return false;
    return true;
  });
}

function renderDashboardTable() {
  const filtered = getFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  document.getElementById('codeBody').innerHTML = pageItems.map(rowHtml).join('') || '<tr><td colspan="5" class="muted" style="text-align:center; padding:30px;">Belum ada kode</td></tr>';
  document.getElementById('pageInfo').textContent = filtered.length ? ('Showing ' + (start+1) + ' to ' + Math.min(start+PAGE_SIZE, filtered.length) + ' of ' + filtered.length + ' codes') : 'Tidak ada data';

  const pageBtns = document.getElementById('pageBtns');
  let btns = '<button ' + (currentPage===1?'disabled':'') + ' onclick="changePage(' + (currentPage-1) + ')">‹</button>';
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p-currentPage) <= 1) {
      btns += '<button class="' + (p===currentPage?'active':'') + '" onclick="changePage(' + p + ')">' + p + '</button>';
    } else if (Math.abs(p-currentPage) === 2) {
      btns += '<span style="padding:6px 4px;">...</span>';
    }
  }
  btns += '<button ' + (currentPage===totalPages?'disabled':'') + ' onclick="changePage(' + (currentPage+1) + ')">›</button>';
  pageBtns.innerHTML = btns;
}

function changePage(p) { currentPage = p; renderDashboardTable(); }

function rowHtml(c) {
  return '<tr>' +
    '<td class="game-cell">💗 ' + c.game_name + '</td>' +
    '<td><div class="code-cell">' + c.code + ' <span class="copy-btn" onclick="copyCode(\\'' + c.code + '\\')">📋</span></div></td>' +
    '<td><span class="badge ' + (c.status==='ACTIVATED'?'used':'unused') + '">' + c.status + '</span></td>' +
    '<td class="muted">' + deviceLabel(c) + '</td>' +
    '<td class="muted">' + (c.activated_at || '—') + '</td>' +
    '</tr>';
}

function deviceLabel(c) {
  if (!c.device_id) return '—';
  if (c.device_name) return c.device_name;
  return c.device_id.substring(0,14) + '...';
}

function renderAllCodesTable() {
  document.getElementById('allCodesBody').innerHTML = allCodes.map(rowHtml).join('') || '<tr><td colspan="5" class="muted" style="text-align:center; padding:30px;">Belum ada kode</td></tr>';
}

function renderUsedCodesTable() {
  const used = allCodes.filter(c => c.status === 'ACTIVATED');
  document.getElementById('usedCodesBody').innerHTML = used.map(function(c){
    return '<tr>' +
      '<td class="game-cell">💗 ' + c.game_name + '</td>' +
      '<td><div class="code-cell">' + c.code + '</div></td>' +
      '<td class="muted">' + deviceLabel(c) + '</td>' +
      '<td class="muted">' + (c.activated_at || '—') + '</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="4" class="muted" style="text-align:center; padding:30px;">Belum ada kode terpakai</td></tr>';
}

function renderGamesList() {
  const el = document.getElementById('gamesList');
  el.innerHTML = allGames.map(function(g) {
    const codesForGame = allCodes.filter(function(c){ return c.game_slug === g.slug; });
    const used = codesForGame.filter(function(c){ return c.status === 'ACTIVATED'; }).length;
    return '<div class="table-card" style="padding:18px; margin-bottom:14px;">' +
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">' +
      '<div><b>💗 ' + g.name + '</b> <span class="muted" style="font-size:0.8rem;">(' + g.slug + ')</span></div>' +
      '<div class="muted" style="font-size:0.85rem;">' + codesForGame.length + ' kode • ' + used + ' terpakai</div>' +
      '</div>' +
      '<button class="btn-gradient" style="font-size:0.8rem; padding:8px 14px;" onclick="editContent(\\'' + g.slug + '\\')">✏️ Edit Konten Game</button>' +
      '<div id="editor-' + g.slug + '"></div>' +
      '</div>';
  }).join('') || '<p class="muted">Belum ada game</p>';
}

function editContent(slug) {
  const container = document.getElementById('editor-' + slug);
  if (container.innerHTML) { container.innerHTML = ''; return; }
  container.innerHTML = '<p class="muted" style="margin-top:10px;">Memuat konten...</p>';
  fetch('/api/admin/game-content?gameSlug=' + slug, { headers: { 'x-admin-password': adminPass } })
    .then(r => r.json())
    .then(data => {
      const contentJson = JSON.stringify(data.content, null, 2)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      container.innerHTML =
        '<div class="content-editor">' +
        '<p class="muted" style="margin-bottom:8px; font-size:0.8rem;">Edit JSON konten (ladders &amp; challenges), lalu simpan. APK yang sudah terinstall akan otomatis narik versi terbaru ini.</p>' +
        '<textarea id="contentArea-' + slug + '">' + contentJson + '</textarea>' +
        '<button class="btn-gradient" onclick="saveContent(\\'' + slug + '\\')">💾 Simpan Perubahan</button>' +
        '<div class="save-msg" id="saveMsg-' + slug + '"></div>' +
        '</div>';
    });
}

function saveContent(slug) {
  const msgEl = document.getElementById('saveMsg-' + slug);
  let parsed;
  try {
    parsed = JSON.parse(document.getElementById('contentArea-' + slug).value);
  } catch (e) {
    msgEl.className = 'save-msg err'; msgEl.textContent = '❌ JSON tidak valid: ' + e.message;
    return;
  }
  fetch('/api/admin/game-content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPass },
    body: JSON.stringify({ gameSlug: slug, content: parsed })
  })
  .then(r => r.json())
  .then(() => { msgEl.className = 'save-msg ok'; msgEl.textContent = '✅ Tersimpan!'; });
}

function copyCode(code) {
  navigator.clipboard.writeText(code).catch(() => {});
}

document.getElementById('filterGame').addEventListener('change', () => { currentPage = 1; renderDashboardTable(); });
document.getElementById('searchInput').addEventListener('input', () => { currentPage = 1; renderDashboardTable(); });
</script>
</body>
</html>
`;
