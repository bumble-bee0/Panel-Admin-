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
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover">
<title>LoveDare Admin Panel</title>
<style>
/* ========================================================= 
   LOVE DARE ADMIN — Responsive / Vanilla CSS / No Framework
   ========================================================= */

:root {
    --bg: #09070f;
    --panel: #151020;
    --border: rgba(255,255,255,.08);
    --border-hover: rgba(255,255,255,.15);
    --text: #f8f7fb;
    --text-soft: #aaa4b7;
    --text-muted: #777181;
    --purple: #a855f7;
    --pink: #ec4899;
    --green: #22c55e;
    --sidebar-width: 240px;
    --topbar-height: 72px;
    --radius: 14px;
    --radius-sm: 10px;
    --gradient: linear-gradient(135deg,#a855f7 0%,#ec4899 100%);
}

*, *::before, *::after { box-sizing: border-box; }
html { width: 100%; min-height: 100%; background: var(--bg); }
body {
    width: 100%; min-height: 100vh; margin: 0;
    background:
        radial-gradient(circle at 80% -10%, rgba(168,85,247,.13), transparent 32%),
        radial-gradient(circle at -10% 80%, rgba(236,72,153,.07), transparent 30%),
        var(--bg);
    color: var(--text);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px; line-height: 1.5; overflow-x: hidden;
}
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
img, svg { max-width: 100%; }
a { color: inherit; text-decoration: none; }

::-webkit-scrollbar { width: 7px; height: 7px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #332a42; border-radius: 99px; }
::-webkit-scrollbar-thumb:hover { background: #4a3c5c; }

/* LOGIN */
#loginWrap { min-height: 100vh; width: 100%; display: flex; align-items: center; justify-content: center; padding: 24px; }
.login-card {
    width: min(420px, 100%);
    background: linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,.015)), var(--panel);
    border: 1px solid var(--border); border-radius: 22px; padding: 34px;
    box-shadow: 0 35px 90px rgba(0,0,0,.45); position: relative; overflow: hidden;
}
.login-card::before {
    content: ""; position: absolute; width: 220px; height: 220px; top: -130px; right: -100px;
    background: rgba(168,85,247,.22); filter: blur(60px); border-radius: 50%;
}
.login-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 30px; }
.brand-icon {
    width: 46px; height: 46px; display: flex; align-items: center; justify-content: center;
    border-radius: 13px; background: var(--gradient); font-size: 22px; font-weight: 800;
    box-shadow: 0 8px 25px rgba(168,85,247,.28);
}
.brand-name { font-size: 21px; font-weight: 800; letter-spacing: -.4px; }
.brand-subtitle { color: var(--text-muted); font-size: 12px; }
.login-title { font-size: 26px; font-weight: 750; margin: 0 0 7px; }
.login-description { margin: 0 0 25px; color: var(--text-soft); }
.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 12px; font-weight: 650; margin-bottom: 8px; color: #d9d4df; }
.input-wrap { position: relative; }
.input, .select, .textarea {
    width: 100%; min-height: 46px; border: 1px solid var(--border); border-radius: var(--radius-sm);
    outline: none; color: var(--text); background: rgba(255,255,255,.035); padding: 0 14px;
    transition: border-color .2s, background .2s, box-shadow .2s;
}
.textarea { min-height: 180px; padding: 13px 14px; resize: vertical; }
.input:focus, .select:focus, .textarea:focus {
    border-color: rgba(168,85,247,.7); box-shadow: 0 0 0 3px rgba(168,85,247,.12); background: rgba(255,255,255,.05);
}
.password-input { padding-right: 50px; }
.show-password {
    position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
    min-width: 38px; min-height: 38px; border: 0; background: transparent; color: var(--text-muted); font-size: 16px;
}
.login-options { display: flex; align-items: center; gap: 8px; margin: 14px 0 20px; color: var(--text-soft); font-size: 13px; cursor: pointer; }
.login-options input { width: 17px; height: 17px; accent-color: var(--purple); }
.login-button {
    width: 100%; min-height: 48px; border: 0; border-radius: 12px; color: white; font-weight: 750;
    background: var(--gradient); box-shadow: 0 10px 25px rgba(168,85,247,.22); transition: transform .15s, filter .15s;
}
.login-button:hover { filter: brightness(1.08); }
.login-button:active { transform: scale(.985); }
#loginErr {
    display: none; margin-top: 14px; padding: 11px 13px; border-radius: 10px; color: #fda4af;
    background: rgba(244,63,94,.08); border: 1px solid rgba(244,63,94,.18); font-size: 13px;
}

/* APP SHELL */
#app { display: none; min-height: 100vh; width: 100%; }
.app-shell { width: 100%; min-height: 100vh; }

.sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 1500; }

.sidebar {
    position: fixed; left: 0; top: 0; bottom: 0; width: var(--sidebar-width); padding: 20px 14px;
    background: linear-gradient(180deg, rgba(21,16,32,.98), rgba(13,10,20,.98));
    border-right: 1px solid var(--border); z-index: 2000;
    display: flex; flex-direction: column; transition: width .25s ease, transform .25s ease;
}
.sidebar-brand { height: 46px; display: flex; align-items: center; gap: 11px; padding: 0 10px; margin-bottom: 25px; white-space: nowrap; overflow: hidden; }
.sidebar-brand-icon {
    flex: 0 0 38px; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;
    border-radius: 11px; background: var(--gradient); font-weight: 850;
}
.sidebar-brand-text { font-size: 18px; font-weight: 800; transition: opacity .2s; }
.nav { display: flex; flex-direction: column; gap: 4px; }
.navitem {
    min-height: 44px; display: flex; align-items: center; gap: 12px; padding: 0 11px; border-radius: 11px;
    color: var(--text-soft); cursor: pointer; user-select: none; transition: background .2s, color .2s;
}
.navitem:hover { background: rgba(255,255,255,.045); color: white; }
.navitem.active {
    color: white; background: linear-gradient(90deg, rgba(168,85,247,.19), rgba(236,72,153,.09));
    box-shadow: inset 3px 0 0 var(--purple);
}
.nav-icon { width: 21px; min-width: 21px; text-align: center; font-size: 16px; }
.nav-text { white-space: nowrap; }
.sidebar-bottom { margin-top: auto; padding-top: 15px; border-top: 1px solid var(--border); }
.admin-mini { display: flex; align-items: center; gap: 10px; padding: 9px; }
.admin-avatar {
    width: 35px; height: 35px; flex: 0 0 35px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg,#3b294c,#24182e); border: 1px solid var(--border); font-size: 13px;
}
.admin-mini-text { min-width: 0; }
.admin-mini-name { font-size: 12px; font-weight: 700; white-space: nowrap; }
.admin-mini-role { color: var(--text-muted); font-size: 10px; }

body.sidebar-collapsed .sidebar { width: 76px; }
body.sidebar-collapsed .sidebar-brand-text,
body.sidebar-collapsed .nav-text,
body.sidebar-collapsed .admin-mini-text { opacity: 0; width: 0; overflow: hidden; }
body.sidebar-collapsed .sidebar-brand { justify-content: center; padding: 0; }
body.sidebar-collapsed .navitem { justify-content: center; padding: 0; }
body.sidebar-collapsed .admin-mini { justify-content: center; padding: 9px 0; }
body.sidebar-collapsed .main { margin-left: 76px; }

.main { min-height: 100vh; margin-left: var(--sidebar-width); transition: margin-left .25s ease; }

.topbar {
    position: sticky; top: 0; height: var(--topbar-height); display: flex; align-items: center; gap: 15px;
    padding: 0 28px; background: rgba(9,7,15,.82); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
    border-bottom: 1px solid var(--border); z-index: 500;
}
.menu-toggle {
    width: 42px; min-width: 42px; height: 42px; border: 1px solid var(--border); background: rgba(255,255,255,.035);
    color: white; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 19px;
    transition: background .2s, border-color .2s;
}
.menu-toggle:hover { background: rgba(255,255,255,.07); border-color: var(--border-hover); }
.topbar-search { width: min(430px, 100%); position: relative; }
.topbar-search input {
    width: 100%; height: 42px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,.035);
    color: white; outline: none; padding: 0 14px 0 40px;
}
.topbar-search::before {
    content: "⌕"; position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-muted);
    font-size: 18px; pointer-events: none;
}
.topbar-search input:focus { border-color: rgba(168,85,247,.5); }
.topbar-spacer { flex: 1; }
.topbar-admin { display: flex; align-items: center; gap: 10px; min-width: 0; }
.topbar-avatar {
    width: 38px; height: 38px; min-width: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: var(--gradient); font-weight: 750;
}
.topbar-admin-info { min-width: 0; }
.topbar-admin-name { font-size: 12px; font-weight: 750; white-space: nowrap; }
.topbar-admin-role { font-size: 10px; color: var(--text-muted); }
.logout-btn-desktop { background: none; border: none; color: #f87171; font-size: 11px; cursor: pointer; margin-left: 4px; }

/* CONTENT */
.content { width: 100%; max-width: 1600px; margin: 0 auto; padding: 28px; }
.view { display: none; }
.view.active { display: block; }

.page-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 25px; flex-wrap: wrap; }
.page-title { margin: 0; font-size: clamp(22px, 2vw, 28px); font-weight: 800; letter-spacing: -.5px; }
.page-description { color: var(--text-soft); margin: 5px 0 0; font-size: 13px; }

.btn {
    min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px;
    border-radius: 10px; border: 1px solid var(--border); color: var(--text); background: rgba(255,255,255,.045);
    font-weight: 700; transition: background .2s, transform .15s, border-color .2s;
}
.btn:hover { background: rgba(255,255,255,.08); border-color: var(--border-hover); }
.btn:active { transform: scale(.98); }
.btn-primary { border: 0; background: var(--gradient); box-shadow: 0 8px 24px rgba(168,85,247,.2); color: white; }
.btn-primary:hover { filter: brightness(1.08); }
.btn-block { width: 100%; }

.stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 15px; margin-bottom: 24px; }
.stat-card {
    min-width: 0; padding: 20px; border-radius: var(--radius); border: 1px solid var(--border);
    background: linear-gradient(145deg, rgba(255,255,255,.035), rgba(255,255,255,.012));
    box-shadow: 0 12px 30px rgba(0,0,0,.12);
}
.stat-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.stat-label { color: var(--text-soft); font-size: 12px; font-weight: 650; }
.stat-icon { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 9px; font-size: 15px; }
.stat-value { margin-top: 13px; font-size: clamp(24px, 3vw, 30px); font-weight: 800; letter-spacing: -.8px; }

.panel {
    width: 100%; min-width: 0; border-radius: var(--radius); border: 1px solid var(--border);
    background: linear-gradient(145deg, rgba(255,255,255,.035), rgba(255,255,255,.012));
    overflow: hidden; box-shadow: 0 12px 30px rgba(0,0,0,.12);
}
.panel-body { padding: 18px; }

.filter-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; justify-content: space-between; }
.filter-bar .select { width: auto; min-width: 180px; }
.filter-bar input.input { width: auto; min-width: 200px; flex: 1; }

.table-container { width: 100%; overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; }
.data-table { width: 100%; border-collapse: collapse; min-width: 700px; }
.data-table th {
    padding: 12px 14px; color: var(--text-muted); text-align: left; font-size: 10px; font-weight: 750;
    text-transform: uppercase; letter-spacing: .07em; background: rgba(255,255,255,.018);
    border-bottom: 1px solid var(--border); white-space: nowrap;
}
.data-table td { padding: 14px; color: #d9d4df; border-bottom: 1px solid rgba(255,255,255,.055); vertical-align: middle; }
.data-table tbody tr { transition: background .15s; }
.data-table tbody tr:hover { background: rgba(255,255,255,.025); }
.data-table tbody tr:last-child td { border-bottom: 0; }
.game-cell { display: flex; align-items: center; gap: 8px; }
.code-cell { display: flex; align-items: center; gap: 8px; }
.copy-btn { cursor: pointer; opacity: .6; }
.copy-btn:hover { opacity: 1; }

.status { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 9px; border-radius: 999px; font-size: 10px; font-weight: 750; white-space: nowrap; }
.status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; }
.status-unused { color: #c4b5fd; background: rgba(168,85,247,.09); }
.status-unused::before { background: var(--purple); }
.status-activated { color: #86efac; background: rgba(34,197,94,.09); }
.status-activated::before { background: var(--green); }

.code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 12px; color: #e9d5ff; word-break: break-word; }
.muted { color: var(--text-muted); }

.pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 16px; flex-wrap: wrap; }
#pageInfo { color: var(--text-muted); font-size: 12px; }
#pageBtns { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
#pageBtns button { min-width: 38px; min-height: 38px; border-radius: 9px; border: 1px solid var(--border); color: var(--text-soft); background: rgba(255,255,255,.035); }
#pageBtns button:hover, #pageBtns button.active { color: white; border-color: rgba(168,85,247,.45); background: rgba(168,85,247,.14); }
#pageBtns button:disabled { opacity: .4; }

.banner {
    display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 16px 18px; margin-bottom: 18px;
    border-radius: 13px; border: 1px solid rgba(168,85,247,.2);
    background: linear-gradient(100deg, rgba(168,85,247,.12), rgba(236,72,153,.055));
    color: #f0abfc; font-weight: 700; display: none;
}

.content-editor { margin-top: 14px; }
.content-editor textarea { width: 100%; min-height: 260px; font-family: monospace; font-size: .8rem; margin-bottom: 12px; }
.save-msg { font-size: .82rem; margin-top: 8px; }
.save-msg.ok { color: #4ade80; }
.save-msg.err { color: #f87171; }
.game-card { padding: 18px; margin-bottom: 14px; }
.game-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px; }

.mobile-bottom-nav { display: none; }

/* ===================== TABLET (768px - 1024px): SIDEBAR ICON-ONLY ===================== */
@media (max-width: 1024px) {
    :root { --sidebar-width: 76px; }
    .sidebar-brand-text, .nav-text, .admin-mini-text { opacity: 0; width: 0; overflow: hidden; }
    .sidebar-brand { justify-content: center; padding: 0; }
    .navitem { justify-content: center; padding: 0; }
    .admin-mini { justify-content: center; padding: 9px 0; }
    body.sidebar-collapsed .sidebar { width: 240px; }
    body.sidebar-collapsed .sidebar-brand-text,
    body.sidebar-collapsed .nav-text,
    body.sidebar-collapsed .admin-mini-text { opacity: 1; width: auto; }
    body.sidebar-collapsed .sidebar-brand,
    body.sidebar-collapsed .navitem { justify-content: flex-start; padding: 0 11px; }
    body.sidebar-collapsed .admin-mini { justify-content: flex-start; padding: 9px; }
    body.sidebar-collapsed .main { margin-left: 240px; }
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
}

/* ===================== MOBILE (<768px): DRAWER + BOTTOM NAV + CARD TABLE ===================== */
@media (max-width: 767px) {
    .sidebar {
        width: 250px !important;
        transform: translateX(-100%);
    }
    .sidebar-brand-text, .nav-text, .admin-mini-text { opacity: 1 !important; width: auto !important; }
    .sidebar-brand, .navitem { justify-content: flex-start !important; padding: 0 11px !important; }
    .admin-mini { justify-content: flex-start !important; padding: 9px !important; }
    body.sidebar-open .sidebar { transform: translateX(0); }
    body.sidebar-open .sidebar-overlay { display: block; }

    .main { margin-left: 0 !important; }
    .topbar { padding: 0 14px; gap: 10px; }
    .topbar-search { display: none; }
    .topbar-admin-info { display: none; }
    .content { padding: 16px; padding-bottom: 92px; }

    .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .stat-card { padding: 14px; }

    .page-header { margin-bottom: 16px; }
    .panel-body { padding: 12px; }

    .filter-bar .select, .filter-bar input.input { min-width: 0; width: 100%; }

    /* tabel jadi kartu */
    .table-container { overflow: visible; }
    .data-table { min-width: 0; }
    .data-table thead { display: none; }
    .data-table, .data-table tbody, .data-table tr, .data-table td { display: block; width: 100%; }
    .data-table tr {
        margin-bottom: 10px; border: 1px solid var(--border); border-radius: 12px;
        padding: 4px 14px; background: rgba(255,255,255,.02);
    }
    .data-table td {
        display: flex; justify-content: space-between; align-items: center; gap: 10px;
        padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,.05); text-align: right;
    }
    .data-table td:last-child { border-bottom: 0; }
    .data-table td::before {
        content: attr(data-label); color: var(--text-muted); font-size: 10px; font-weight: 750;
        text-transform: uppercase; letter-spacing: .05em; text-align: left;
    }

    .mobile-bottom-nav {
        display: flex; position: fixed; left: 0; right: 0; bottom: 0;
        background: rgba(15,11,24,.98); border-top: 1px solid var(--border); z-index: 900;
        padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
    }
    .mobile-bottom-nav .navitem {
        flex: 1; flex-direction: column; gap: 2px; font-size: 10px; min-height: 52px; border-radius: 10px;
        justify-content: center !important; padding: 0 !important;
    }
    .mobile-bottom-nav .nav-text { display: block; font-size: 9px; }
    .mobile-bottom-nav .nav-icon { font-size: 17px; }
    .sidebar-bottom .btn { display: none; }
    .logout-btn-mobile { display: block !important; }
}
@media (min-width: 768px) { .logout-btn-mobile { display: none !important; } }
</style>
</head>
<body>

<div id="loginWrap">
  <div class="login-card">
    <div class="login-brand">
      <div class="brand-icon">💕</div>
      <div><div class="brand-name">LoveDare</div><div class="brand-subtitle">Admin Panel</div></div>
    </div>
    <h1 class="login-title">Masuk</h1>
    <p class="login-description">Masuk untuk mengelola game & kode aktivasi</p>
    <div class="form-group">
      <label class="form-label">Password Admin</label>
      <div class="input-wrap">
        <input type="password" id="passInput" class="input password-input" placeholder="Password admin" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false">
        <button type="button" class="show-password" onclick="document.getElementById('showPassChk').checked = !document.getElementById('showPassChk').checked; togglePassVisibility();">👁</button>
      </div>
    </div>
    <label class="login-options">
      <input type="checkbox" id="showPassChk" onclick="togglePassVisibility()">
      <span>Tampilkan Password</span>
    </label>
    <button class="login-button" onclick="login()">Masuk</button>
    <div id="loginErr"></div>
  </div>
</div>

<div id="app">
  <div class="app-shell">
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>

    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand-icon">💕</div>
        <div class="sidebar-brand-text">LoveDare</div>
      </div>
      <nav class="nav">
        <div class="navitem active" data-view="dashboard"><span class="nav-icon">📊</span><span class="nav-text">Dashboard</span></div>
        <div class="navitem" data-view="games"><span class="nav-icon">🎮</span><span class="nav-text">Games</span></div>
        <div class="navitem" data-view="codes"><span class="nav-icon">🎟️</span><span class="nav-text">Activation Codes</span></div>
        <div class="navitem" data-view="generate"><span class="nav-icon">➕</span><span class="nav-text">Generate Code</span></div>
        <div class="navitem" data-view="used"><span class="nav-icon">✅</span><span class="nav-text">Used Codes</span></div>
        <div class="navitem" data-view="settings"><span class="nav-icon">⚙️</span><span class="nav-text">Settings</span></div>
      </nav>
      <div class="sidebar-bottom">
        <div class="admin-mini">
          <div class="admin-avatar">👤</div>
          <div class="admin-mini-text">
            <div class="admin-mini-name">Admin</div>
            <div class="admin-mini-role">Super Admin</div>
          </div>
        </div>
        <button class="btn btn-block logout-btn-mobile" style="margin-top:8px; display:none;" onclick="logout()">Keluar</button>
      </div>
    </aside>

    <div class="main">
      <div class="topbar">
        <button class="menu-toggle" onclick="toggleSidebar()">☰</button>
        <div class="topbar-search"><input type="text" id="searchInput" placeholder="Search codes, games, device ID..."></div>
        <div class="topbar-spacer"></div>
        <div class="topbar-admin">
          <div class="topbar-avatar">👤</div>
          <div class="topbar-admin-info">
            <div class="topbar-admin-name">Admin</div>
            <div class="topbar-admin-role">Super Admin</div>
          </div>
          <button class="logout-btn-desktop" onclick="logout()">Keluar</button>
        </div>
      </div>

      <div class="content">

        <div class="view active" id="view-dashboard">
          <div class="page-header">
            <div><h1 class="page-title">Dashboard</h1><p class="page-description">Overview of your games and activation codes</p></div>
          </div>
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-top"><span class="stat-label">Total Games</span><div class="stat-icon" style="background:rgba(168,85,247,.15);color:#c4b5fd;">🎮</div></div><div class="stat-value" id="statGames">0</div></div>
            <div class="stat-card"><div class="stat-top"><span class="stat-label">Total Codes</span><div class="stat-icon" style="background:rgba(236,72,153,.15);color:#f9a8d4;">🏷️</div></div><div class="stat-value" id="statTotal">0</div></div>
            <div class="stat-card"><div class="stat-top"><span class="stat-label">Used Codes</span><div class="stat-icon" style="background:rgba(34,197,94,.15);color:#86efac;">✅</div></div><div class="stat-value" id="statUsed">0</div></div>
            <div class="stat-card"><div class="stat-top"><span class="stat-label">Available Codes</span><div class="stat-icon" style="background:rgba(244,63,94,.15);color:#fda4af;">🎁</div></div><div class="stat-value" id="statAvailable">0</div></div>
          </div>

          <div class="panel">
            <div class="panel-body">
              <div class="filter-bar">
                <select id="filterGame" class="select"><option value="">All Games</option></select>
                <button class="btn btn-primary" onclick="generateCode()">+ Generate New Code</button>
              </div>
              <div id="newCodeBanner" class="banner"></div>
              <div class="table-container">
                <table class="data-table">
                  <thead><tr><th>Game Name</th><th>Code</th><th>Status</th><th>Device</th><th>Activation Date</th></tr></thead>
                  <tbody id="codeBody"></tbody>
                </table>
              </div>
              <div class="pagination">
                <span id="pageInfo"></span>
                <div class="page-btns" id="pageBtns"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="view" id="view-games">
          <div class="page-header"><div><h1 class="page-title">Games</h1><p class="page-description">Kelola daftar game & konten challenge-nya</p></div></div>
          <div id="gamesList"></div>
        </div>

        <div class="view" id="view-codes">
          <div class="page-header"><div><h1 class="page-title">Activation Codes</h1><p class="page-description">Semua kode aktivasi yang pernah dibuat</p></div></div>
          <div class="panel"><div class="panel-body">
            <div class="table-container">
              <table class="data-table">
                <thead><tr><th>Game Name</th><th>Code</th><th>Status</th><th>Device</th><th>Activation Date</th></tr></thead>
                <tbody id="allCodesBody"></tbody>
              </table>
            </div>
          </div></div>
        </div>

        <div class="view" id="view-generate">
          <div class="page-header"><div><h1 class="page-title">Generate Code</h1><p class="page-description">Buat kode aktivasi baru untuk pembeli</p></div></div>
          <div class="panel"><div class="panel-body">
            <div class="form-group"><select id="generateGameSelect" class="select btn-block" style="width:100%;"></select></div>
            <button class="btn btn-primary btn-block" onclick="generateCode()">+ Generate Kode Baru</button>
            <div id="newCodeBanner2" class="banner" style="margin-top:14px;"></div>
          </div></div>
        </div>

        <div class="view" id="view-used">
          <div class="page-header"><div><h1 class="page-title">Used Codes</h1><p class="page-description">Kode yang sudah diaktivasi pembeli</p></div></div>
          <div class="panel"><div class="panel-body">
            <div class="table-container">
              <table class="data-table">
                <thead><tr><th>Game Name</th><th>Code</th><th>Device</th><th>Activation Date</th></tr></thead>
                <tbody id="usedCodesBody"></tbody>
              </table>
            </div>
          </div></div>
        </div>

        <div class="view" id="view-settings">
          <div class="page-header"><div><h1 class="page-title">Settings</h1><p class="page-description">Pengaturan akun admin</p></div></div>
          <div class="panel"><div class="panel-body muted" style="line-height:1.6;">
            Password admin diatur lewat <b>Secret ADMIN_PASSWORD</b> di Cloudflare Worker Settings, bukan dari sini (demi keamanan).<br><br>
            Untuk ganti password, buka Worker <b>lovedare-api → Settings → Variables and Secrets</b>.
          </div></div>
        </div>

      </div>
    </div>

    <nav class="mobile-bottom-nav">
      <div class="navitem active" data-view="dashboard"><span class="nav-icon">📊</span><span class="nav-text">Home</span></div>
      <div class="navitem" data-view="games"><span class="nav-icon">🎮</span><span class="nav-text">Games</span></div>
      <div class="navitem" data-view="codes"><span class="nav-icon">🎟️</span><span class="nav-text">Codes</span></div>
      <div class="navitem" data-view="generate"><span class="nav-icon">➕</span><span class="nav-text">Add</span></div>
      <div class="navitem" data-view="settings"><span class="nav-icon">⚙️</span><span class="nav-text">Settings</span></div>
    </nav>
  </div>
</div>

<script>
window.onerror = function(msg, url, line, col, err) {
  var el = document.getElementById('loginErr');
  if (el) { el.style.display = 'block'; el.textContent = 'JS ERROR: ' + msg + ' (baris ' + line + ')'; }
  return false;
};
window.addEventListener('unhandledrejection', function(e) {
  var el = document.getElementById('loginErr');
  var reason = e.reason && e.reason.message ? e.reason.message : e.reason;
  if (el) { el.style.display = 'block'; el.textContent = 'PROMISE ERROR: ' + reason; }
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

function toggleSidebar() {
  if (window.innerWidth < 768) {
    document.body.classList.toggle('sidebar-open');
  } else {
    document.body.classList.toggle('sidebar-collapsed');
  }
}
function closeSidebar() {
  document.body.classList.remove('sidebar-open');
}

function login() {
  adminPass = document.getElementById('passInput').value;
  const errEl = document.getElementById('loginErr');
  errEl.style.display = 'none';
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
      errEl.style.display = 'block';
      if (e.message === 'WRONG_PASSWORD') {
        errEl.textContent = 'Password salah! (Server merespons: Unauthorized)';
      } else if (e.message && e.message.startsWith('SERVER_ERROR_')) {
        errEl.textContent = 'Error server: ' + e.message.replace('SERVER_ERROR_', 'kode ');
      } else {
        errEl.textContent = 'Gagal terhubung ke server (cek koneksi internet / CORS): ' + e.message;
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
    const view = item.dataset.view;
    document.querySelectorAll('.navitem').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.navitem[data-view="' + view + '"]').forEach(n => n.classList.add('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    if (window.innerWidth < 768) closeSidebar();
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
    b1.style.display = 'flex'; b1.textContent = msg;
    b2.style.display = 'flex'; b2.textContent = msg;
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
    '<td data-label="Game" class="game-cell">💗 ' + c.game_name + '</td>' +
    '<td data-label="Code"><div class="code-cell"><span class="code">' + c.code + '</span> <span class="copy-btn" onclick="copyCode(\\'' + c.code + '\\')">📋</span></div></td>' +
    '<td data-label="Status"><span class="status ' + (c.status==='ACTIVATED'?'status-activated':'status-unused') + '">' + c.status + '</span></td>' +
    '<td data-label="Device" class="muted">' + deviceLabel(c) + '</td>' +
    '<td data-label="Activation Date" class="muted">' + (c.activated_at || '—') + '</td>' +
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
      '<td data-label="Game" class="game-cell">💗 ' + c.game_name + '</td>' +
      '<td data-label="Code"><span class="code">' + c.code + '</span></td>' +
      '<td data-label="Device" class="muted">' + deviceLabel(c) + '</td>' +
      '<td data-label="Activation Date" class="muted">' + (c.activated_at || '—') + '</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="4" class="muted" style="text-align:center; padding:30px;">Belum ada kode terpakai</td></tr>';
}

function renderGamesList() {
  const el = document.getElementById('gamesList');
  el.innerHTML = allGames.map(function(g) {
    const codesForGame = allCodes.filter(function(c){ return c.game_slug === g.slug; });
    const used = codesForGame.filter(function(c){ return c.status === 'ACTIVATED'; }).length;
    return '<div class="panel game-card">' +
      '<div class="game-card-head">' +
      '<div><b>💗 ' + g.name + '</b> <span class="muted" style="font-size:0.8rem;">(' + g.slug + ')</span></div>' +
      '<div class="muted" style="font-size:0.85rem;">' + codesForGame.length + ' kode • ' + used + ' terpakai</div>' +
      '</div>' +
      '<button class="btn" style="font-size:0.8rem; padding:8px 14px;" onclick="editContent(\\'' + g.slug + '\\')">✏️ Edit Konten Game</button>' +
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
        '<textarea class="textarea" id="contentArea-' + slug + '">' + contentJson + '</textarea>' +
        '<button class="btn btn-primary" onclick="saveContent(\\'' + slug + '\\')">💾 Simpan Perubahan</button>' +
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
