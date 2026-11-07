(function () {
  "use strict";
  var C = window.APP_CONFIG || {};
  var isNative = !!(window.Native && window.Native.get);
  var $app = document.getElementById("app");
  var DNS = (C.dns || []).slice();
  if (!isNative) {
    var m = /[?&]dns=([^&]+)/.exec(location.search);
    if (m) DNS = [decodeURIComponent(m[1])];
  }

  // ---------------- utilidades ----------------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    s = String(s || "").toLowerCase();
    return s.normalize ? s.normalize("NFD").replace(/[̀-ͯ]/g, "") : s;
  }
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var toastTimer;
  function toast(msg, ms) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = "none"; }, ms || 2800);
  }
  function busy(on, text) {
    document.getElementById("busyText").textContent = text || "Carregando...";
    document.getElementById("busy").className = on ? "show" : "";
  }
  function fmtDate(ts) {
    if (!ts || ts === "null") return "Ilimitado";
    var d = new Date(Number(ts) * 1000);
    function z(n) { return n < 10 ? "0" + n : n; }
    return z(d.getDate()) + "/" + z(d.getMonth() + 1) + "/" + d.getFullYear();
  }
  function clock() {
    var d = new Date();
    function z(n) { return n < 10 ? "0" + n : n; }
    return z(d.getHours()) + ":" + z(d.getMinutes());
  }
  setInterval(function () {
    var els = document.querySelectorAll(".clock");
    for (var i = 0; i < els.length; i++) els[i].textContent = clock();
  }, 20000);

  // ---------------- rede ----------------
  var cbSeq = 0, cbs = {};
  function decodeB64(b) {
    var bin = atob(b);
    if (window.TextDecoder) {
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8").decode(arr);
    }
    try { return decodeURIComponent(escape(bin)); } catch (e) { return bin; }
  }
  window.__nativeCb = function (id, ok, b64) {
    var f = cbs[id]; delete cbs[id];
    if (f) f(ok, decodeB64(b64));
  };
  function httpGet(url) {
    return new Promise(function (resolve, reject) {
      if (isNative) {
        var id = "c" + (++cbSeq);
        cbs[id] = function (ok, text) { ok ? resolve(text) : reject(new Error(text)); };
        window.Native.get(id, url);
      } else {
        fetch(url).then(function (r) { return r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status)); }).then(resolve, reject);
      }
    });
  }

  var creds = load("creds", null); // {dns, user, pass}
  var account = load("account", null);
  var cache = {};

  function baseApi(dns, u, p) {
    return dns.replace(/\/+$/, "") + "/player_api.php?username=" + encodeURIComponent(u) + "&password=" + encodeURIComponent(p);
  }
  function api(action, extra) {
    var key = action + "|" + (extra || "");
    if (cache[key]) return Promise.resolve(cache[key]);
    var url = baseApi(creds.dns, creds.user, creds.pass) + "&action=" + action + (extra || "");
    return httpGet(url).then(function (t) {
      var d;
      try { d = JSON.parse(t); } catch (e) { throw new Error("Resposta inválida do servidor"); }
      cache[key] = d;
      return d;
    });
  }
  function streamUrl(kind, id, ext) {
    var b = creds.dns.replace(/\/+$/, "");
    return b + "/" + kind + "/" + encodeURIComponent(creds.user) + "/" + encodeURIComponent(creds.pass) + "/" + id + "." + ext;
  }
  function liveExt() {
    var f = (account && account.allowed_output_formats) || [];
    if (!f.length || f.indexOf("ts") >= 0) return "ts";
    return "m3u8";
  }
  function play(urls, titles, index, live) {
    var data = { urls: urls, titles: titles, index: index || 0, live: !!live };
    if (isNative) window.Native.play(JSON.stringify(data));
    else toast("▶ " + titles[index || 0] + " (o vídeo abre no app instalado)");
  }

  function tryLogin(user, pass) {
    var i = 0, lastErr = "Não foi possível conectar ao servidor";
    function next() {
      if (i >= DNS.length) return Promise.reject(new Error(lastErr));
      var dns = DNS[i++];
      return httpGet(baseApi(dns, user, pass)).then(function (t) {
        var d = JSON.parse(t);
        if (d && d.user_info && String(d.user_info.auth) === "1") return { dns: dns, info: d.user_info };
        lastErr = "Usuário ou senha incorretos";
        return next();
      }, function () { return next(); });
    }
    return next();
  }

  // ---------------- favoritos ----------------
  function favs(type) { return load("fav_" + type, {}); }
  function isFav(type, id) { return !!favs(type)[id]; }
  function toggleFav(type, item, id) {
    var f = favs(type);
    if (f[id]) { delete f[id]; toast("Removido dos favoritos"); }
    else { f[id] = item; toast("★ Adicionado aos favoritos"); }
    save("fav_" + type, f);
    return !!f[id];
  }

  // ---------------- navegação por controle ----------------
  function focusables() {
    var all = $app.querySelectorAll(".focusable"), out = [];
    for (var i = 0; i < all.length; i++) if (all[i].offsetParent !== null) out.push(all[i]);
    return out;
  }
  function ensureVisible(el) {
    // Rola todas as áreas (vertical e horizontal) até o item ficar visível
    var p = el.parentElement, m = 24;
    while (p && p !== document.body) {
      var s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) {
        var r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
        if (r.top < pr.top + m) p.scrollTop -= (pr.top + m - r.top);
        else if (r.bottom > pr.bottom - m) p.scrollTop += (r.bottom - pr.bottom + m);
      }
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) {
        var r2 = el.getBoundingClientRect(), pr2 = p.getBoundingClientRect();
        if (r2.left < pr2.left + m) p.scrollLeft -= (pr2.left + m - r2.left);
        else if (r2.right > pr2.right - m) p.scrollLeft += (r2.right - pr2.right + m);
      }
      p = p.parentElement;
    }
  }
  function focusEl(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    ensureVisible(el);
    if (el.onfocusnav) el.onfocusnav();
  }
  function focusFirst(sel) {
    var el = sel ? $app.querySelector(sel) : null;
    if (!el) el = focusables()[0];
    focusEl(el);
  }
  function move(dir) {
    var cur = document.activeElement, list = focusables();
    if (!cur || list.indexOf(cur) < 0) { focusEl(list[0]); return; }
    var r = cur.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var best = null, bestScore = Infinity;
    var zoneSel = ".rail,.groups,.chans,.content,.detail,.login-box,.devs";
    var myZone = cur.closest ? cur.closest(zoneSel) : null;
    if (myZone && (dir === "up" || dir === "down") && !myZone.classList.contains("top")) {
      // Primeiro tenta ficar na mesma área (lista, menu lateral...)
      var same = [];
      for (var z = 0; z < list.length; z++) if (list[z].closest(zoneSel) === myZone) same.push(list[z]);
      var hasMore = false;
      for (var y = 0; y < same.length; y++) {
        if (same[y] === cur) continue;
        var qq = same[y].getBoundingClientRect(), my = qq.top + qq.height / 2;
        if (dir === "down" ? my > cy + 2 : my < cy - 2) { hasMore = true; break; }
      }
      if (hasMore || dir === "down") list = same;
    }
    for (var i = 0; i < list.length; i++) {
      var e = list[i]; if (e === cur) continue;
      var q = e.getBoundingClientRect();
      var ex = q.left + q.width / 2, ey = q.top + q.height / 2, primary, secondary, overlap;
      if (dir === "right") { if (ex <= cx + 2 || q.left < r.left + 2) continue; primary = Math.max(0, q.left - r.right); secondary = Math.abs(ey - cy); overlap = q.top < r.bottom && q.bottom > r.top; }
      else if (dir === "left") { if (ex >= cx - 2 || q.right > r.right - 2) continue; primary = Math.max(0, r.left - q.right); secondary = Math.abs(ey - cy); overlap = q.top < r.bottom && q.bottom > r.top; }
      else if (dir === "down") { if (ey <= cy + 2 || q.top < r.top + 2) continue; primary = Math.max(0, q.top - r.bottom); secondary = Math.abs(ex - cx); overlap = q.left < r.right && q.right > r.left; }
      else { if (ey >= cy - 2 || q.bottom > r.bottom - 2) continue; primary = Math.max(0, r.top - q.bottom); secondary = Math.abs(ex - cx); overlap = q.left < r.right && q.right > r.left; }
      var score = primary + secondary * (overlap ? 0.3 : 2) + (overlap ? 0 : 400);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) focusEl(best);
  }
  document.addEventListener("keydown", function (e) {
    var k = e.keyCode, a = document.activeElement;
    var isInput = a && a.tagName === "INPUT";
    if (k >= 37 && k <= 40) {
      if (isInput && (k === 37 || k === 39) && a.value) return;
      e.preventDefault();
      move({ 37: "left", 38: "up", 39: "right", 40: "down" }[k]);
    } else if (k === 13 || k === 23) {
      if (isInput) { if (a.onenter) { e.preventDefault(); a.onenter(); } return; }
      e.preventDefault();
      if (a && a.classList && a.classList.contains("focusable")) a.click(); else focusFirst();
    } else if (k === 27 && !isNative) {
      e.preventDefault(); window.appBack();
    }
  });

  // ---------------- pilha de telas ----------------
  var stack = [], current = null, lastBack = 0;
  function show(screen) {
    current = screen;
    screen.render();
  }
  function go(screen) {
    if (current) { current.focusKey = activeKey(); stack.push(current); }
    show(screen);
  }
  function activeKey() {
    var a = document.activeElement;
    return a && a.getAttribute ? a.getAttribute("data-k") : null;
  }
  function restore(screen, fallback) {
    var el = screen.focusKey ? $app.querySelector('[data-k="' + screen.focusKey.replace(/"/g, "") + '"]') : null;
    if (el) focusEl(el); else focusFirst(fallback);
  }
  window.appBack = function () {
    if (document.getElementById("busy").className === "show") return true;
    if (stack.length) {
      var prev = stack.pop();
      current = prev;
      prev.render(true);
      return true;
    }
    if (current && current.name === "home") {
      var now = Date.now();
      if (now - lastBack < 2200) return false;
      lastBack = now;
      toast("Pressione voltar novamente para sair");
      return true;
    }
    return false;
  };

  function recent(all, field, n) { return all.slice().sort(function (a, b) { return (Number(b[field]) || 0) - (Number(a[field]) || 0); }).slice(0, n); }

  // ================= TVPlus+ P2P — telas =================
  var ICON = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 20v-5h4v5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    sport: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 3v5M16 3v5M8 13l3 3 5-6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    tv: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="16.5" font-size="6.5" text-anchor="middle" fill="currentColor" font-weight="700">TV</text></svg>',
    vod: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="7.5" r="1.8" fill="currentColor"/><circle cx="12" cy="16.5" r="1.8" fill="currentColor"/><circle cx="7.5" cy="12" r="1.8" fill="currentColor"/><circle cx="16.5" cy="12" r="1.8" fill="currentColor"/></svg>',
    hist: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    set: '<svg viewBox="0 0 24 24"><path d="M6 3v18M12 3v18M18 3v18" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="9" r="2.2" fill="#2c3f6b" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="15" r="2.2" fill="#2c3f6b" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="8" r="2.2" fill="#2c3f6b" stroke="currentColor" stroke-width="2"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 18c2-3 4-4 7-4s5 1 7 4" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10V7a4 4 0 018 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4 21c1-5 4-7 8-7s7 2 8 7z" fill="currentColor"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15 15l6 6" stroke="currentColor" stroke-width="2.4"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2l3 7 7 .6-5.3 4.7L18.5 22 12 18l-6.5 4 1.8-7.7L2 9.6 9 9z" fill="currentColor"/></svg>',
    tvbig: '<svg viewBox="0 0 48 48"><rect x="5" y="12" width="38" height="26" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 4l8 8 8-8M14 42h20" fill="none" stroke="currentColor" stroke-width="3"/><text x="24" y="31" font-size="13" text-anchor="middle" fill="currentColor" font-weight="800">TV</text></svg>',
    phone: '<svg viewBox="0 0 48 48"><rect x="13" y="4" width="22" height="40" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="38" r="2" fill="currentColor"/></svg>',
    trophy: '<svg viewBox="0 0 48 48"><path d="M14 6h20v10a10 10 0 01-20 0z" fill="#3cc4ff"/><path d="M14 9H7a6 6 0 006 8M34 9h7a6 6 0 01-6 8" fill="none" stroke="#fff" stroke-width="3"/><path d="M20 30h8v6h6v6H14v-6h6z" fill="#fff"/></svg>',
    cal: '<svg viewBox="0 0 48 48"><rect x="6" y="9" width="36" height="32" rx="3" fill="#fff"/><rect x="6" y="9" width="36" height="8" fill="#3cc4ff"/><path d="M12 24h10M12 30h10M27 24h9M27 30h9" stroke="#2c3f6b" stroke-width="3"/></svg>',
    table: '<svg viewBox="0 0 48 48"><rect x="18" y="14" width="12" height="28" fill="#3cc4ff"/><rect x="6" y="24" width="12" height="18" fill="#fff"/><rect x="30" y="29" width="12" height="13" fill="#fff"/><text x="24" y="26" font-size="9" text-anchor="middle" fill="#fff" font-weight="800">1</text></svg>'
  };
  function wm() { // marca d'água TVPlus+ no fundo
    var s = "";
    for (var i = 0; i < 18; i++) s += "<span>TVPlus+</span>";
    return '<div class="wm">' + s + "</div>";
  }
  var device = load("device", null);
  function applyDevice() { document.body.className = device === "phone" ? "phone" : "tv"; }
  applyDevice();
  var history = load("hist", []);
  function addHist(item) {
    history = history.filter(function (h) { return h.k !== item.k; });
    history.unshift(item); history = history.slice(0, 40); save("hist", history);
  }

  // ---------- tela: tipo de dispositivo ----------
  function deviceScreen(after) {
    return {
      name: "device",
      render: function () {
        var sel = device || "tv";
        $app.innerHTML = '<div class="devs-wrap">' + wm() + '<div class="devs"><h1>Selecione seu tipo de dispositivo</h1>' +
          '<p>Para uma melhor experiência de uso, selecione corretamente o tipo de dispositivo que você está utilizando. Se desejar alterar o tipo selecionado, você pode fazê-lo na página de configurações.</p>' +
          '<div class="devrow"><button class="dev focusable" data-d="tv">' + ICON.tvbig + '<span class="radio"></span> TV</button>' +
          '<button class="dev focusable" data-d="phone">' + ICON.phone + '<span class="radio"></span> Celular</button></div>' +
          '<button class="btn-confirm focusable" data-k="ok">CONFIRMAR</button></div></div>';
        function mark() {
          var b = $app.querySelectorAll(".dev");
          for (var i = 0; i < b.length; i++) b[i].classList.toggle("on", b[i].getAttribute("data-d") === sel);
        }
        var b = $app.querySelectorAll(".dev");
        for (var i = 0; i < b.length; i++) b[i].onclick = function () { sel = this.getAttribute("data-d"); mark(); focusEl($app.querySelector(".btn-confirm")); };
        mark();
        $app.querySelector(".btn-confirm").onclick = function () { device = sel; save("device", sel); applyDevice(); after(); };
        focusFirst('[data-d="' + sel + '"]');
      }
    };
  }

  // ---------- tela: login ----------
  function loginScreen(msg) {
    return {
      name: "login",
      render: function () {
        $app.innerHTML = '<div class="login">' + wm() + '<div class="login-box"><div class="lb-head">' + ICON.user + '</div><div class="lb-body">' +
          '<h2>Login com nome de usuário!</h2>' +
          '<label class="lf">' + ICON.person + '<input id="u" class="focusable" placeholder="Usuário" autocomplete="off" autocapitalize="none"></label>' +
          '<label class="lf">' + ICON.lock + '<input id="p" class="focusable" type="password" placeholder="Senha" autocomplete="off" autocapitalize="none"><button class="eye focusable" type="button">' + ICON.eye + '</button></label>' +
          '<div class="msg">' + esc(msg || "") + '</div>' +
          '<button class="btn-login focusable">LOGIN</button>' +
          (C.whatsapp ? '<div class="support">Suporte: WhatsApp ' + esc(fmtPhone(C.whatsapp)) + '</div>' : "") +
          '</div></div></div>';
        var u = $app.querySelector("#u"), p = $app.querySelector("#p");
        if (creds) { u.value = creds.user; }
        u.onenter = function () { focusEl(p); };
        p.onenter = submit;
        $app.querySelector(".eye").onclick = function () { p.type = p.type === "password" ? "text" : "password"; };
        $app.querySelector(".btn-login").onclick = submit;
        function submit() {
          var user = u.value.trim(), pass = p.value.trim();
          if (!user || !pass) { $app.querySelector(".msg").textContent = "Digite usuário e senha"; return; }
          busy(true, "Entrando...");
          tryLogin(user, pass).then(function (r) {
            busy(false);
            creds = { dns: r.dns, user: user, pass: pass }; account = r.info;
            save("creds", creds); save("account", account); cache = {};
            stack = []; show(homeScreen());
          }, function (e) { busy(false); $app.querySelector(".msg").textContent = e.message; });
        }
        focusEl(u);
      }
    };
  }
  function fmtPhone(n) {
    n = String(n).replace(/\D/g, "").replace(/^55/, "");
    return n.length === 11 ? "(" + n.slice(0, 2) + ") " + n.slice(2, 7) + "-" + n.slice(7) : n;
  }

  // ---------- estrutura com menu lateral ----------
  var TABS = [["home", "Início"], ["sport", "Esportes"], ["tv", "TV ao Vivo"], ["vod", "Filmes e Séries"], ["hist", "Histórico"], ["set", "Configurações"]];
  function frame(tab, inner) {
    var r = "";
    for (var i = 0; i < TABS.length; i++)
      r += '<button class="ri focusable' + (TABS[i][0] === tab ? " on" : "") + '" data-k="rail-' + TABS[i][0] + '" data-t="' + TABS[i][0] + '" title="' + TABS[i][1] + '">' + ICON[TABS[i][0]] + "</button>";
    return '<div class="shell">' + wm() + '<nav class="rail">' + r + '</nav><main class="main">' + inner + "</main></div>";
  }
  function bindRail(tab) {
    var b = $app.querySelectorAll(".ri");
    for (var i = 0; i < b.length; i++) b[i].onclick = function () {
      var t = this.getAttribute("data-t");
      if (t === tab) return;
      stack = []; show(SCREENS[t]());
    };
  }
  var SCREENS = {
    home: function () { return homeScreen(); }, sport: function () { return sportScreen(); },
    tv: function () { return liveScreen(); }, vod: function () { return vodScreen("movie"); },
    hist: function () { return histScreen(); }, set: function () { return setScreen(); }
  };

  // ---------- Início ----------
  var PLATFORMS = ["Netflix", "Prime Video", "Disney", "HBO", "Max", "Globoplay", "Paramount", "Apple", "Star", "Crunchyroll", "Discovery"];
  function homeScreen() {
    return {
      name: "home",
      render: function (back) {
        $app.innerHTML = frame("home",
          '<div class="hhead"><span>' + ICON.user + " " + esc(creds.user) + '</span><span>' + ICON.cal.replace('viewBox="0 0 48 48"', 'viewBox="0 0 48 48" class="mini"') + " " + esc(fmtDate(account && account.exp_date)) + '</span><span class="clock">' + clock() + "</span></div>" +
          '<button class="banner focusable" data-k="banner"><div class="bimg"></div><div class="btxt"><b></b><small>Toque para assistir</small></div></button>' +
          '<div class="plats"></div>');
        bindRail("home");
        var slides = [], si = 0;
        var bimg = $app.querySelector(".bimg"), bt = $app.querySelector(".btxt b");
        function slide() {
          if (!slides.length || !document.body.contains(bimg)) return;
          var s = slides[si % slides.length]; si++;
          bimg.style.backgroundImage = "url('" + s.img.replace(/'/g, "%27") + "')"; bt.textContent = s.name;
          $app.querySelector(".banner").onclick = function () { openItem(s.type, s.it); };
        }
        api("get_series").then(function (list) {
          (list || []).slice().sort(function (a, b) { return (Number(b.last_modified) || 0) - (Number(a.last_modified) || 0); }).slice(0, 40).forEach(function (s) {
            var bd = s.backdrop_path && s.backdrop_path[0];
            if (bd && slides.length < 8) slides.push({ img: bd, name: s.name, type: "series", it: s });
          });
          if (!slides.length) return api("get_vod_streams").then(function (v) {
            recent(v || [], "added", 8).forEach(function (m) { if (m.stream_icon) slides.push({ img: m.stream_icon, name: m.name, type: "movie", it: m }); });
          });
        }).then(function () { slide(); var t = setInterval(function () { if (!document.body.contains(bimg)) clearInterval(t); else slide(); }, 7000); }, function () {});
        Promise.all([api("get_vod_categories").catch(function () { return []; }), api("get_series_categories").catch(function () { return []; })]).then(function (r) {
          var h = "", used = {};
          PLATFORMS.forEach(function (pn) {
            var key = norm(pn), found = null, kind = "movie";
            (r[1] || []).forEach(function (c) { if (!found && norm(c.category_name).indexOf(key) >= 0) { found = c; kind = "series"; } });
            (r[0] || []).forEach(function (c) { if (!found && norm(c.category_name).indexOf(key) >= 0) { found = c; kind = "movie"; } });
            if (found && !used[found.category_id + kind]) {
              used[found.category_id + kind] = 1;
              h += '<button class="plat focusable" data-k="pl-' + esc(found.category_id) + '" data-kind="' + kind + '" data-c="' + esc(found.category_id) + '"><span>' + esc(pn) + "</span></button>";
            }
          });
          var box = $app.querySelector(".plats"); if (!box) return;
          box.innerHTML = h;
          var b = box.querySelectorAll(".plat");
          for (var i = 0; i < b.length; i++) b[i].onclick = function () { go(vodScreen(this.getAttribute("data-kind"), this.getAttribute("data-c"))); };
        });
        if (back) restore(this, ".banner"); else focusEl($app.querySelector(".banner"));
      }
    };
  }

  // ---------- TV ao Vivo (grupos | canais | guia) ----------
  function b64(s) { try { return decodeURIComponent(escape(atob(s || ""))); } catch (e) { return s || ""; } }
  function hhmm(ts) { var d = new Date(Number(ts) * 1000); function z(n) { return n < 10 ? "0" + n : n; } return z(d.getHours()) + ":" + z(d.getMinutes()); }
  function liveScreen() {
    var sel = load("lastLiveCat", "all");
    return {
      name: "live",
      render: function (back) {
        var self = this;
        $app.innerHTML = frame("tv", '<div class="three"><div class="groups"></div><div class="chans"><div class="empty">Carregando canais...</div></div><div class="guide"><div class="gprev"></div><div class="glist"></div></div></div>');
        bindRail("tv");
        Promise.all([api("get_live_categories"), api("get_live_streams")]).then(function (r) {
          var cats = r[0] || [], all = r[1] || [];
          var g = '<button class="gi focusable" data-k="g-search" data-g="search">' + ICON.search + ' Buscar</button>' +
            '<button class="gi focusable" data-k="g-fav" data-g="fav">' + ICON.star + ' Favoritos</button>' +
            '<button class="gi focusable" data-k="g-all" data-g="all">Tudo: A-Z</button>';
          cats.forEach(function (c) { g += '<button class="gi focusable" data-k="g-' + esc(c.category_id) + '" data-g="' + esc(c.category_id) + '">' + esc(c.category_name) + "</button>"; });
          var gb = $app.querySelector(".groups"); gb.innerHTML = g;
          var gi = gb.querySelectorAll(".gi");
          for (var i = 0; i < gi.length; i++) gi[i].onclick = function () {
            var v = this.getAttribute("data-g");
            if (v === "search") { var q = prompt("Buscar canal:"); if (!q) return; fill(all.filter(function (c) { return norm(c.name).indexOf(norm(q)) >= 0; }), "search"); }
            else { sel = v; save("lastLiveCat", v); fill(pick(v), v); }
            var first = $app.querySelector(".ch"); if (first) focusEl(first);
          };
          function pick(v) {
            if (v === "fav") { var f = favs("live"); return all.filter(function (c) { return f[c.stream_id]; }); }
            if (v === "all") return all.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
            return all.filter(function (c) { return String(c.category_id) === String(v); });
          }
          function fill(list, v) {
            var on = gb.querySelectorAll(".gi");
            for (var j = 0; j < on.length; j++) on[j].classList.toggle("on", on[j].getAttribute("data-g") === v);
            var h = "";
            list.slice(0, 600).forEach(function (c, idx) {
              h += '<button class="ch focusable" data-k="ch-' + c.stream_id + '" data-i="' + idx + '">' +
                (c.stream_icon ? '<img loading="lazy" src="' + esc(c.stream_icon) + '" onerror="this.style.visibility=\'hidden\'">' : "<i></i>") +
                "<span>" + esc(c.name) + (isFav("live", c.stream_id) ? " ★" : "") + "</span></button>";
            });
            var cb = $app.querySelector(".chans");
            cb.innerHTML = h || '<div class="empty">Nenhum canal aqui</div>';
            var urls = list.map(function (c) { return streamUrl("live", c.stream_id, liveExt()); });
            var names = list.map(function (c) { return c.name; });
            var ch = cb.querySelectorAll(".ch");
            for (var k = 0; k < ch.length; k++) {
              ch[k].onclick = function () {
                var i2 = Number(this.getAttribute("data-i")), c = list[i2];
                addHist({ k: "l" + c.stream_id, type: "live", name: c.name, img: c.stream_icon, id: c.stream_id });
                play(urls, names, i2, true);
              };
              ch[k].onfocusnav = (function (c) { return function () { guide(c); }; })(list[k]);
              ch[k].oncontextmenu = (function (c) { return function (e) { e.preventDefault(); toggleFav("live", c, c.stream_id); }; })(list[k]);
            }
          }
          var gt = 0;
          function guide(c) {
            $app.querySelector(".gprev").innerHTML = (c.stream_icon ? '<img src="' + esc(c.stream_icon) + '">' : "") + "<b>" + esc(c.name) + "</b><small>OK assiste · segure OK p/ favoritar</small>";
            var gl = $app.querySelector(".glist"); gl.innerHTML = '<div class="empty">Carregando guia...</div>';
            clearTimeout(gt);
            gt = setTimeout(function () {
              api("get_short_epg", "&stream_id=" + c.stream_id + "&limit=6").then(function (d) {
                var l = (d && d.epg_listings) || [], h = "";
                l.forEach(function (e, n) { h += '<div class="ep' + (n === 0 ? " now" : "") + '"><time>' + hhmm(e.start_timestamp) + "–" + hhmm(e.stop_timestamp) + "</time><span>" + esc(b64(e.title)) + "</span></div>"; });
                gl.innerHTML = h || '<div class="empty">Sem guia de programação</div>';
              }, function () { gl.innerHTML = '<div class="empty">Sem guia de programação</div>'; });
            }, 350);
          }
          fill(pick(sel), sel);
          if (back) restore(self, ".ch"); else focusEl($app.querySelector(".ch") || $app.querySelector(".gi"));
        }, function (e) { $app.querySelector(".chans").innerHTML = '<div class="empty">Erro: ' + esc(e.message) + "</div>"; });
      }
    };
  }
  // segurar OK = favoritar (controle remoto)
  var okDown = 0;
  document.addEventListener("keydown", function (e) { if ((e.keyCode === 13 || e.keyCode === 23) && !e.repeat) okDown = Date.now(); else if ((e.keyCode === 13 || e.keyCode === 23) && e.repeat && okDown && Date.now() - okDown > 700) { okDown = 0; var a = document.activeElement; if (a && a.oncontextmenu) a.oncontextmenu({ preventDefault: function () {} }); } }, true);

  // ---------- Filmes e Séries ----------
  function vodScreen(kind, catId) {
    var st = { kind: kind || "movie", cat: catId || "new" };
    return {
      name: "vod",
      render: function (back) {
        var self = this;
        $app.innerHTML = frame("vod", '<div class="two"><div class="groups"></div><div class="content"><div class="tabs"></div><div class="grid"><div class="empty">Carregando...</div></div></div></div>');
        bindRail("vod");
        var isS = st.kind === "series";
        Promise.all([api(isS ? "get_series_categories" : "get_vod_categories"), api(isS ? "get_series" : "get_vod_streams")]).then(function (r) {
          var cats = r[0] || [], all = r[1] || [];
          var g = '<button class="gi focusable" data-k="v-search" data-g="search">' + ICON.search + ' Buscar</button>' +
            '<button class="gi focusable' + (!isS ? " sel" : "") + '" data-k="v-movie" data-kind="movie">Filmes</button>' +
            '<button class="gi focusable' + (isS ? " sel" : "") + '" data-k="v-series" data-kind="series">Séries</button>' +
            '<button class="gi focusable" data-k="v-new" data-g="new">' + (isS ? "Novidades" : "Lançamentos") + "</button>" +
            '<button class="gi focusable" data-k="v-fav" data-g="fav">' + ICON.star + " Favoritos</button>";
          cats.forEach(function (c) { g += '<button class="gi focusable" data-k="v-' + esc(c.category_id) + '" data-g="' + esc(c.category_id) + '">' + esc(c.category_name) + "</button>"; });
          var gb = $app.querySelector(".groups"); gb.innerHTML = g;
          var gi = gb.querySelectorAll(".gi");
          for (var i = 0; i < gi.length; i++) gi[i].onclick = function () {
            var kd = this.getAttribute("data-kind");
            if (kd) { if (kd !== st.kind) { st.kind = kd; st.cat = "new"; self.render(); } return; }
            var v = this.getAttribute("data-g");
            if (v === "search") { var q = prompt("Buscar:"); if (!q) return; grid(all.filter(function (m) { return norm(m.name).indexOf(norm(q)) >= 0; }), "search"); }
            else { st.cat = v; grid(pick(v), v); }
            var f = $app.querySelector(".card"); if (f) focusEl(f);
          };
          function pick(v) {
            if (v === "new") return recent(all, isS ? "last_modified" : "added", 60);
            if (v === "fav") { var f = favs(st.kind); return all.filter(function (m) { return f[isS ? m.series_id : m.stream_id]; }); }
            return all.filter(function (m) { return String(m.category_id) === String(v); });
          }
          function grid(list, v) {
            var on = gb.querySelectorAll(".gi[data-g]");
            for (var j = 0; j < on.length; j++) on[j].classList.toggle("on", on[j].getAttribute("data-g") === v);
            var h = "";
            list.slice(0, 300).forEach(function (m, idx) {
              var img = isS ? m.cover : m.stream_icon;
              h += '<button class="card focusable" data-k="c-' + (isS ? m.series_id : m.stream_id) + '" data-i="' + idx + '"><div class="poster"' + (img ? ' style="background-image:url(\'' + esc(img).replace(/'/g, "%27") + '\')"' : "") + '></div><span>' + esc(m.name) + "</span></button>";
            });
            var gr = $app.querySelector(".grid"); gr.innerHTML = h || '<div class="empty">Nada por aqui</div>';
            var c = gr.querySelectorAll(".card");
            for (var k = 0; k < c.length; k++) {
              c[k].onclick = function () { openItem(st.kind, list[Number(this.getAttribute("data-i"))]); };
              c[k].oncontextmenu = (function (m) { return function (e) { e.preventDefault(); toggleFav(st.kind, m, isS ? m.series_id : m.stream_id); }; })(list[k]);
            }
          }
          grid(pick(st.cat), st.cat);
          if (back) restore(self, ".card"); else focusEl($app.querySelector(".card") || $app.querySelector(".gi"));
        }, function (e) { $app.querySelector(".grid").innerHTML = '<div class="empty">Erro: ' + esc(e.message) + "</div>"; });
      }
    };
  }
  function openItem(type, it) {
    if (type === "movie") {
      var ext = it.container_extension || "mp4";
      addHist({ k: "m" + it.stream_id, type: "movie", name: it.name, img: it.stream_icon, it: it });
      play([streamUrl("movie", it.stream_id, ext)], [it.name], 0, false);
    } else go(seriesScreen(it));
  }
  function seriesScreen(it) {
    var data = null, season = null;
    return {
      name: "series",
      render: function (back) {
        var self = this;
        $app.innerHTML = frame("vod", '<div class="detail"><div class="dhead"><div class="poster" style="background-image:url(\'' + esc(it.cover || "").replace(/'/g, "%27") + '\')"></div><div><h1>' + esc(it.name) + '</h1><p>' + esc(it.plot || "") + '</p><button class="btn-fav focusable" data-k="sfav">' + (isFav("series", it.series_id) ? "★ Nos favoritos" : "☆ Favoritar") + '</button></div></div><div class="seasons"></div><div class="eps"><div class="empty">Carregando episódios...</div></div></div>');
        bindRail("vod");
        $app.querySelector(".btn-fav").onclick = function () { toggleFav("series", it, it.series_id); this.textContent = isFav("series", it.series_id) ? "★ Nos favoritos" : "☆ Favoritar"; };
        function draw() {
          var eps = (data && data.episodes) || {}, keys = Object.keys(eps).sort(function (a, b) { return a - b; });
          if (!keys.length) { $app.querySelector(".eps").innerHTML = '<div class="empty">Sem episódios</div>'; return; }
          if (!season || !eps[season]) season = keys[0];
          $app.querySelector(".seasons").innerHTML = keys.map(function (k) { return '<button class="sbtn focusable' + (k === season ? " on" : "") + '" data-k="s-' + k + '" data-s="' + k + '">Temporada ' + k + "</button>"; }).join("");
          var list = eps[season] || [];
          $app.querySelector(".eps").innerHTML = list.map(function (e, i) { return '<button class="epb focusable" data-k="e-' + e.id + '" data-i="' + i + '"><b>' + (e.episode_num || i + 1) + "</b> " + esc(e.title || "Episódio " + (i + 1)) + "</button>"; }).join("");
          var sb = $app.querySelectorAll(".sbtn");
          for (var i = 0; i < sb.length; i++) sb[i].onclick = function () { season = this.getAttribute("data-s"); draw(); focusEl($app.querySelector(".epb")); };
          var urls = list.map(function (e) { return streamUrl("series", e.id, e.container_extension || "mp4"); });
          var names = list.map(function (e) { return it.name + " – T" + season + "E" + (e.episode_num || ""); });
          var eb = $app.querySelectorAll(".epb");
          for (var j = 0; j < eb.length; j++) eb[j].onclick = function () {
            addHist({ k: "s" + it.series_id, type: "series", name: it.name, img: it.cover, it: it });
            play(urls, names, Number(this.getAttribute("data-i")), false);
          };
        }
        if (data) { draw(); restore(self, ".epb"); return; }
        busy(true);
        api("get_series_info", "&series_id=" + it.series_id).then(function (d) { busy(false); data = d || {}; draw(); focusEl($app.querySelector(".epb") || $app.querySelector(".btn-fav")); },
          function (e) { busy(false); toast("Erro: " + e.message); });
      }
    };
  }

  // ---------- Esportes (jogos do dia e classificação) ----------
  var SPORTS_API = "https://www.thesportsdb.com/api/v1/json/3/";
  var LEAGUES = [["4351", "Brasileirão Série A"], ["4404", "Brasileirão Série B"], ["4328", "Premier League"], ["4335", "La Liga"], ["4332", "Serie A Itália"], ["4331", "Bundesliga"], ["4334", "Ligue 1"], ["4480", "Champions League"]];
  function ymd(d) { function z(n) { return n < 10 ? "0" + n : n; } return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()); }
  var WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  function sportScreen() {
    return {
      name: "sport",
      render: function () {
        $app.innerHTML = frame("sport", '<div class="sp-home"><h2>Principais eventos</h2><div class="sp-cards">' +
          '<button class="spc focusable" data-k="sp-cal" data-v="cal">' + ICON.cal + "<span>Jogos do dia</span></button>" +
          '<button class="spc focusable" data-k="sp-tab" data-v="tab">' + ICON.table + "<span>Classificação</span></button>" +
          '<button class="spc focusable" data-k="sp-tv" data-v="tv">' + ICON.trophy + "<span>Canais de esporte</span></button></div></div>");
        bindRail("sport");
        var b = $app.querySelectorAll(".spc");
        for (var i = 0; i < b.length; i++) b[i].onclick = function () {
          var v = this.getAttribute("data-v");
          if (v === "cal") go(gamesScreen());
          else if (v === "tab") go(tableScreen());
          else api("get_live_categories").then(function (c) {
            var f = (c || []).filter(function (x) { return /esport|sport|futebol|premiere|espn|combate/i.test(x.category_name); })[0];
            save("lastLiveCat", f ? f.category_id : "all"); stack = []; show(liveScreen());
          });
        };
        focusFirst(".spc");
      }
    };
  }
  function sportsGet(path) { return httpGet(SPORTS_API + path).then(function (t) { return JSON.parse(t); }); }
  function gamesScreen() {
    var day = new Date();
    return {
      name: "games",
      render: function (back) {
        var self = this, h = "";
        for (var i = -3; i <= 4; i++) {
          var d = new Date(); d.setDate(d.getDate() + i);
          h += '<button class="gi day focusable" data-k="d' + i + '" data-d="' + ymd(d) + '">' + WD[d.getDay()] + "<b>" + ymd(d).slice(8) + "/" + ymd(d).slice(5, 7) + "</b></button>";
        }
        $app.innerHTML = frame("sport", '<div class="two"><div class="groups">' + h + '</div><div class="content"><div class="hint">Jogos de futebol do dia · horários de Brasília</div><div class="games"></div></div></div>');
        bindRail("sport");
        var dd = $app.querySelectorAll(".day");
        for (var j = 0; j < dd.length; j++) dd[j].onclick = function () { load2(this.getAttribute("data-d")); };
        function load2(ds) {
          for (var j = 0; j < dd.length; j++) dd[j].classList.toggle("on", dd[j].getAttribute("data-d") === ds);
          var box = $app.querySelector(".games"); box.innerHTML = '<div class="empty">Carregando jogos...</div>';
          sportsGet("eventsday.php?d=" + ds + "&s=Soccer").then(function (r) {
            var ev = (r && r.events) || [];
            ev.sort(function (a, b) { return String(a.strTimestamp || a.strTime).localeCompare(String(b.strTimestamp || b.strTime)); });
            box.innerHTML = ev.slice(0, 120).map(function (e) {
              var t = e.strTimestamp ? new Date(e.strTimestamp + (/Z|[+-]\d\d:?\d\d$/.test(e.strTimestamp) ? "" : "Z")) : null;
              var hr = t && !isNaN(t) ? hhmm(t.getTime() / 1000) : (e.strTime || "").slice(0, 5);
              var sc = e.intHomeScore != null && e.intHomeScore !== "" ? e.intHomeScore + " - " + e.intAwayScore : hr;
              return '<div class="game focusable" tabindex="0"><small>' + esc(e.strLeague || "") + '</small><div class="gl"><span class="tm r">' + esc(e.strHomeTeam) + (e.strHomeTeamBadge ? '<img src="' + esc(e.strHomeTeamBadge) + '/tiny">' : "") + '</span><b>' + esc(sc) + "</b>" +
                '<span class="tm">' + (e.strAwayTeamBadge ? '<img src="' + esc(e.strAwayTeamBadge) + '/tiny">' : "") + esc(e.strAwayTeam) + "</span></div>" + (e.strStatus && /FT|Match Finished/i.test(e.strStatus) ? "<em>Encerrado</em>" : "") + "</div>";
            }).join("") || '<div class="empty">Nenhum jogo encontrado nesse dia</div>';
          }, function () { box.innerHTML = '<div class="empty">Não foi possível carregar os jogos agora</div>'; });
        }
        load2(ymd(day));
        focusEl($app.querySelector('.day[data-d="' + ymd(day) + '"]'));
      }
    };
  }
  function tableScreen() {
    return {
      name: "table",
      render: function () {
        var h = LEAGUES.map(function (l) { return '<button class="gi focusable" data-k="lg' + l[0] + '" data-l="' + l[0] + '">' + esc(l[1]) + "</button>"; }).join("");
        $app.innerHTML = frame("sport", '<div class="two"><div class="groups">' + h + '</div><div class="content"><div class="hint">J: Jogos · V: Vitórias · E: Empates · D: Derrotas · SG: Saldo · PTS: Pontos</div><div class="tbl"></div></div></div>');
        bindRail("sport");
        var g = $app.querySelectorAll(".gi");
        for (var i = 0; i < g.length; i++) g[i].onclick = function () { show2(this.getAttribute("data-l")); };
        function show2(id) {
          for (var i = 0; i < g.length; i++) g[i].classList.toggle("on", g[i].getAttribute("data-l") === id);
          var box = $app.querySelector(".tbl"); box.innerHTML = '<div class="empty">Carregando...</div>';
          var y = new Date().getFullYear(), season = /435[12]|4404/.test(id) ? String(y) : (new Date().getMonth() >= 6 ? y + "-" + (y + 1) : (y - 1) + "-" + y);
          sportsGet("lookuptable.php?l=" + id + "&s=" + season).then(function (r) {
            var t = (r && r.table) || [];
            box.innerHTML = t.length ? '<table><tr><th>#</th><th class="l">Time</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th><th>PTS</th></tr>' + t.map(function (x) {
              return "<tr><td>" + esc(x.intRank) + '</td><td class="l">' + (x.strBadge ? '<img src="' + esc(x.strBadge) + '/tiny">' : "") + esc(x.strTeam) + "</td><td>" + esc(x.intPlayed) + "</td><td>" + esc(x.intWin) + "</td><td>" + esc(x.intDraw) + "</td><td>" + esc(x.intLoss) + "</td><td>" + esc(x.intGoalDifference) + "</td><td><b>" + esc(x.intPoints) + "</b></td></tr>";
            }).join("") + "</table>" : '<div class="empty">Classificação indisponível</div>';
          }, function () { box.innerHTML = '<div class="empty">Não foi possível carregar agora</div>'; });
        }
        show2(LEAGUES[0][0]); focusFirst(".gi");
      }
    };
  }

  // ---------- Histórico ----------
  function histScreen() {
    return {
      name: "hist",
      render: function () {
        var h = history.map(function (x, i) {
          return '<button class="card focusable" data-k="h' + i + '" data-i="' + i + '"><div class="poster' + (x.type === "live" ? " logo" : "") + '"' + (x.img ? ' style="background-image:url(\'' + esc(x.img).replace(/'/g, "%27") + '\')"' : "") + '></div><span>' + esc(x.name) + "</span></button>";
        }).join("");
        $app.innerHTML = frame("hist", '<div class="content full"><h2>Assistidos recentemente</h2><div class="grid">' + (h || '<div class="empty">Você ainda não assistiu nada</div>') + "</div></div>");
        bindRail("hist");
        var c = $app.querySelectorAll(".card");
        for (var i = 0; i < c.length; i++) c[i].onclick = function () {
          var x = history[Number(this.getAttribute("data-i"))];
          if (x.type === "live") play([streamUrl("live", x.id, liveExt())], [x.name], 0, true); else openItem(x.type, x.it);
        };
        focusFirst(".card");
      }
    };
  }

  // ---------- Configurações ----------
  function setScreen() {
    return {
      name: "set",
      render: function () {
        $app.innerHTML = frame("set", '<div class="content full set"><h2>Configurações</h2>' +
          '<div class="info"><p>Usuário: <b>' + esc(creds.user) + "</b></p><p>Vencimento: <b>" + esc(fmtDate(account && account.exp_date)) + "</b></p><p>Telas: <b>" + esc((account && account.max_connections) || "1") + "</b></p></div>" +
          '<button class="sbtn focusable" data-a="dev">Tipo de dispositivo: ' + (device === "phone" ? "Celular" : "TV") + "</button>" +
          '<button class="sbtn focusable" data-a="hist">Limpar histórico</button>' +
          (C.whatsapp ? '<button class="sbtn focusable" data-a="wa">Suporte: WhatsApp ' + esc(fmtPhone(C.whatsapp)) + "</button>" : "") +
          '<button class="sbtn red focusable" data-a="out">Sair da conta</button></div>');
        bindRail("set");
        var b = $app.querySelectorAll(".sbtn");
        for (var i = 0; i < b.length; i++) b[i].onclick = function () {
          var a = this.getAttribute("data-a");
          if (a === "dev") show(deviceScreen(function () { show(setScreen()); }));
          else if (a === "hist") { history = []; save("hist", []); toast("Histórico limpo"); }
          else if (a === "wa") toast("Chame no WhatsApp: " + fmtPhone(C.whatsapp), 5000);
          else if (a === "out") { save("account", null); account = null; cache = {}; stack = []; show(loginScreen()); }
        };
        focusFirst(".sbtn");
      }
    };
  }

  // ---------- início ----------
  function start() { if (creds && account) show(homeScreen()); else show(loginScreen()); }
  if (!device) show(deviceScreen(start)); else start();
})();
