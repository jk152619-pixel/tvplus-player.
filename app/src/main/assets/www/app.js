(function () {
  "use strict";
  var C = window.APP_CONFIG || {};
  var isNative = !!(window.Native && window.Native.get);
  var $app = document.getElementById("app");
  var DNS = (C.dns || []).slice();
  if (!isNative) { var mq = /[?&]dns=([^&]+)/.exec(location.search); if (mq) DNS = [decodeURIComponent(mq[1])]; }

  // ================= utilidades =================
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function norm(s) { s = String(s || "").toLowerCase(); return s.normalize ? s.normalize("NFD").replace(/[̀-ͯ]/g, "") : s; }
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function z(n) { return n < 10 ? "0" + n : "" + n; }
  function hm(d) { return z(d.getHours()) + ":" + z(d.getMinutes()); }
  function clock() { return hm(new Date()); }
  function fmtDate(ts) { if (!ts || ts === "null") return "Ilimitado"; var d = new Date(Number(ts) * 1000); return z(d.getDate()) + "/" + z(d.getMonth() + 1) + "/" + d.getFullYear(); }
  function bgUrl(u) { return u ? "background-image:url('" + esc(u).replace(/'/g, "%27") + "')" : ""; }
  function b64(s) { try { var bin = atob(s || ""); var a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return window.TextDecoder ? new TextDecoder("utf-8").decode(a) : decodeURIComponent(escape(bin)); } catch (e) { return s || ""; } }
  var toastTimer;
  function toast(msg, ms) { var t = document.getElementById("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.style.display = "none"; }, ms || 2800); }
  function busy(on, text) { document.getElementById("busyText").textContent = text || "Carregando..."; document.getElementById("busy").className = on ? "show" : ""; }
  setInterval(function () { var els = document.querySelectorAll(".clock"); for (var i = 0; i < els.length; i++) els[i].textContent = clock(); }, 20000);
  function fmtPhone(n) { var d = String(n).replace(/\D/g, ""); if (d.indexOf("55") === 0 && d.length >= 12) d = d.slice(2); return d.length === 11 ? "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7) : n; }

  // ================= ícones =================
  function ico(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; }
  var I = {
    home: ico('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
    sport: ico('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M9 15l2 2 4-4"/>'),
    tv: ico('<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M8 2l4 4 4-4"/><path d="M7 22h10"/>'),
    vod: ico('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="8" r="1.6"/><circle cx="12" cy="16" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/>'),
    hist: ico('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 3"/>'),
    set: ico('<path d="M6 3v18M12 3v18M18 3v18"/><circle cx="6" cy="9" r="2.2" fill="currentColor"/><circle cx="12" cy="15" r="2.2" fill="currentColor"/><circle cx="18" cy="7" r="2.2" fill="currentColor"/>'),
    search: ico('<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>'),
    star: ico('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
    list: ico('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
    user: ico('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
    cal: ico('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    trophy: ico('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4"/><path d="M12 13v4M8 21h8M9 17h6v4H9z"/>'),
    phone: ico('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>'),
    film: ico('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
    clockI: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>')
  };

  // ================= rede =================
  var cbSeq = 0, cbs = {};
  window.__nativeCb = function (id, ok, b) { var f = cbs[id]; delete cbs[id]; if (f) f(ok, b64(b)); };
  function httpGet(url) {
    return new Promise(function (resolve, reject) {
      if (isNative) { var id = "c" + (++cbSeq); cbs[id] = function (ok, text) { ok ? resolve(text) : reject(new Error(text)); }; window.Native.get(id, url); }
      else fetch(url).then(function (r) { return r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status)); }).then(resolve, reject);
    });
  }
  function getJson(url) { return httpGet(url).then(function (t) { try { return JSON.parse(t); } catch (e) { throw new Error("Resposta inválida"); } }); }

  var creds = load("creds", null), account = load("account", null), cache = {};
  function baseApi(dns, u, p) { return dns.replace(/\/+$/, "") + "/player_api.php?username=" + encodeURIComponent(u) + "&password=" + encodeURIComponent(p); }
  function api(action, extra) {
    var key = action + "|" + (extra || "");
    if (cache[key]) return cache[key];
    var p = getJson(baseApi(creds.dns, creds.user, creds.pass) + "&action=" + action + (extra || ""));
    cache[key] = p;
    p.catch(function () { delete cache[key]; });
    return p;
  }
  function arr(p) { return p.then(function (d) { return Array.isArray(d) ? d : []; }); }
  function streamUrl(kind, id, ext) { var b = creds.dns.replace(/\/+$/, ""); return b + "/" + kind + "/" + encodeURIComponent(creds.user) + "/" + encodeURIComponent(creds.pass) + "/" + id + "." + ext; }
  function liveExt() { var f = (account && account.allowed_output_formats) || []; return (!f.length || f.indexOf("ts") >= 0) ? "ts" : "m3u8"; }
  function tryLogin(user, pass) {
    var i = 0, lastErr = "Não foi possível conectar ao servidor";
    function next() {
      if (i >= DNS.length) return Promise.reject(new Error(lastErr));
      var dns = DNS[i++];
      return getJson(baseApi(dns, user, pass)).then(function (d) {
        if (d && d.user_info && String(d.user_info.auth) === "1") return { dns: dns, info: d.user_info };
        lastErr = "Usuário ou senha incorretos"; return next();
      }, function () { return next(); });
    }
    return next();
  }

  // ================= favoritos / histórico =================
  function favs(t) { return load("fav_" + t, {}); }
  function isFav(t, id) { return !!favs(t)[id]; }
  function toggleFav(t, item, id) { var f = favs(t); if (f[id]) { delete f[id]; toast("Removido dos favoritos"); } else { f[id] = item; toast("★ Adicionado aos favoritos"); } save("fav_" + t, f); return !!f[id]; }
  function addHist(h) {
    var list = load("hist", []).filter(function (x) { return x.key !== h.key; });
    h.at = Date.now(); list.unshift(h); save("hist", list.slice(0, 40));
  }
  function play(data, hist) {
    if (hist) { hist.play = data; addHist(hist); }
    if (isNative) window.Native.play(JSON.stringify(data));
    else toast("▶ " + data.titles[data.index || 0] + " (o vídeo abre no app instalado)");
  }
  function playLive(items, idx) {
    var ext = liveExt(), start = 0, end = items.length;
    if (end > 1500) { start = Math.max(0, idx - 700); end = Math.min(items.length, start + 1500); }
    var urls = [], titles = [];
    for (var k = start; k < end; k++) { urls.push(streamUrl("live", items[k].stream_id, ext)); titles.push(items[k].name); }
    var it = items[idx];
    play({ urls: urls, titles: titles, index: idx - start, live: true }, { key: "l" + it.stream_id, kind: "live", name: it.name, img: it.stream_icon, ref: it });
  }

  // ================= navegação por controle =================
  function focusables() { var all = $app.querySelectorAll(".focusable"), out = []; for (var i = 0; i < all.length; i++) if (all[i].offsetParent !== null) out.push(all[i]); return out; }
  function ensureVisible(el) {
    var p = el.parentElement, m = 24;
    while (p && p !== document.body) {
      var s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) {
        var r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
        if (r.top < pr.top + m) p.scrollTop -= (pr.top + m - r.top); else if (r.bottom > pr.bottom - m) p.scrollTop += (r.bottom - pr.bottom + m);
      }
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) {
        var r2 = el.getBoundingClientRect(), pr2 = p.getBoundingClientRect();
        if (r2.left < pr2.left + m) p.scrollLeft -= (pr2.left + m - r2.left); else if (r2.right > pr2.right - m) p.scrollLeft += (r2.right - pr2.right + m);
      }
      p = p.parentElement;
    }
  }
  function focusEl(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } ensureVisible(el); if (el.onfocusnav) el.onfocusnav(); }
  function focusFirst(sel) { var el = sel ? $app.querySelector(sel) : null; if (!el || el.offsetParent === null) el = focusables().filter(function (x) { return !x.closest(".rail"); })[0] || focusables()[0]; focusEl(el); }
  var ZONES = ".rail,.panel,.tabs,.content,.chlist,.epg,.detail,.home,.login-box,.devbox,.set,.stiles";
  function move(dir) {
    var cur = document.activeElement, list = focusables();
    if (!cur || list.indexOf(cur) < 0) { focusFirst(); return; }
    var r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var myZone = cur.closest ? cur.closest(ZONES) : null;
    if (myZone && (dir === "up" || dir === "down")) {
      var same = [];
      for (var a = 0; a < list.length; a++) if (list[a].closest(ZONES) === myZone) same.push(list[a]);
      var hasMore = false;
      for (var y = 0; y < same.length; y++) { if (same[y] === cur) continue; var qq = same[y].getBoundingClientRect(), my = qq.top + qq.height / 2; if (dir === "down" ? my > cy + 2 : my < cy - 2) { hasMore = true; break; } }
      if (hasMore || myZone.classList.contains("rail") || myZone.classList.contains("panel") || myZone.classList.contains("chlist")) list = same;
    }
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var e = list[i]; if (e === cur) continue;
      var q = e.getBoundingClientRect(), ex = q.left + q.width / 2, ey = q.top + q.height / 2, primary, secondary, overlap;
      if (dir === "right") { if (ex <= cx + 2 || q.left < r.left + 2) continue; primary = Math.max(0, q.left - r.right); secondary = Math.abs(ey - cy); overlap = q.top < r.bottom && q.bottom > r.top; }
      else if (dir === "left") { if (ex >= cx - 2 || q.right > r.right - 2) continue; primary = Math.max(0, r.left - q.right); secondary = Math.abs(ey - cy); overlap = q.top < r.bottom && q.bottom > r.top; }
      else if (dir === "down") { if (ey <= cy + 2 || q.top < r.top + 2) continue; primary = Math.max(0, q.top - r.bottom); secondary = Math.abs(ex - cx); overlap = q.left < r.right && q.right > r.left; }
      else { if (ey >= cy - 2 || q.bottom > r.bottom - 2) continue; primary = Math.max(0, r.top - q.bottom); secondary = Math.abs(ex - cx); overlap = q.left < r.right && q.right > r.left; }
      var score = primary + secondary * (overlap ? 0.3 : 2) + (overlap ? 0 : 400);
      if (dir === "left" && e.closest(".rail") && !cur.closest(".panel,.rail")) score += 100;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) { if (dir === "left" && best.closest(".rail")) { var on = $app.querySelector(".ricon.on"); if (on && !cur.closest(".panel")) best = on; } focusEl(best); }
  }
  document.addEventListener("keydown", function (e) {
    var k = e.keyCode, a = document.activeElement, isInput = a && a.tagName === "INPUT";
    if (k >= 37 && k <= 40) { if (isInput && (k === 37 || k === 39) && a.value) return; e.preventDefault(); move({ 37: "left", 38: "up", 39: "right", 40: "down" }[k]); }
    else if (k === 13 || k === 23) { if (isInput) { if (a.onenter) { e.preventDefault(); a.onenter(); } return; } e.preventDefault(); if (a && a.classList && a.classList.contains("focusable")) a.click(); else focusFirst(); }
    else if (k === 27 && !isNative) { e.preventDefault(); window.appBack(); }
  });

  // ================= pilha de telas =================
  var stack = [], current = null, lastBack = 0, timers = [];
  function clearTimers() { for (var i = 0; i < timers.length; i++) clearInterval(timers[i]); timers = []; }
  function show(s) { clearTimers(); current = s; s.render(false); }
  function go(s) { if (current) { current.focusKey = activeKey(); stack.push(current); } show(s); }
  function activeKey() { var a = document.activeElement; return a && a.getAttribute ? a.getAttribute("data-k") : null; }
  function restore(s, fb) { var el = s.focusKey ? $app.querySelector('[data-k="' + s.focusKey.replace(/"/g, "") + '"]') : null; if (el) focusEl(el); else focusFirst(fb); }
  window.appBack = function () {
    if (document.getElementById("busy").className === "show") return true;
    if (stack.length) { clearTimers(); current = stack.pop(); current.render(true); return true; }
    if (current && current.tab && current.tab !== "home") { show(tabScreen("home")); return true; }
    if (current && current.tab === "home") { var now = Date.now(); if (now - lastBack < 2200) return false; lastBack = now; toast("Pressione voltar novamente para sair"); return true; }
    return false;
  };
  function bindAll(sel, fn) { var els = $app.querySelectorAll(sel); for (var i = 0; i < els.length; i++) els[i].onclick = fn; }

  // ================= moldura (menu de ícones + topo) =================
  var TABS = [["home", "Início"], ["sport", "Esportes"], ["tv", "TV ao Vivo"], ["vod", "Filmes e Séries"], ["hist", "Histórico"], ["set", "Ajustes"]];
  function frame(tab, title, body) {
    var h = '<div class="shell"><div class="rail"><div class="rlogo"><img src="logo.png" alt=""></div>';
    for (var i = 0; i < TABS.length; i++) h += '<button class="ricon focusable' + (TABS[i][0] === tab ? " on" : "") + '" data-k="rail-' + TABS[i][0] + '" data-tab="' + TABS[i][0] + '" title="' + TABS[i][1] + '">' + I[TABS[i][0]] + "</button>";
    var a = account || {};
    h += '</div><div class="mainc"><div class="hdr"><div class="ttl">' + esc(title) + '</div><div class="sp"></div>' +
      '<div class="chip hideph">' + I.user + esc(creds ? creds.user : "") + "</div>" +
      '<div class="chip">' + I.cal + "Vence " + esc(fmtDate(a.exp_date)) + "</div>" +
      '<div class="clock">' + clock() + "</div></div>" + body + "</div></div>";
    return h;
  }
  function bindRail() { bindAll("[data-tab]", function () { var t = this.getAttribute("data-tab"); stack = []; show(tabScreen(t)); focusEl($app.querySelector('[data-tab="' + t + '"]')); }); }
  function tabScreen(t) { return { home: homeScreen, sport: sportScreen, tv: liveScreen, vod: vodScreen, hist: histScreen, set: setScreen }[t](); }
  function paint(s, title, body) { $app.innerHTML = frame(s.tab, title, body); bindRail(); }

  // ================= cartões =================
  function cardHtml(kind, it, k, extra) {
    var img = kind === "series" ? it.cover : it.stream_icon, rate = parseFloat(it.rating_5based || 0);
    return '<button class="card focusable" data-k="' + esc(k) + '"' + (extra || "") + '><div class="poster" style="' + bgUrl(img) + '">' + (img ? "" : "🎬") + "</div>" +
      (rate ? '<div class="rate">★ ' + rate.toFixed(1) + "</div>" : "") + (kind === "series" ? '<div class="badge">SÉRIE</div>' : "") +
      '<div class="cname">' + esc(it.name) + "</div></button>";
  }
  function openVod(kind, it) { go(kind === "series" ? seriesScreen(it) : movieScreen(it)); }

  // ================= plataformas =================
  var PLATS = [
    { k: "netflix", n: "NETFLIX", re: /netflix/, bg: "#e50914" },
    { k: "prime", n: "prime video", re: /prime|amazon/, bg: "linear-gradient(135deg,#00a8e1,#1a73e8)" },
    { k: "disney", n: "Disney+", re: /disney/, bg: "linear-gradient(135deg,#0b1f6b,#1b8bd6)" },
    { k: "hbo", n: "HBO max", re: /hbo|\bmax\b/, bg: "linear-gradient(135deg,#2a0a6b,#6f2bd9)" },
    { k: "globo", n: "globoplay", re: /globo ?play/, bg: "linear-gradient(135deg,#f5503c,#f58a3c)" },
    { k: "paramount", n: "Paramount+", re: /paramount/, bg: "linear-gradient(135deg,#0033a0,#0a64ff)" },
    { k: "apple", n: "Apple TV+", re: /apple/, bg: "#1b1b1f" },
    { k: "crunchy", n: "Crunchyroll", re: /crunchy|anime/, bg: "linear-gradient(135deg,#f47521,#f8a23a)" },
    { k: "star", n: "Star+", re: /star ?\+|starplus/, bg: "linear-gradient(135deg,#3d0a5c,#c0237c)" }
  ];
  function allVodCats() {
    return Promise.all([arr(api("get_vod_categories")), arr(api("get_series_categories"))]).then(function (r) {
      var out = [];
      r[0].forEach(function (c) { out.push({ kind: "movie", id: c.category_id, name: c.category_name }); });
      r[1].forEach(function (c) { out.push({ kind: "series", id: c.category_id, name: c.category_name }); });
      return out;
    });
  }
  function platCats(p, cats) { return cats.filter(function (c) { return p.re.test(norm(c.name)); }); }
  function platsFound() { return allVodCats().then(function (cats) { return PLATS.filter(function (p) { return platCats(p, cats).length; }); }); }
  function catItems(c) { return arr(api(c.kind === "series" ? "get_series" : "get_vod_streams", "&category_id=" + encodeURIComponent(c.id))); }

  // ================= tipo de dispositivo =================
  function applyDevice() { document.body.className = load("device", "tv") === "phone" ? "phone" : ""; }
  function deviceScreen(after) {
    var sel = load("device", null) || (Math.min(screen.width, screen.height) < 600 ? "phone" : "tv");
    return {
      name: "device",
      render: function () {
        $app.innerHTML = '<div class="center"><div class="devbox"><img src="logo.png" alt=""><h1>Selecione seu tipo de dispositivo</h1>' +
          "<p>Para uma melhor experiência de uso, selecione corretamente o tipo de dispositivo que você está utilizando. Se quiser alterar depois, é só ir em Ajustes.</p>" +
          '<div class="devs"><button class="dev focusable' + (sel === "tv" ? " sel" : "") + '" data-k="dtv" data-d="tv">' + I.tv + "TV / TV Box</button>" +
          '<button class="dev focusable' + (sel === "phone" ? " sel" : "") + '" data-k="dph" data-d="phone">' + I.phone + "Celular</button></div>" +
          '<button class="btn btn-red focusable" style="min-width:240px" data-k="dok" id="dok">CONFIRMAR</button></div></div>';
        bindAll("[data-d]", function () { sel = this.getAttribute("data-d"); var b = $app.querySelectorAll("[data-d]"); for (var i = 0; i < b.length; i++) b[i].classList.toggle("sel", b[i] === this); focusEl(document.getElementById("dok")); });
        document.getElementById("dok").onclick = function () { save("device", sel); applyDevice(); after(); };
        focusFirst(sel === "tv" ? '[data-d="tv"]' : '[data-d="phone"]');
      }
    };
  }

  // ================= login =================
  function loginScreen(msg) {
    return {
      name: "login",
      render: function () {
        $app.innerHTML = '<div class="center"><div class="login-box"><div class="login-head"><img src="logo.png" alt="TVPlus+"></div><div class="login-body">' +
          "<h2>Login com nome de usuário</h2>" +
          '<input class="field focusable" data-k="u" id="lu" placeholder="Usuário" autocapitalize="off" autocomplete="off" spellcheck="false">' +
          '<input class="field focusable" data-k="p" id="lp" placeholder="Senha" type="password" autocomplete="off">' +
          '<button class="btn btn-red wide focusable" data-k="go" id="lgo">ENTRAR</button>' +
          '<div class="msg" id="lmsg">' + esc(msg || "") + "</div>" +
          (C.whatsapp ? '<div class="support">Suporte (WhatsApp): ' + esc(fmtPhone(C.whatsapp)) + "</div>" : "") + "</div></div></div>";
        var u = document.getElementById("lu"), p = document.getElementById("lp");
        var last = load("lastUser", ""); if (last) u.value = last;
        u.onenter = function () { focusEl(p); };
        p.onenter = submit;
        document.getElementById("lgo").onclick = submit;
        function submit() {
          var user = u.value.trim(), pass = p.value.trim();
          if (!user || !pass) { document.getElementById("lmsg").textContent = "Preencha usuário e senha"; return; }
          busy(true, "Conectando...");
          tryLogin(user, pass).then(function (r) {
            busy(false);
            var st = String(r.info.status || "Active");
            if (st !== "Active") { document.getElementById("lmsg").textContent = st === "Expired" ? "Sua assinatura venceu. Fale com o suporte para renovar." : "Conta bloqueada (" + st + "). Fale com o suporte."; return; }
            creds = { dns: r.dns, user: user, pass: pass }; account = r.info; cache = {};
            save("creds", creds); save("account", account); save("lastUser", user);
            stack = []; show(tabScreen("home"));
          }, function (e) { busy(false); document.getElementById("lmsg").textContent = e.message; });
        }
        focusFirst(last ? "#lp" : "#lu");
      }
    };
  }

  // ================= início =================
  var POPULAR = ["globo", "sbt", "record", "band", "redetv", "sportv", "espn", "premiere", "combate", "tnt", "space", "hbo", "telecine", "megapix", "warner", "discovery", "cartoon", "disney", "globonews", "cnn"];
  function featuredChannels(all) {
    var out = [], used = {};
    for (var p = 0; p < POPULAR.length && out.length < 16; p++) for (var i = 0; i < all.length; i++) {
      var it = all[i]; if (used[it.stream_id]) continue;
      var n = norm(it.name).replace(/[^a-z0-9]/g, "");
      if (n.indexOf(POPULAR[p]) === 0 || n.indexOf(POPULAR[p]) === 2) { out.push(it); used[it.stream_id] = 1; break; }
    }
    for (var j = 0; j < all.length && out.length < 12; j++) if (!used[all[j].stream_id]) { out.push(all[j]); used[all[j].stream_id] = 1; }
    return out;
  }
  function recent(all, field, n) { return all.slice().sort(function (a, b) { return (Number(b[field]) || 0) - (Number(a[field]) || 0); }).slice(0, n); }

  function homeScreen() {
    var s = { tab: "home", data: {} }, bi = 0;
    s.render = function (back) {
      var hist = load("hist", []);
      paint(s, "Início", '<div class="home">' +
        '<button class="banner focusable" data-k="banner" id="banner"><div class="shade"></div><div class="info"><span class="tag">EM DESTAQUE</span><h2 id="bt">Carregando...</h2><div class="meta" id="bm"></div><div class="plot" id="bp"></div></div><div class="dots" id="bd"></div></button>' +
        '<div class="plats" id="plats"></div>' +
        (hist.length ? '<div class="rowt">Continuar assistindo</div><div class="row" id="r-hist"></div>' : "") +
        '<div class="rowt">Canais em destaque</div><div class="row" id="r-live"><div class="rowload">Carregando canais...</div></div>' +
        '<div class="rowt">Filmes adicionados recentemente</div><div class="row" id="r-movie"><div class="rowload">Carregando filmes...</div></div>' +
        '<div class="rowt">Séries atualizadas</div><div class="row" id="r-series"><div class="rowload">Carregando séries...</div></div></div>');
      if (hist.length) document.getElementById("r-hist").innerHTML = histCards(hist.slice(0, 15));
      bindHist();
      if (back) restore(s, "#banner"); else focusFirst("#banner");
      var wanted = back ? s.focusKey : null;
      function refocus() { if (wanted && activeKey() !== wanted) { var el = $app.querySelector('[data-k="' + wanted + '"]'); if (el) focusEl(el); } }

      // banner
      function loadBanner() {
        if (s.data.banner) return Promise.resolve(s.data.banner);
        return arr(api("get_vod_streams")).then(function (l) { s.data.banner = recent(l, "added", 6); return s.data.banner; });
      }
      loadBanner().then(function (list) {
        if (current !== s || !list.length) return;
        function showB(i) {
          var it = list[i], b = document.getElementById("banner"); if (!b) return;
          document.getElementById("bt").textContent = it.name;
          var dots = ""; for (var d = 0; d < list.length; d++) dots += "<i" + (d === i ? ' class="on"' : "") + "></i>";
          document.getElementById("bd").innerHTML = dots;
          b.style.backgroundImage = it._bd ? "url('" + it._bd.replace(/'/g, "%27") + "')" : (it.stream_icon ? "url('" + it.stream_icon.replace(/'/g, "%27") + "')" : "");
          document.getElementById("bm").textContent = it._meta || (it.rating_5based ? "★ " + parseFloat(it.rating_5based).toFixed(1) : "");
          document.getElementById("bp").textContent = it._plot || "";
          if (!it._info) {
            it._info = 1;
            api("get_vod_info", "&vod_id=" + it.stream_id).then(function (d) {
              var inf = (d && d.info) || {};
              it._bd = (inf.backdrop_path && inf.backdrop_path[0]) || ""; it._plot = inf.plot || inf.description || "";
              var m = []; if (inf.releasedate) m.push(String(inf.releasedate).slice(0, 4)); if (inf.genre) m.push(inf.genre); if (inf.rating) m.push("★ " + inf.rating);
              it._meta = m.join("  •  ");
              if (bi === i && current === s) showB(i);
            }, function () {});
          }
        }
        showB(bi);
        document.getElementById("banner").onclick = function () { go(movieScreen(list[bi])); };
        timers.push(setInterval(function () { bi = (bi + 1) % list.length; showB(bi); }, 7000));
      });
      // plataformas
      platsFound().then(function (ps) {
        var box = document.getElementById("plats"); if (!box || current !== s) return;
        if (!ps.length) { box.style.display = "none"; return; }
        box.innerHTML = ps.map(function (p) { return '<button class="plat focusable" data-k="pl-' + p.k + '" data-p="' + p.k + '" style="background:' + p.bg + '">' + esc(p.n) + "</button>"; }).join("");
        bindAll("[data-p]", function () { stack = []; var v = vodScreen("p:" + this.getAttribute("data-p")); show(v); });
        refocus();
      }, function () {});
      fill("live", function () { return arr(api("get_live_streams")).then(featuredChannels); });
      fill("movie", function () { return arr(api("get_vod_streams")).then(function (l) { return recent(l, "added", 24); }); });
      fill("series", function () { return arr(api("get_series")).then(function (l) { return recent(l, "last_modified", 24); }); });
      function fill(type, loader) {
        var p = s.data[type] ? Promise.resolve(s.data[type]) : loader();
        p.then(function (items) {
          s.data[type] = items;
          var box = document.getElementById("r-" + type); if (!box || current !== s) return;
          if (!items.length) { box.innerHTML = '<div class="rowload">Nada por aqui ainda.</div>'; return; }
          box.innerHTML = items.map(function (it, i) {
            if (type === "live") return '<button class="chc focusable" data-k="h-l-' + esc(it.stream_id) + '" data-hi="' + i + '">' + (it.stream_icon ? '<img loading="lazy" src="' + esc(it.stream_icon) + '" onerror="this.style.display=\'none\'">' : "") + "<span>" + esc(it.name) + "</span></button>";
            return cardHtml(type, it, "h-" + type + "-" + (it.stream_id || it.series_id), ' data-hi="' + i + '"');
          }).join("");
          var els = box.querySelectorAll("[data-hi]");
          for (var j = 0; j < els.length; j++) els[j].onclick = function () { var i = +this.getAttribute("data-hi"); if (type === "live") playLive(items, i); else openVod(type, items[i]); };
          refocus();
        }, function () { var box = document.getElementById("r-" + type); if (box) box.innerHTML = '<div class="rowload">Não foi possível carregar.</div>'; });
      }
    };
    return s;
  }

  // ================= histórico =================
  function histCards(list) {
    return list.map(function (h, i) {
      if (h.kind === "live") return '<button class="chc focusable" data-k="hs-' + esc(h.key) + '" data-h="' + i + '">' + (h.img ? '<img src="' + esc(h.img) + '" onerror="this.style.display=\'none\'">' : "") + "<span>" + esc(h.name) + "</span></button>";
      return '<button class="card focusable" data-k="hs-' + esc(h.key) + '" data-h="' + i + '"><div class="poster" style="' + bgUrl(h.img) + '">' + (h.img ? "" : "🎬") + '</div><div class="badge">' + (h.kind === "series" ? "SÉRIE" : "FILME") + '</div><div class="cname">' + esc(h.name) + "</div></button>";
    }).join("");
  }
  function bindHist() {
    var list = load("hist", []);
    bindAll("[data-h]", function () { var h = list[+this.getAttribute("data-h")]; if (h && h.play) play(h.play, h); });
  }
  function histScreen() {
    var s = { tab: "hist" };
    s.render = function (back) {
      var list = load("hist", []);
      paint(s, "Histórico", '<div class="content" style="padding:6px 20px 20px">' +
        (list.length ? '<div class="sbtns" style="margin-bottom:14px"><button class="btn btn-dark focusable" data-k="hclear" id="hclear">Limpar histórico</button></div><div class="grid">' + histCards(list).replace(/class="chc/g, 'style="margin:0 14px 16px 0" class="chc') + "</div>" : '<div class="empty">Você ainda não assistiu nada. O que você assistir aparece aqui para continuar depois.</div>') + "</div>");
      bindHist();
      var c = document.getElementById("hclear");
      if (c) c.onclick = function () { save("hist", []); toast("Histórico limpo"); s.render(); };
      if (back) restore(s); else focusFirst(".content .card,.content .chc,#hclear");
    };
    return s;
  }

  // ================= TV ao vivo =================
  var SPORT_RE = /esporte|sport|premiere|futebol|espn|combate|dazn/;
  function liveScreen(opts) {
    opts = opts || {};
    var s = { tab: "tv" }, st = { cats: null, cat: null, items: [], limit: 120, counts: null, q: "", epgFor: null };
    s.render = function (back) {
      paint(s, "TV ao Vivo", '<div class="body"><div class="panel" id="panel"></div><div class="chlist" id="chlist"><div class="empty">Carregando...</div></div><div class="epg" id="epg"></div></div>');
      if (st.cats) { drawCats(); drawList(); if (back) restore(s, ".pitem.on"); else focusFirst(".pitem.on"); return; }
      busy(true);
      arr(api("get_live_categories")).then(function (cats) {
        busy(false);
        st.cats = [{ id: "__s", name: "Buscar", ic: I.search }, { id: "__f", name: "Favoritos", ic: I.star }, { id: "__r", name: "Recentes", ic: I.clockI }, { id: "__a", name: "Tudo: A-Z", ic: I.list }]
          .concat(cats.map(function (c) { return { id: String(c.category_id), name: c.category_name }; }));
        drawCats();
        var first = st.cats[4] ? st.cats[4].id : "__a";
        if (opts.sport) for (var i = 4; i < st.cats.length; i++) if (SPORT_RE.test(norm(st.cats[i].name))) { first = st.cats[i].id; break; }
        select(first, !opts.sport);
        api("get_live_streams").then(function (all) {
          var c = { __a: all.length }; all.forEach(function (x) { var k = String(x.category_id); c[k] = (c[k] || 0) + 1; }); st.counts = c; fillCounts();
        }, function () {});
      }, function (e) { busy(false); document.getElementById("chlist").innerHTML = '<div class="empty">Erro ao carregar: ' + esc(e.message) + "</div>"; });
    };
    function drawCats() {
      document.getElementById("panel").innerHTML = st.cats.map(function (c) {
        return '<button class="pitem focusable' + (c.id === st.cat ? " on" : "") + '" data-k="c-' + esc(c.id) + '" data-c="' + esc(c.id) + '">' + (c.ic || "") + '<span class="n">' + esc(c.name) + '</span><span class="c" data-cnt="' + esc(c.id) + '"></span></button>';
      }).join("");
      bindAll("[data-c]", function () { select(this.getAttribute("data-c")); });
      fillCounts();
    }
    function fillCounts() { if (!st.counts) return; var els = $app.querySelectorAll("[data-cnt]"); for (var i = 0; i < els.length; i++) { var n = st.counts[els[i].getAttribute("data-cnt")]; if (n != null) els[i].textContent = n; } }
    function select(id, keepPanel) {
      st.cat = id; st.limit = 120;
      var b = $app.querySelectorAll(".pitem"); for (var i = 0; i < b.length; i++) b[i].classList.toggle("on", b[i].getAttribute("data-c") === id);
      var box = document.getElementById("chlist");
      if (id === "__s") {
        box.innerHTML = '<input class="field focusable" data-k="lsq" id="lsq" placeholder="Digite o nome do canal" style="margin:4px 0 10px"><div id="lres"></div>';
        var inp = document.getElementById("lsq"), t; inp.value = st.q;
        inp.oninput = function () { clearTimeout(t); t = setTimeout(function () { search(inp.value); }, 400); };
        inp.onenter = function () { search(inp.value); inp.blur(); focusFirst("#lres .ch"); };
        if (st.q) search(st.q);
        if (!keepPanel) focusEl(inp);
        return;
      }
      box.innerHTML = '<div class="empty">Carregando...</div>';
      var p;
      if (id === "__f") { var f = favs("live"); p = Promise.resolve(Object.keys(f).map(function (k) { return f[k]; })); }
      else if (id === "__r") p = Promise.resolve(load("hist", []).filter(function (h) { return h.kind === "live"; }).map(function (h) { return h.ref; }));
      else if (id === "__a") p = arr(api("get_live_streams")).then(function (l) { return l.slice().sort(function (a, b) { return norm(a.name) < norm(b.name) ? -1 : 1; }); });
      else p = arr(api("get_live_streams", "&category_id=" + encodeURIComponent(id)));
      p.then(function (items) {
        if (st.cat !== id) return;
        st.items = items; drawList();
        if (keepPanel) focusFirst(".pitem.on"); else focusFirst("#chlist .ch");
      }, function (e) { box.innerHTML = '<div class="empty">Erro: ' + esc(e.message) + "</div>"; });
    }
    function search(q) {
      st.q = q = q.trim(); var res = document.getElementById("lres"); if (!res) return;
      if (!q) { res.innerHTML = ""; return; }
      arr(api("get_live_streams")).then(function (all) {
        var nq = norm(q); st.items = all.filter(function (x) { return norm(x.name).indexOf(nq) >= 0; });
        drawList(res);
      });
    }
    function chHtml(it, i) {
      return '<button class="ch focusable" data-k="ch-' + esc(it.stream_id) + '" data-i="' + i + '"><span class="num">' + (it.num || i + 1) + '</span><span class="lg">' +
        (it.stream_icon ? '<img loading="lazy" src="' + esc(it.stream_icon) + '" onerror="this.style.display=\'none\'">' : "") + '</span><span class="nm">' + esc(it.name) + "</span>" + (isFav("live", it.stream_id) ? '<span class="st">★</span>' : "") + "</button>";
    }
    function drawList(target) {
      var box = target || document.getElementById("chlist"); if (!box) return;
      if (st.cat === "__s" && !target) { select("__s", true); return; }
      if (!st.items.length) { box.innerHTML = '<div class="empty">' + (st.cat === "__f" ? "Nenhum favorito ainda. Abra o guia de um canal e toque em Favoritar." : st.cat === "__r" ? "Nenhum canal assistido ainda." : "Nenhum canal encontrado.") + "</div>"; return; }
      var h = ""; for (var i = 0; i < Math.min(st.limit, st.items.length); i++) h += chHtml(st.items[i], i);
      box.innerHTML = h; bindList(box);
    }
    function bindList(box) {
      var els = box.querySelectorAll("[data-i]");
      for (var i = 0; i < els.length; i++) {
        if (els[i].bound) continue; els[i].bound = 1;
        els[i].onclick = function () { playLive(st.items, +this.getAttribute("data-i")); };
        els[i].onfocusnav = function () {
          var idx = +this.getAttribute("data-i");
          if (idx > st.limit - 20 && st.limit < st.items.length) {
            var from = st.limit; st.limit = Math.min(st.items.length, st.limit + 120);
            var tmp = document.createElement("div"), h = ""; for (var k = from; k < st.limit; k++) h += chHtml(st.items[k], k);
            tmp.innerHTML = h; var par = this.parentNode; while (tmp.firstChild) par.appendChild(tmp.firstChild); bindList(par);
          }
          epg(idx);
        };
      }
    }
    var epgT;
    function epg(idx) {
      var it = st.items[idx]; if (!it) return; st.epgFor = idx;
      var box = document.getElementById("epg"); if (!box || box.offsetParent === null) return;
      box.innerHTML = '<div class="eh">' + (it.stream_icon ? '<img src="' + esc(it.stream_icon) + '" onerror="this.style.display=\'none\'">' : "") + "<div><h3>" + esc(it.name) + '</h3><span class="live">AO VIVO</span></div></div>' +
        '<div class="sbtns" style="margin-bottom:12px"><button class="btn btn-red focusable" data-k="ewatch" id="ew">▶ Assistir</button><button class="btn btn-dark focusable" data-k="efav" id="ef">' + (isFav("live", it.stream_id) ? "★ Favorito" : "☆ Favoritar") + "</button></div>" +
        '<div id="eprogs"><div class="hint">Carregando programação...</div></div>';
      document.getElementById("ew").onclick = function () { playLive(st.items, idx); };
      document.getElementById("ef").onclick = function () { this.textContent = toggleFav("live", it, it.stream_id) ? "★ Favorito" : "☆ Favoritar"; };
      clearTimeout(epgT);
      epgT = setTimeout(function () {
        api("get_short_epg", "&stream_id=" + it.stream_id + "&limit=6").then(function (d) {
          if (st.epgFor !== idx) return;
          var l = (d && d.epg_listings) || [], now = Date.now() / 1000, h = "";
          l.forEach(function (p) {
            var a = Number(p.start_timestamp), b = Number(p.stop_timestamp); if (b && b < now) return;
            var on = a <= now && now < b, pct = on ? Math.round((now - a) / (b - a) * 100) : 0;
            h += '<div class="prog' + (on ? " now" : "") + '"><div class="tm">' + (on ? "AGORA  •  " : "") + hm(new Date(a * 1000)) + " - " + hm(new Date(b * 1000)) + '</div><div class="pt">' + esc(b64(p.title)) + "</div>" +
              (p.description ? '<div class="pd">' + esc(b64(p.description)) + "</div>" : "") + (on ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : "") + "</div>";
          });
          var e = document.getElementById("eprogs"); if (e) e.innerHTML = h || '<div class="hint">Sem programação disponível para este canal.</div>';
        }, function () { var e = document.getElementById("eprogs"); if (e) e.innerHTML = '<div class="hint">Sem programação disponível para este canal.</div>'; });
      }, 350);
    }
    return s;
  }

  // ================= filmes e séries =================
  function vodScreen(startSel) {
    var s = { tab: "vod" }, st = { sel: startSel || "dest", tab: null, tabs: [], items: [], limit: 60, q: "", plats: [] };
    s.render = function (back) {
      paint(s, "Filmes e Séries", '<div class="body"><div class="panel" id="panel"></div><div class="pane"><div class="tabs" id="tabs"></div><div class="content" id="content"><div class="empty">Carregando...</div></div></div></div>');
      drawPanel();
      if (st.tabs.length || st.sel === "search") { drawTabs(); drawItems(); if (back) restore(s, ".pitem.on"); else focusFirst(".pitem.on"); }
      else selectSel(st.sel, !startSel);
      if (!st.plats.length) platsFound().then(function (ps) { st.plats = ps; if (current === s) { var k = activeKey(); drawPanel(); if (k) { var el = $app.querySelector('[data-k="' + k + '"]'); if (el) focusEl(el); } } }, function () {});
      if (startSel && !back) setTimeout(function () { focusFirst(".pitem.on"); }, 0);
    };
    function drawPanel() {
      var items = [["search", "Buscar", I.search], ["dest", "Destaques", I.star], ["movie", "Filmes", I.film], ["series", "Séries", I.tv]];
      st.plats.forEach(function (p) { items.push(["p:" + p.k, p.n.replace(/^NETFLIX$/, "Netflix").replace("prime video", "Prime Video").replace("globoplay", "Globoplay").replace("HBO max", "HBO Max"), ""]); });
      document.getElementById("panel").innerHTML = items.map(function (x) { return '<button class="pitem focusable' + (x[0] === st.sel ? " on" : "") + '" data-k="v-' + x[0] + '" data-v="' + x[0] + '">' + x[2] + '<span class="n">' + esc(x[1]) + "</span></button>"; }).join("");
      bindAll("[data-v]", function () { selectSel(this.getAttribute("data-v")); });
    }
    function selectSel(sel, keepPanel) {
      st.sel = sel; st.tabs = []; st.tab = null;
      var b = $app.querySelectorAll(".pitem"); for (var i = 0; i < b.length; i++) b[i].classList.toggle("on", b[i].getAttribute("data-v") === sel);
      document.getElementById("tabs").innerHTML = ""; var box = document.getElementById("content");
      if (sel === "search") { drawTabs(); drawItems(); if (!keepPanel) focusFirst("#vsq"); return; }
      box.innerHTML = '<div class="empty">Carregando...</div>';
      var p;
      if (sel === "dest") p = Promise.resolve([{ id: "new", name: "Novidades" }, { id: "fav", name: "Favoritos" }, { id: "top", name: "Mais bem avaliados" }]);
      else if (sel === "movie" || sel === "series") p = arr(api(sel === "movie" ? "get_vod_categories" : "get_series_categories")).then(function (cs) { return cs.map(function (c) { return { kind: sel, id: c.category_id, name: c.category_name }; }); });
      else { var pl = PLATS.filter(function (x) { return "p:" + x.k === sel; })[0]; p = allVodCats().then(function (cats) { return platCats(pl, cats); }); }
      p.then(function (tabs) {
        if (st.sel !== sel) return;
        st.tabs = tabs; drawTabs();
        if (tabs.length) selectTab(0, keepPanel); else box.innerHTML = '<div class="empty">Nada por aqui.</div>';
      }, function (e) { box.innerHTML = '<div class="empty">Erro: ' + esc(e.message) + "</div>"; });
    }
    function drawTabs() {
      var t = document.getElementById("tabs");
      if (st.sel === "search") { t.style.display = "none"; return; }
      t.style.display = "";
      t.innerHTML = st.tabs.map(function (x, i) { return '<button class="tab focusable' + (i === st.tab ? " on" : "") + '" data-k="t-' + i + '" data-t="' + i + '">' + esc(x.name) + "</button>"; }).join("");
      bindAll("[data-t]", function () { selectTab(+this.getAttribute("data-t")); });
    }
    function selectTab(i, keepPanel) {
      st.tab = i; st.limit = 60;
      var b = $app.querySelectorAll(".tab"); for (var j = 0; j < b.length; j++) b[j].classList.toggle("on", +b[j].getAttribute("data-t") === i);
      var tb = st.tabs[i], box = document.getElementById("content"), p;
      box.innerHTML = '<div class="empty">Carregando...</div>';
      if (st.sel === "dest") {
        if (tb.id === "fav") { var fm = favs("movie"), fs = favs("series"); p = Promise.resolve(Object.keys(fm).map(function (k) { return { kind: "movie", it: fm[k] }; }).concat(Object.keys(fs).map(function (k) { return { kind: "series", it: fs[k] }; }))); }
        else p = Promise.all([arr(api("get_vod_streams")), arr(api("get_series"))]).then(function (r) {
          var m, sr;
          if (tb.id === "new") { m = recent(r[0], "added", 40); sr = recent(r[1], "last_modified", 40); }
          else { m = recent(r[0], "rating_5based", 40); sr = recent(r[1], "rating_5based", 40); }
          var out = []; for (var k = 0; k < 40; k++) { if (m[k]) out.push({ kind: "movie", it: m[k] }); if (sr[k]) out.push({ kind: "series", it: sr[k] }); }
          return out;
        });
      } else p = catItems(tb).then(function (l) { return l.map(function (x) { return { kind: tb.kind, it: x }; }); });
      p.then(function (items) {
        if (st.tab !== i) return;
        st.items = items; drawItems();
        if (!keepPanel && i === 0 && document.activeElement && document.activeElement.classList.contains("pitem")) return;
      }, function (e) { box.innerHTML = '<div class="empty">Erro: ' + esc(e.message) + "</div>"; });
    }
    function itemHtml(x, i) { return cardHtml(x.kind, x.it, "i-" + x.kind + "-" + (x.it.stream_id || x.it.series_id), ' data-i="' + i + '"'); }
    function drawItems() {
      var box = document.getElementById("content");
      if (st.sel === "search") {
        box.innerHTML = '<div class="sbox"><input class="field focusable" data-k="vsq" id="vsq" placeholder="Digite o nome do filme ou série"></div><div class="grid" id="list"></div>';
        var inp = document.getElementById("vsq"), t; inp.value = st.q;
        inp.oninput = function () { clearTimeout(t); t = setTimeout(function () { doSearch(inp.value); }, 450); };
        inp.onenter = function () { doSearch(inp.value); inp.blur(); focusFirst("#list .card"); };
        if (st.q) doSearch(st.q);
        return;
      }
      if (!st.items.length) { box.innerHTML = '<div class="empty">' + (st.tabs[st.tab] && st.tabs[st.tab].id === "fav" ? "Nenhum favorito ainda." : "Nada encontrado.") + "</div>"; return; }
      var h = '<div class="grid" id="list">'; for (var i = 0; i < Math.min(st.limit, st.items.length); i++) h += itemHtml(st.items[i], i);
      box.innerHTML = h + "</div>"; bindItems();
    }
    function doSearch(q) {
      st.q = q = q.trim(); var list = document.getElementById("list"); if (!list) return;
      if (q.length < 2) { list.innerHTML = ""; st.items = []; return; }
      list.innerHTML = '<div class="empty">Buscando...</div>';
      Promise.all([arr(api("get_vod_streams")), arr(api("get_series"))]).then(function (r) {
        if (st.q !== q) return;
        var nq = norm(q), out = [];
        r[0].forEach(function (x) { if (norm(x.name).indexOf(nq) >= 0) out.push({ kind: "movie", it: x }); });
        r[1].forEach(function (x) { if (norm(x.name).indexOf(nq) >= 0) out.push({ kind: "series", it: x }); });
        st.items = out.slice(0, 200); st.limit = 60;
        var l2 = document.getElementById("list"); if (!l2) return;
        l2.innerHTML = out.length ? st.items.slice(0, st.limit).map(itemHtml).join("") : '<div class="empty">Nada encontrado.</div>';
        bindItems();
      });
    }
    function bindItems() {
      var list = document.getElementById("list"); if (!list) return;
      var els = list.querySelectorAll("[data-i]");
      for (var i = 0; i < els.length; i++) {
        if (els[i].bound) continue; els[i].bound = 1;
        els[i].onclick = function () { var x = st.items[+this.getAttribute("data-i")]; openVod(x.kind, x.it); };
        els[i].onfocusnav = function () {
          if (+this.getAttribute("data-i") > st.limit - 14 && st.limit < st.items.length) {
            var from = st.limit; st.limit = Math.min(st.items.length, st.limit + 60);
            var tmp = document.createElement("div"), h = ""; for (var k = from; k < st.limit; k++) h += itemHtml(st.items[k], k);
            tmp.innerHTML = h; while (tmp.firstChild) list.appendChild(tmp.firstChild); bindItems();
          }
        };
      }
    }
    return s;
  }

  function movieScreen(it) {
    var s = { tab: "vod" }, info = null;
    s.render = function (back) {
      if (!info) { busy(true); api("get_vod_info", "&vod_id=" + it.stream_id).then(function (d) { busy(false); info = d || {}; draw(back); }, function () { busy(false); info = {}; draw(back); }); return; }
      draw(back);
    };
    function draw(back) {
      var inf = info.info || {}, md = info.movie_data || {};
      var cover = inf.movie_image || inf.cover_big || it.stream_icon || "", bd = (inf.backdrop_path && inf.backdrop_path[0]) || cover;
      var ext = md.container_extension || it.container_extension || "mp4", id = md.stream_id || it.stream_id, name = inf.name || it.name;
      var meta = []; if (inf.releasedate) meta.push(String(inf.releasedate).slice(0, 4)); if (inf.duration) meta.push(inf.duration); if (inf.genre) meta.push(inf.genre); if (inf.rating) meta.push("★ " + inf.rating);
      paint(s, "Filme", '<div class="detail"><div class="bg" style="' + bgUrl(bd) + '"></div><div class="inner">' + (cover ? '<img class="cover" src="' + esc(cover) + '">' : "") +
        "<div><h1>" + esc(name) + '</h1><div class="meta">' + esc(meta.join("  •  ")) + '</div><div class="plot">' + esc(inf.plot || inf.description || "") + "</div>" +
        '<div class="actions"><button class="btn btn-red focusable" data-k="play" id="bplay">▶ ASSISTIR</button><button class="btn btn-dark focusable" data-k="fav" id="bfav">' + (isFav("movie", it.stream_id) ? "★ Favorito" : "☆ Favoritar") + "</button></div></div></div></div>");
      document.getElementById("bplay").onclick = function () { play({ urls: [streamUrl("movie", id, ext)], titles: [name], index: 0, live: false }, { key: "m" + it.stream_id, kind: "movie", name: name, img: it.stream_icon || cover, ref: it }); };
      document.getElementById("bfav").onclick = function () { this.textContent = toggleFav("movie", it, it.stream_id) ? "★ Favorito" : "☆ Favoritar"; };
      if (back) restore(s, "#bplay"); else focusFirst("#bplay");
    }
    return s;
  }

  function seriesScreen(it) {
    var s = { tab: "vod" }, data = null, season = null;
    s.render = function (back) {
      if (data) { draw(back); return; }
      busy(true);
      api("get_series_info", "&series_id=" + it.series_id).then(function (d) { busy(false); data = d || {}; draw(false); }, function (e) { busy(false); toast("Erro ao carregar a série: " + e.message); window.appBack(); });
    };
    function epMap() {
      var eps = data.episodes || {}, map = {};
      if (Array.isArray(eps)) eps.forEach(function (x, i) { (Array.isArray(x) ? x : [x]).forEach(function (e) { var k = String(e.season || i + 1); (map[k] = map[k] || []).push(e); }); });
      else map = eps;
      return map;
    }
    function draw(back) {
      var inf = data.info || {}, map = epMap(), keys = Object.keys(map).sort(function (a, b) { return a - b; });
      if (season === null) season = keys[0];
      var cover = inf.cover || it.cover || "", bd = (inf.backdrop_path && inf.backdrop_path[0]) || cover, name = inf.name || it.name;
      var meta = []; if (inf.releaseDate) meta.push(String(inf.releaseDate).slice(0, 4)); if (inf.genre) meta.push(inf.genre); if (inf.rating) meta.push("★ " + inf.rating);
      var eps = map[season] || [];
      var h = '<div class="detail"><div class="bg" style="' + bgUrl(bd) + '"></div><div class="inner">' + (cover ? '<img class="cover" src="' + esc(cover) + '">' : "") +
        "<div><h1>" + esc(name) + '</h1><div class="meta">' + esc(meta.join("  •  ")) + '</div><div class="plot">' + esc(inf.plot || "") + "</div>" +
        '<div class="actions"><button class="btn btn-red focusable" data-k="play1" id="bplay">▶ ASSISTIR</button><button class="btn btn-dark focusable" data-k="fav" id="bfav">' + (isFav("series", it.series_id) ? "★ Favorito" : "☆ Favoritar") + "</button></div></div></div>" +
        '<div class="seasons">' + keys.map(function (k) { return '<button class="tab focusable' + (k === season ? " on" : "") + '" data-k="s-' + esc(k) + '" data-s="' + esc(k) + '">Temporada ' + esc(k) + "</button>"; }).join("") + '</div><div class="episodes">' +
        (eps.length ? eps.map(function (ep, e) { var ei = ep.info || {}; return '<button class="ep focusable" data-k="e-' + esc(ep.id) + '" data-e="' + e + '">' + (ei.movie_image ? '<img loading="lazy" src="' + esc(ei.movie_image) + '" onerror="this.style.visibility=\'hidden\'">' : "") + '<div><div class="t">' + esc((ep.episode_num ? ep.episode_num + ". " : "") + (ep.title || "Episódio " + (e + 1))) + '</div><div class="d">' + esc(ei.duration || "") + "</div></div></button>"; }).join("") : '<div class="empty">Nenhum episódio disponível.</div>') + "</div></div>";
      paint(s, "Série", h);
      function playEp(idx) {
        var urls = [], titles = [];
        eps.forEach(function (ep, k) { urls.push(streamUrl("series", ep.id, ep.container_extension || "mp4")); titles.push(name + " - T" + season + " E" + (ep.episode_num || k + 1)); });
        play({ urls: urls, titles: titles, index: idx, live: false }, { key: "s" + it.series_id, kind: "series", name: name, img: it.cover || cover, ref: it });
      }
      document.getElementById("bplay").onclick = function () { if (eps.length) playEp(0); };
      document.getElementById("bfav").onclick = function () { this.textContent = toggleFav("series", it, it.series_id) ? "★ Favorito" : "☆ Favoritar"; };
      bindAll("[data-s]", function () { season = this.getAttribute("data-s"); s.focusKey = "s-" + season; draw(true); });
      bindAll("[data-e]", function () { playEp(+this.getAttribute("data-e")); });
      if (back) restore(s, "#bplay"); else focusFirst("#bplay");
    }
    return s;
  }

  // ================= esportes =================
  var ESPN = "https://site.api.espn.com/apis/";
  var LEAGUES = [
    ["bra.1", "Brasileirão Série A"], ["bra.2", "Brasileirão Série B"], ["bra.3", "Brasileirão Série C"], ["bra.copa_do_brazil", "Copa do Brasil"],
    ["conmebol.libertadores", "Libertadores"], ["conmebol.sudamericana", "Sul-Americana"], ["fifa.friendly", "Amistosos"], ["fifa.worldq.conmebol", "Eliminatórias"],
    ["uefa.champions", "Champions League"], ["uefa.europa", "Liga Europa"], ["uefa.europa.conf", "Conference League"],
    ["eng.1", "Premier League"], ["esp.1", "La Liga"], ["ita.1", "Serie A (Itália)"], ["ger.1", "Bundesliga"], ["fra.1", "Ligue 1"], ["por.1", "Liga Portugal"], ["ksa.1", "Liga Saudita"], ["usa.1", "MLS"]
  ];
  var TABLES = [["bra.1", "Brasileirão Série A"], ["bra.2", "Brasileirão Série B"], ["eng.1", "Premier League"], ["esp.1", "La Liga"], ["ita.1", "Serie A (Itália)"], ["ger.1", "Bundesliga"], ["fra.1", "Ligue 1"], ["por.1", "Liga Portugal"]];
  var WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  function ymd(d) { return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()); }
  var sportCache = {};
  function gamesOf(day) {
    var key = ymd(day); if (sportCache[key]) return sportCache[key];
    var a = new Date(day); a.setDate(a.getDate() - 1); var b = new Date(day); b.setDate(b.getDate() + 1);
    var p = Promise.all(LEAGUES.map(function (L) {
      return getJson(ESPN + "site/v2/sports/soccer/" + L[0] + "/scoreboard?dates=" + ymd(a) + "-" + ymd(b) + "&limit=200").then(function (d) {
        var lg = (d.leagues && d.leagues[0]) || {}, logo = lg.logos && lg.logos[0] ? lg.logos[0].href : "";
        return (d.events || []).filter(function (e) { var t = new Date(e.date); return ymd(t) === key; }).map(function (e) {
          var c = (e.competitions && e.competitions[0]) || {}, cs = c.competitors || [];
          var h = cs.filter(function (x) { return x.homeAway === "home"; })[0] || cs[0] || {}, w = cs.filter(function (x) { return x.homeAway === "away"; })[0] || cs[1] || {};
          var t = (e.status && e.status.type) || {};
          return { lg: L[1], logo: logo, date: new Date(e.date), state: t.state, detail: t.shortDetail || "", clock: e.status && e.status.displayClock,
            home: { n: (h.team || {}).shortDisplayName || (h.team || {}).displayName || "", l: (h.team || {}).logo || "", s: h.score },
            away: { n: (w.team || {}).shortDisplayName || (w.team || {}).displayName || "", l: (w.team || {}).logo || "", s: w.score } };
        });
      }, function () { return []; });
    })).then(function (r) { var out = []; r.forEach(function (x) { out = out.concat(x); }); if (!out.length) delete sportCache[key]; return out; });
    sportCache[key] = p; return p;
  }
  function sportScreen() {
    var s = { tab: "sport" };
    s.render = function (back) {
      paint(s, "Esportes", '<div class="stiles"><button class="stile focusable" data-k="sp-cal" id="spc">' + I.cal + "Calendário de jogos</button>" +
        '<button class="stile focusable" data-k="sp-tab" id="spt">' + I.trophy + "Classificação</button>" +
        '<button class="stile focusable" data-k="sp-ch" id="spch">' + I.tv + "Canais de esporte</button></div>");
      document.getElementById("spc").onclick = function () { go(calendarScreen()); };
      document.getElementById("spt").onclick = function () { go(tableScreen()); };
      document.getElementById("spch").onclick = function () { stack = []; show(liveScreen({ sport: true })); };
      if (back) restore(s, "#spc"); else focusFirst("#spc");
    };
    return s;
  }
  function calendarScreen() {
    var s = { tab: "sport" }, today = new Date(); today.setHours(12, 0, 0, 0);
    var days = []; for (var i = -3; i <= 4; i++) { var d = new Date(today); d.setDate(d.getDate() + i); days.push(d); }
    var sel = 3;
    s.render = function (back) {
      paint(s, "Calendário de jogos", '<div class="body"><div class="panel" id="panel" style="width:120px">' + days.map(function (d, i) {
        return '<button class="dayb focusable' + (i === sel ? " on" : "") + '" data-k="d-' + i + '" data-d="' + i + '"><div class="dw">' + (i === 3 ? "Hoje" : WD[d.getDay()]) + '</div><div class="dd">' + z(d.getDate()) + "/" + z(d.getMonth() + 1) + "</div></button>";
      }).join("") + '</div><div class="pane"><div class="content" id="content"></div></div></div>');
      bindAll("[data-d]", function () { sel = +this.getAttribute("data-d"); var b = $app.querySelectorAll(".dayb"); for (var j = 0; j < b.length; j++) b[j].classList.toggle("on", +b[j].getAttribute("data-d") === sel); fill(); });
      fill();
      if (back) restore(s, ".dayb.on"); else focusFirst(".dayb.on");
    };
    function fill() {
      var box = document.getElementById("content"), mine = sel;
      box.innerHTML = '<div class="empty">Buscando os jogos...</div>';
      gamesOf(days[sel]).then(function (g) {
        if (mine !== sel || current !== s) return;
        if (!g.length) { box.innerHTML = '<div class="empty">Nenhum jogo encontrado neste dia (ou sem conexão com a agenda de jogos).</div>'; return; }
        var h = "", lastLg = null;
        LEAGUES.forEach(function (L) {
          g.filter(function (x) { return x.lg === L[1]; }).sort(function (a, b) { return a.date - b.date; }).forEach(function (m, i) {
            if (m.lg !== lastLg) { h += '<div class="lghdr">' + (m.logo ? '<img src="' + esc(m.logo) + '" onerror="this.style.display=\'none\'">' : "") + esc(m.lg) + "</div>"; lastLg = m.lg; }
            var mid;
            if (m.state === "pre") mid = '<div class="hr">' + hm(m.date) + '</div><span class="stt">A seguir</span>';
            else if (m.state === "in") mid = '<div class="sc">' + esc(m.home.s) + " - " + esc(m.away.s) + '</div><span class="stt live">AO VIVO ' + esc(m.clock || "") + "</span>";
            else mid = '<div class="sc">' + esc(m.home.s) + " - " + esc(m.away.s) + '</div><span class="stt">' + (/postp|adiad/i.test(m.detail) ? "Adiado" : "Encerrado") + "</span>";
            h += '<button class="match focusable" data-k="m-' + esc(L[0]) + i + '" data-m="1"><div class="tm hm"><span>' + esc(m.home.n) + "</span>" + (m.home.l ? '<img src="' + esc(m.home.l) + '" onerror="this.style.visibility=\'hidden\'">' : "") + "</div>" +
              '<div class="mid">' + mid + '</div><div class="tm">' + (m.away.l ? '<img src="' + esc(m.away.l) + '" onerror="this.style.visibility=\'hidden\'">' : "") + "<span>" + esc(m.away.n) + "</span></div></button>";
          });
        });
        box.innerHTML = h;
        bindAll("[data-m]", function () { stack = []; show(liveScreen({ sport: true })); toast("Escolha o canal que vai transmitir o jogo"); });
      });
    }
    return s;
  }
  function tableScreen() {
    var s = { tab: "sport" }, sel = 0, cacheT = {};
    s.render = function (back) {
      paint(s, "Classificação", '<div class="body"><div class="panel" id="panel">' + TABLES.map(function (t, i) {
        return '<button class="pitem focusable' + (i === sel ? " on" : "") + '" data-k="tb-' + i + '" data-tb="' + i + '">' + I.trophy + '<span class="n">' + esc(t[1]) + "</span></button>";
      }).join("") + '</div><div class="pane"><div class="content" id="content"></div></div></div>');
      bindAll("[data-tb]", function () { sel = +this.getAttribute("data-tb"); var b = $app.querySelectorAll(".pitem"); for (var j = 0; j < b.length; j++) b[j].classList.toggle("on", +b[j].getAttribute("data-tb") === sel); fill(); });
      fill();
      if (back) restore(s, ".pitem.on"); else focusFirst(".pitem.on");
    };
    function stat(e, n) { var l = e.stats || []; for (var i = 0; i < l.length; i++) if (l[i].name === n || l[i].type === n.toLowerCase()) return l[i].displayValue != null ? l[i].displayValue : l[i].value; return ""; }
    function fill() {
      var box = document.getElementById("content"), mine = sel, T = TABLES[sel];
      box.innerHTML = '<div class="empty">Carregando classificação...</div>';
      var p = cacheT[T[0]] || (cacheT[T[0]] = getJson(ESPN + "v2/sports/soccer/" + T[0] + "/standings"));
      p.then(function (d) {
        if (mine !== sel || current !== s) return;
        var groups = d.children && d.children.length ? d.children : [d];
        var h = "";
        groups.forEach(function (g) {
          var en = ((g.standings || {}).entries || []).slice();
          if (!en.length) return;
          en.sort(function (a, b) { return (Number(stat(a, "rank")) || 99) - (Number(stat(b, "rank")) || 99); });
          if (groups.length > 1) h += '<div class="lghdr">' + esc(g.name || "") + "</div>";
          h += '<table class="tbl"><tr><th>#</th><th style="text-align:left">Time</th><th>PTS</th><th>J</th><th>V</th><th>E</th><th>D</th><th class="hph">GP</th><th class="hph">GC</th><th>SG</th></tr>';
          en.forEach(function (e, i) {
            var t = e.team || {}, lg = t.logos && t.logos[0] ? t.logos[0].href : "";
            h += "<tr><td>" + (stat(e, "rank") || i + 1) + '</td><td class="tn"><div>' + (lg ? '<img src="' + esc(lg) + '" onerror="this.style.visibility=\'hidden\'">' : "") + esc(t.shortDisplayName || t.displayName) + '</div></td><td class="pts">' + esc(stat(e, "points")) + "</td><td>" + esc(stat(e, "gamesPlayed")) + "</td><td>" + esc(stat(e, "wins")) + "</td><td>" + esc(stat(e, "ties")) + "</td><td>" + esc(stat(e, "losses")) +
              '</td><td class="hph">' + esc(stat(e, "pointsFor")) + '</td><td class="hph">' + esc(stat(e, "pointsAgainst")) + "</td><td>" + esc(stat(e, "pointDifferential")) + "</td></tr>";
          });
          h += "</table>";
        });
        box.innerHTML = h || '<div class="empty">Classificação indisponível no momento.</div>';
      }, function () { delete cacheT[T[0]]; box.innerHTML = '<div class="empty">Não foi possível carregar a classificação. Verifique a internet.</div>'; });
    }
    return s;
  }

  // ================= ajustes =================
  function setScreen() {
    var s = { tab: "set" };
    s.render = function (back) {
      var a = account || {}, dev = load("device", "tv");
      var st = String(a.status || "Active");
      paint(s, "Ajustes", '<div class="set">' +
        '<div class="sbloc"><h3>Minha conta</h3>' +
        '<div class="kv"><span>Usuário</span><b>' + esc(creds.user) + "</b></div>" +
        '<div class="kv"><span>Situação</span><b>' + (st === "Active" ? "Ativa" : esc(st)) + "</b></div>" +
        '<div class="kv"><span>Vencimento</span><b>' + esc(fmtDate(a.exp_date)) + "</b></div>" +
        '<div class="kv"><span>Telas permitidas</span><b>' + esc(a.max_connections || "-") + "</b></div>" +
        '<div class="kv"><span>Servidor</span><b>' + (DNS.indexOf(creds.dns) + 1 || 1) + "</b></div></div>" +
        '<div class="sbloc"><h3>Tipo de dispositivo</h3><div class="sbtns">' +
        '<button class="btn ' + (dev === "tv" ? "btn-red" : "btn-dark") + ' focusable" data-k="dev-tv" data-dev="tv">TV / TV Box</button>' +
        '<button class="btn ' + (dev === "phone" ? "btn-red" : "btn-dark") + ' focusable" data-k="dev-ph" data-dev="phone">Celular</button></div></div>' +
        '<div class="sbloc"><h3>Opções</h3><div class="sbtns">' +
        '<button class="btn btn-gold focusable" data-k="ref" id="sref">⟳ Atualizar listas</button>' +
        (C.whatsapp ? '<button class="btn btn-dark focusable" data-k="sup" id="ssup">Suporte</button>' : "") +
        '<button class="btn btn-dark focusable" data-k="out" id="sout">Sair da conta</button></div>' +
        (C.whatsapp ? '<div class="support" style="margin-top:6px">Suporte no WhatsApp: ' + esc(fmtPhone(C.whatsapp)) + "</div>" : "") + "</div></div>");
      bindAll("[data-dev]", function () { save("device", this.getAttribute("data-dev")); applyDevice(); s.focusKey = activeKey(); s.render(true); });
      document.getElementById("sref").onclick = function () {
        cache = {}; sportCache = {}; busy(true, "Atualizando...");
        tryLogin(creds.user, creds.pass).then(function (r) { busy(false); creds.dns = r.dns; account = r.info; save("creds", creds); save("account", account); toast("Listas atualizadas"); s.focusKey = "ref"; s.render(true); }, function (e) { busy(false); toast(e.message); });
      };
      if (document.getElementById("ssup")) document.getElementById("ssup").onclick = function () { toast("Suporte no WhatsApp: " + fmtPhone(C.whatsapp), 6000); };
      document.getElementById("sout").onclick = function () { save("creds", null); save("account", null); creds = null; account = null; cache = {}; stack = []; show(loginScreen()); };
      if (back) restore(s, "#sref"); else focusFirst("#sref");
    };
    return s;
  }

  // ================= início do app =================
  function start() {
    if (creds && creds.dns && creds.pass) show(tabScreen("home")); else show(loginScreen());
    if (creds && creds.pass) {
      tryLogin(creds.user, creds.pass).then(function (r) {
        creds.dns = r.dns; account = r.info; save("creds", creds); save("account", account);
        if (String(r.info.status) !== "Active") { save("creds", null); creds = null; stack = []; show(loginScreen("Sua assinatura venceu. Fale com o suporte para renovar.")); }
      }, function (e) { if (e.message === "Usuário ou senha incorretos") { save("creds", null); creds = null; stack = []; show(loginScreen("Seu acesso foi alterado. Entre novamente.")); } });
    }
  }
  applyDevice();
  if (!load("device", null)) show(deviceScreen(start)); else start();
})();
