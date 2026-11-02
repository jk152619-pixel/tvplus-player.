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
    var zoneSel = ".cats,.content,.detail,.top,.login-box";
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

  function topBar(title, withSearch, placeholder) {
    return '<div class="top">' +
      '<button class="back focusable" data-k="back" id="btnBack">◀ Voltar</button>' +
      '<img src="logo.png" alt="">' +
      '<div class="title">' + esc(title) + "</div><div class=\"spacer\"></div>" +
      (withSearch ? '<input class="search focusable" data-k="search" id="search" placeholder="' + esc(placeholder || "Buscar...") + '">' : "") +
      '<div class="clock">' + clock() + "</div></div>";
  }
  function bindBack() {
    var b = document.getElementById("btnBack");
    if (b) b.onclick = function () { window.appBack(); };
  }

  // ---------------- login ----------------
  function loginScreen(msg) {
    return {
      name: "login",
      render: function () {
        $app.innerHTML = '<div class="login"><div class="login-box">' +
          '<img src="logo.png" alt="TVPlus+">' +
          "<h2>Entre com seu usuário e senha</h2>" +
          '<input class="field focusable" data-k="u" id="lu" placeholder="Usuário" autocapitalize="off" autocomplete="off" spellcheck="false">' +
          '<input class="field focusable" data-k="p" id="lp" placeholder="Senha" type="password" autocomplete="off">' +
          '<button class="btn btn-gold focusable" data-k="go" id="lgo">ENTRAR</button>' +
          '<div class="msg" id="lmsg">' + esc(msg || "") + "</div>" +
          (C.whatsapp ? '<div class="support">Suporte (WhatsApp): ' + esc(fmtPhone(C.whatsapp)) + "</div>" : "") +
          "</div></div>";
        var u = document.getElementById("lu"), p = document.getElementById("lp");
        if (creds) u.value = creds.user;
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
            if (st !== "Active") {
              document.getElementById("lmsg").textContent = st === "Expired" ? "Sua assinatura venceu. Fale com o suporte para renovar." : "Conta bloqueada (" + st + "). Fale com o suporte.";
              return;
            }
            creds = { dns: r.dns, user: user, pass: pass }; account = r.info; cache = {};
            save("creds", creds); save("account", account);
            stack = []; show(homeScreen());
          }, function (e) {
            busy(false);
            document.getElementById("lmsg").textContent = e.message;
          });
        }
        focusFirst(creds ? "#lp" : "#lu");
      }
    };
  }
  function fmtPhone(n) {
    var d = String(n).replace(/\D/g, "");
    if (d.indexOf("55") === 0 && d.length >= 12) d = d.slice(2);
    if (d.length === 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    return n;
  }

  // ---------------- início ----------------
  var POPULAR = ["globo", "sbt", "record", "band", "redetv", "cultura", "sportv", "espn", "premiere", "combate", "tnt", "space", "hbo", "telecine", "megapix", "warner", "universal", "discovery", "cartoon", "disney", "gloob", "globonews", "cnn"];
  function featuredChannels(all) {
    var out = [], used = {};
    for (var p = 0; p < POPULAR.length && out.length < 18; p++) {
      for (var i = 0; i < all.length; i++) {
        var it = all[i];
        if (used[it.stream_id]) continue;
        var n = norm(it.name).replace(/[^a-z0-9]/g, "");
        if (n.indexOf(POPULAR[p]) === 0 || n.indexOf(POPULAR[p]) === 2) { out.push(it); used[it.stream_id] = 1; break; }
      }
    }
    for (var j = 0; j < all.length && out.length < 12; j++) if (!used[all[j].stream_id]) { out.push(all[j]); used[all[j].stream_id] = 1; }
    return out;
  }
  function recent(all, field, n) {
    return all.slice().sort(function (a, b) { return (Number(b[field]) || 0) - (Number(a[field]) || 0); }).slice(0, n);
  }
  function homeScreen() {
    var rows = {};
    var screen = {
      name: "home",
      render: function (back) {
        var a = account || {};
        $app.innerHTML = '<div class="home">' +
          '<div class="htop"><img class="hlogo" src="logo.png" alt="TVPlus+">' +
          '<div class="spacer"></div>' +
          '<div class="hinfo"><div>Olá, <b>' + esc(creds.user) + '</b></div><div>Vence: <b>' + esc(fmtDate(a.exp_date)) + "</b>" + (a.max_connections ? " • Telas: <b>" + esc(a.max_connections) + "</b>" : "") + "</div></div>" +
          '<div class="clock">' + clock() + "</div></div>" +
          '<div class="home-body" id="hbody">' +
          '<div class="menu">' +
          '<button class="mtile live focusable" data-k="live"><span class="ico">📺</span><span class="lbl">TV ao Vivo</span></button>' +
          '<button class="mtile movies focusable" data-k="movies"><span class="ico">🎬</span><span class="lbl">Filmes</span></button>' +
          '<button class="mtile series focusable" data-k="series"><span class="ico">🍿</span><span class="lbl">Séries</span></button>' +
          '<button class="mtile small focusable" data-k="refresh"><span class="ico">⟳</span><span class="lbl">Atualizar</span></button>' +
          (C.whatsapp ? '<button class="mtile small focusable" data-k="support"><span class="ico">💬</span><span class="lbl">Suporte</span></button>' : "") +
          '<button class="mtile small focusable" data-k="logout"><span class="ico">⏻</span><span class="lbl">Sair</span></button>' +
          "</div>" +
          '<div class="rowtitle">📺 Canais em destaque</div><div class="row live-row" id="r-live"><div class="rowload">Carregando canais...</div></div>' +
          '<div class="rowtitle">🎬 Filmes adicionados recentemente</div><div class="row" id="r-movie"><div class="rowload">Carregando filmes...</div></div>' +
          '<div class="rowtitle">🍿 Séries atualizadas</div><div class="row" id="r-series"><div class="rowload">Carregando séries...</div></div>' +
          "</div></div>";
        var q = function (k) { return $app.querySelector('[data-k="' + k + '"]'); };
        q("live").onclick = function () { go(listScreen("live")); };
        q("movies").onclick = function () { go(listScreen("movie")); };
        q("series").onclick = function () { go(listScreen("series")); };
        q("refresh").onclick = function () {
          cache = {}; rows = {};
          busy(true, "Atualizando...");
          tryLogin(creds.user, creds.pass).then(function (r) {
            busy(false); creds.dns = r.dns; account = r.info; save("creds", creds); save("account", account);
            toast("Lista atualizada"); screen.focusKey = "refresh"; screen.render(true);
          }, function (e) { busy(false); toast(e.message); });
        };
        if (q("support")) q("support").onclick = function () { toast("Suporte no WhatsApp: " + fmtPhone(C.whatsapp), 6000); };
        q("logout").onclick = function () {
          creds = { user: creds.user }; save("creds", null); save("account", null); account = null; cache = {};
          stack = []; show(loginScreen());
          creds = null;
        };
        if (back) restore(screen, '[data-k="live"]'); else focusFirst('[data-k="live"]');
        var wanted = back ? screen.focusKey : null;
        function afterFill() {
          if (wanted && document.activeElement && document.activeElement.getAttribute("data-k") !== wanted) {
            var el = $app.querySelector('[data-k="' + wanted + '"]');
            if (el) focusEl(el);
          }
        }
        fillRow("live", function () { return api("get_live_streams").then(featuredChannels); }, afterFill);
        fillRow("movie", function () { return api("get_vod_streams").then(function (l) { return recent(l, "added", 24); }); }, afterFill);
        fillRow("series", function () { return api("get_series").then(function (l) { return recent(l, "last_modified", 24); }); }, afterFill);
      }
    };
    function fillRow(type, loader, done) {
      var p = rows[type] ? Promise.resolve(rows[type]) : loader();
      p.then(function (items) {
        rows[type] = items;
        var box = document.getElementById("r-" + type);
        if (!box || current !== screen) return;
        if (!items || !items.length) { box.innerHTML = '<div class="rowload">Nada por aqui ainda.</div>'; return; }
        var h = "";
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (type === "live") {
            h += '<button class="hch focusable" data-k="h-l-' + esc(it.stream_id) + '" data-hi="' + i + '">' +
              (it.stream_icon ? '<img loading="lazy" src="' + esc(it.stream_icon) + '" onerror="this.style.visibility=\'hidden\'">' : '<span class="noimg">📺</span>') +
              '<span class="hname">' + esc(it.name) + "</span></button>";
          } else {
            var img = type === "movie" ? it.stream_icon : it.cover, id = type === "movie" ? it.stream_id : it.series_id;
            h += '<button class="hcard focusable" data-k="h-' + type + "-" + esc(id) + '" data-hi="' + i + '">' +
              '<div class="poster"' + (img ? ' style="background-image:url(\'' + esc(img).replace(/'/g, "%27") + '\')"' : "") + ">" + (img ? "" : "<span>🎬</span>") + "</div>" +
              '<div class="cname">' + esc(it.name) + "</div></button>";
          }
        }
        box.innerHTML = h;
        var els = box.querySelectorAll("[data-hi]");
        for (var j = 0; j < els.length; j++) els[j].onclick = function () {
          var idx = +this.getAttribute("data-hi");
          if (type === "live") {
            var urls = [], titles = [], ext = liveExt();
            for (var k = 0; k < items.length; k++) { urls.push(streamUrl("live", items[k].stream_id, ext)); titles.push(items[k].name); }
            play(urls, titles, idx, true);
          } else if (type === "movie") go(movieScreen(items[idx]));
          else go(seriesScreen(items[idx]));
        };
        if (done) done();
      }, function () {
        var box = document.getElementById("r-" + type);
        if (box) box.innerHTML = '<div class="rowload">Não foi possível carregar.</div>';
      });
    }
    return screen;
  }

  // ---------------- listas (TV, filmes, séries) ----------------
  var TYPES = {
    live: { title: "TV ao Vivo", cats: "get_live_categories", items: "get_live_streams", id: "stream_id", img: "stream_icon", search: "Buscar canal..." },
    movie: { title: "Filmes", cats: "get_vod_categories", items: "get_vod_streams", id: "stream_id", img: "stream_icon", search: "Buscar filme..." },
    series: { title: "Séries", cats: "get_series_categories", items: "get_series", id: "series_id", img: "cover", search: "Buscar série..." }
  };
  var PAGE = 90;

  function listScreen(type) {
    var T = TYPES[type];
    var st = { cats: null, cat: null, items: [], limit: PAGE, query: "" };
    var screen = {
      name: type,
      render: function (back) {
        $app.innerHTML = '<div class="screen">' + topBar(T.title, true, T.search) +
          '<div class="main"><div class="cats" id="cats"></div><div class="content" id="content"><div class="empty">Carregando...</div></div></div></div>';
        bindBack();
        var s = document.getElementById("search");
        s.value = st.query;
        var timer;
        s.oninput = function () { clearTimeout(timer); timer = setTimeout(function () { doSearch(s.value); }, 450); };
        s.onenter = function () { doSearch(s.value); s.blur(); focusFirst("#content .focusable"); };
        if (st.cats) { drawCats(); drawItems(); if (back) restore(screen, ".cat.active"); else focusFirst(".cat.active"); return; }
        busy(true);
        api(T.cats).then(function (cats) {
          busy(false);
          st.cats = [{ category_id: "__fav", category_name: "★ Favoritos" }, { category_id: "__all", category_name: "Todos" }].concat(Array.isArray(cats) ? cats : []);
          drawCats();
          var first = st.cats.length > 2 ? st.cats[2].category_id : "__all";
          selectCat(first, true);
        }, function (e) { busy(false); document.getElementById("content").innerHTML = '<div class="empty">Erro ao carregar: ' + esc(e.message) + "</div>"; focusFirst("#btnBack"); });
      }
    };

    function drawCats() {
      var h = "";
      for (var i = 0; i < st.cats.length; i++) {
        var c = st.cats[i];
        h += '<button class="cat focusable' + (String(c.category_id) === String(st.cat) && !st.query ? " active" : "") + '" data-k="cat-' + esc(c.category_id) + '" data-c="' + esc(c.category_id) + '">' + esc(c.category_name) + "</button>";
      }
      var box = document.getElementById("cats");
      box.innerHTML = h;
      var btns = box.querySelectorAll(".cat");
      for (var j = 0; j < btns.length; j++) btns[j].onclick = function () { selectCat(this.getAttribute("data-c")); };
    }

    function loadItems(catId) {
      if (catId === "__fav") {
        var f = favs(type), arr = [];
        for (var k in f) if (f.hasOwnProperty(k)) arr.push(f[k]);
        return Promise.resolve(arr);
      }
      if (catId === "__all") return api(T.items);
      return api(T.items, "&category_id=" + encodeURIComponent(catId));
    }

    function selectCat(catId, keepFocusOnCats) {
      st.cat = catId; st.query = ""; st.limit = PAGE;
      var s = document.getElementById("search"); if (s) s.value = "";
      var act = $app.querySelectorAll(".cat");
      for (var i = 0; i < act.length; i++) act[i].classList.toggle("active", act[i].getAttribute("data-c") === String(catId));
      document.getElementById("content").innerHTML = '<div class="empty">Carregando...</div>';
      loadItems(catId).then(function (items) {
        if (st.cat !== catId || st.query) return;
        st.items = Array.isArray(items) ? items : [];
        drawItems();
        if (keepFocusOnCats) focusFirst(".cat.active");
        else focusFirst("#content .focusable");
      }, function (e) {
        document.getElementById("content").innerHTML = '<div class="empty">Erro ao carregar: ' + esc(e.message) + "</div>";
      });
    }

    function doSearch(q) {
      q = q.trim();
      st.query = q; st.limit = PAGE;
      var act = $app.querySelectorAll(".cat.active");
      for (var i = 0; i < act.length; i++) act[i].classList.remove("active");
      if (!q) { selectCat(st.cat || "__all", true); return; }
      document.getElementById("content").innerHTML = '<div class="empty">Buscando...</div>';
      api(T.items).then(function (all) {
        if (st.query !== q) return;
        var nq = norm(q), out = [];
        for (var i = 0; i < all.length; i++) if (norm(all[i].name).indexOf(nq) >= 0) out.push(all[i]);
        st.items = out;
        drawItems();
      }, function (e) { document.getElementById("content").innerHTML = '<div class="empty">Erro: ' + esc(e.message) + "</div>"; });
    }

    function itemHtml(it, i) {
      var id = it[T.id], img = it[T.img] || "";
      if (type === "live") {
        return '<div class="chan-row" style="display:flex">' +
          '<button class="chan focusable" data-k="i-' + esc(id) + '" data-i="' + i + '">' +
          '<span class="num">' + (i + 1) + "</span>" +
          (img ? '<img loading="lazy" src="' + esc(img) + '" onerror="this.style.visibility=\'hidden\'">' : '<span class="noimg"></span>') +
          '<span class="name">' + esc(it.name) + "</span>" + (isFav(type, id) ? '<span class="fav">★</span>' : "") + "</button>" +
          '<button class="btn btn-dark focusable" style="margin:0 0 4px 6px;padding:8px 14px" data-k="f-' + esc(id) + '" data-f="' + i + '">' + (isFav(type, id) ? "★" : "☆") + "</button></div>";
      }
      var rate = parseFloat(it.rating_5based || it.rating || 0);
      return '<button class="card focusable" data-k="i-' + esc(id) + '" data-i="' + i + '">' +
        '<div class="poster"' + (img ? ' style="background-image:url(\'' + esc(img).replace(/'/g, "%27") + '\')"' : "") + ">" + (img ? "" : "<span>🎬</span>") + "</div>" +
        (rate ? '<div class="rate">★ ' + (it.rating_5based ? rate.toFixed(1) : rate) + "</div>" : "") +
        '<div class="cname">' + esc(it.name) + "</div></button>";
    }

    function drawItems() {
      var box = document.getElementById("content");
      if (!st.items.length) {
        box.innerHTML = '<div class="empty">' + (st.cat === "__fav" && !st.query ? "Nenhum favorito ainda." : "Nada encontrado.") + "</div>";
        return;
      }
      var h = type === "live" ? '<div class="list" id="list">' : '<div class="grid" id="list">';
      var n = Math.min(st.limit, st.items.length);
      for (var i = 0; i < n; i++) h += itemHtml(st.items[i], i);
      box.innerHTML = h + "</div>";
      bindItems(box);
    }

    function appendMore() {
      var list = document.getElementById("list");
      if (!list || st.limit >= st.items.length) return;
      var from = st.limit;
      st.limit = Math.min(st.items.length, st.limit + PAGE);
      var h = "";
      for (var i = from; i < st.limit; i++) h += itemHtml(st.items[i], i);
      var tmp = document.createElement("div");
      tmp.innerHTML = h;
      while (tmp.firstChild) list.appendChild(tmp.firstChild);
      bindItems(list);
    }

    function bindItems(root) {
      var els = root.querySelectorAll("[data-i]");
      for (var i = 0; i < els.length; i++) {
        if (els[i].bound) continue;
        els[i].bound = true;
        els[i].onclick = function () { openItem(+this.getAttribute("data-i")); };
        els[i].onfocusnav = function () { if (+this.getAttribute("data-i") > st.limit - 16) appendMore(); };
      }
      var fs = root.querySelectorAll("[data-f]");
      for (var j = 0; j < fs.length; j++) {
        if (fs[j].bound) continue;
        fs[j].bound = true;
        fs[j].onclick = function () {
          var it = st.items[+this.getAttribute("data-f")];
          var on = toggleFav(type, it, it[T.id]);
          this.textContent = on ? "★" : "☆";
        };
      }
      var cont = document.getElementById("content");
      if (cont && !cont.scrollBound) {
        cont.scrollBound = true;
        cont.addEventListener("scroll", function () { if (cont.scrollTop + cont.clientHeight > cont.scrollHeight - 400) appendMore(); });
      }
    }

    function openItem(i) {
      var it = st.items[i];
      if (type === "live") {
        var ext = liveExt(), start = 0, end = st.items.length;
        if (end > 1500) { start = Math.max(0, i - 700); end = Math.min(st.items.length, start + 1500); }
        var urls = [], titles = [];
        for (var k = start; k < end; k++) { urls.push(streamUrl("live", st.items[k].stream_id, ext)); titles.push(st.items[k].name); }
        play(urls, titles, i - start, true);
      } else if (type === "movie") {
        go(movieScreen(it));
      } else {
        go(seriesScreen(it));
      }
    }
    return screen;
  }

  // ---------------- filme ----------------
  function movieScreen(it) {
    var info = null;
    var screen = {
      name: "movie",
      render: function (back) {
        var draw = function () {
          var inf = (info && info.info) || {};
          var md = (info && info.movie_data) || {};
          var cover = inf.movie_image || inf.cover_big || it.stream_icon || "";
          var bd = (inf.backdrop_path && inf.backdrop_path[0]) || cover;
          var ext = md.container_extension || it.container_extension || "mp4";
          var id = md.stream_id || it.stream_id;
          var meta = [];
          if (inf.releasedate || inf.year) meta.push(String(inf.releasedate || inf.year).slice(0, 4));
          if (inf.duration) meta.push(inf.duration);
          if (inf.genre) meta.push(inf.genre);
          if (inf.rating || it.rating) meta.push("★ " + (inf.rating || it.rating));
          $app.innerHTML = '<div class="screen">' + topBar("Filme", false) +
            '<div class="detail"><div class="bg" style="background-image:url(\'' + esc(bd) + '\')"></div><div class="inner">' +
            (cover ? '<img class="cover" src="' + esc(cover) + '">' : "") +
            "<div><h1>" + esc(inf.name || it.name) + '</h1><div class="meta">' + esc(meta.join("  •  ")) + "</div>" +
            '<div class="plot">' + esc(inf.plot || inf.description || "") + "</div>" +
            '<div class="actions"><button class="btn btn-red focusable" data-k="play" id="bplay">▶ ASSISTIR</button>' +
            '<button class="btn btn-dark focusable" data-k="fav" id="bfav">' + (isFav("movie", it.stream_id) ? "★ Favorito" : "☆ Favoritar") + "</button></div>" +
            "</div></div></div></div>";
          bindBack();
          document.getElementById("bplay").onclick = function () { play([streamUrl("movie", id, ext)], [inf.name || it.name], 0, false); };
          document.getElementById("bfav").onclick = function () { this.textContent = toggleFav("movie", it, it.stream_id) ? "★ Favorito" : "☆ Favoritar"; };
          if (back) restore(screen, "#bplay"); else focusFirst("#bplay");
        };
        if (info) { draw(); return; }
        busy(true);
        api("get_vod_info", "&vod_id=" + it.stream_id).then(function (d) { busy(false); info = d || {}; draw(); }, function () { busy(false); info = {}; draw(); });
      }
    };
    return screen;
  }

  // ---------------- série ----------------
  function seriesScreen(it) {
    var data = null, season = null;
    var screen = {
      name: "series",
      render: function (back) {
        if (data) { draw(back); return; }
        busy(true);
        api("get_series_info", "&series_id=" + it.series_id).then(function (d) { busy(false); data = d || {}; draw(false); }, function (e) {
          busy(false); toast("Erro ao carregar a série: " + e.message); window.appBack();
        });
      }
    };
    function episodesMap() {
      var eps = data.episodes || {}, map = {};
      if (Array.isArray(eps)) {
        for (var i = 0; i < eps.length; i++) {
          var arr = Array.isArray(eps[i]) ? eps[i] : [eps[i]];
          for (var j = 0; j < arr.length; j++) { var s = String(arr[j].season || i + 1); (map[s] = map[s] || []).push(arr[j]); }
        }
      } else map = eps;
      return map;
    }
    function draw(back) {
      var inf = data.info || {};
      var map = episodesMap();
      var keys = Object.keys(map).sort(function (a, b) { return Number(a) - Number(b); });
      if (season === null) season = keys[0];
      var cover = inf.cover || it.cover || "";
      var bd = (inf.backdrop_path && inf.backdrop_path[0]) || cover;
      var meta = [];
      if (inf.releaseDate || inf.release_date) meta.push(String(inf.releaseDate || inf.release_date).slice(0, 4));
      if (inf.genre) meta.push(inf.genre);
      if (inf.rating || it.rating) meta.push("★ " + (inf.rating || it.rating));
      var h = '<div class="screen">' + topBar("Série", false) +
        '<div class="detail"><div class="bg" style="background-image:url(\'' + esc(bd) + '\')"></div><div class="inner">' +
        (cover ? '<img class="cover" src="' + esc(cover) + '">' : "") +
        "<div><h1>" + esc(inf.name || it.name) + '</h1><div class="meta">' + esc(meta.join("  •  ")) + "</div>" +
        '<div class="plot">' + esc(inf.plot || "") + "</div>" +
        '<div class="actions"><button class="btn btn-red focusable" data-k="play1" id="bplay">▶ ASSISTIR</button>' +
        '<button class="btn btn-dark focusable" data-k="fav" id="bfav">' + (isFav("series", it.series_id) ? "★ Favorito" : "☆ Favoritar") + "</button></div></div></div>" +
        '<div class="seasons">';
      for (var i = 0; i < keys.length; i++) h += '<button class="season focusable' + (keys[i] === season ? " active" : "") + '" data-k="s-' + esc(keys[i]) + '" data-s="' + esc(keys[i]) + '">Temporada ' + esc(keys[i]) + "</button>";
      h += '</div><div class="episodes">';
      var eps = map[season] || [];
      for (var e = 0; e < eps.length; e++) {
        var ep = eps[e], ei = ep.info || {};
        h += '<button class="ep focusable" data-k="e-' + esc(ep.id) + '" data-e="' + e + '">' +
          (ei.movie_image ? '<img loading="lazy" src="' + esc(ei.movie_image) + '" onerror="this.style.visibility=\'hidden\'">' : "") +
          '<div><div class="t">' + esc((ep.episode_num ? ep.episode_num + ". " : "") + (ep.title || "Episódio " + (e + 1))) + "</div>" +
          '<div class="d">' + esc(ei.duration || "") + "</div></div></button>";
      }
      if (!eps.length) h += '<div class="empty">Nenhum episódio disponível.</div>';
      h += "</div></div></div>";
      $app.innerHTML = h;
      bindBack();
      function playEp(idx) {
        var urls = [], titles = [];
        for (var k = 0; k < eps.length; k++) {
          urls.push(streamUrl("series", eps[k].id, eps[k].container_extension || "mp4"));
          titles.push((inf.name || it.name) + " - T" + season + " E" + (eps[k].episode_num || k + 1));
        }
        play(urls, titles, idx, false);
      }
      document.getElementById("bplay").onclick = function () { if (eps.length) playEp(0); };
      document.getElementById("bfav").onclick = function () { this.textContent = toggleFav("series", it, it.series_id) ? "★ Favorito" : "☆ Favoritar"; };
      var ss = $app.querySelectorAll("[data-s]");
      for (var a = 0; a < ss.length; a++) ss[a].onclick = function () { season = this.getAttribute("data-s"); screen.focusKey = "s-" + season; draw(true); };
      var es = $app.querySelectorAll("[data-e]");
      for (var b = 0; b < es.length; b++) es[b].onclick = function () { playEp(+this.getAttribute("data-e")); };
      if (back) restore(screen, "#bplay"); else focusFirst("#bplay");
    }
    return screen;
  }

  // ---------------- início do app ----------------
  if (creds && creds.dns && creds.pass) show(homeScreen());
  else show(loginScreen());
  // confere a conta em segundo plano
  if (creds && creds.pass) {
    tryLogin(creds.user, creds.pass).then(function (r) {
      creds.dns = r.dns; account = r.info; save("creds", creds); save("account", account);
      if (String(r.info.status) !== "Active") { save("creds", null); stack = []; var u = creds.user; creds = { user: u }; show(loginScreen("Sua assinatura venceu. Fale com o suporte para renovar.")); creds = null; }
    }, function (e) {
      if (e.message === "Usuário ou senha incorretos") { save("creds", null); var u = creds.user; creds = { user: u }; stack = []; show(loginScreen("Seu acesso foi alterado. Entre novamente.")); creds = null; }
    });
  }
})();
