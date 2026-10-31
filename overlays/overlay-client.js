/* Shared client for every Crickey Lite overlay. Plain ES2015, no dependencies, no network calls except to this server. */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var THEMES = ['classic', 'neon', 'minimal'];
  var cfg = {
    match: q.get('match') || '',
    theme: THEMES.indexOf(q.get('theme')) >= 0 ? q.get('theme') : 'classic',
    scale: parseFloat(q.get('scale')) > 0 ? parseFloat(q.get('scale')) : 1,
    position: q.get('position') === 'top' ? 'top' : 'bottom',
    debug: q.get('debug') === '1',
    preview: q.get('preview') === '1',
    force: q.get('force') === '1',
  };

  var S = { state: null, overlays: null, connected: false, lastMsgAt: 0, via: 'none' };
  var opts = null;
  var stage = null;
  var lastStateJson = '';
  var lastPayloadJson = '';
  var lastTrigger = -1;
  var slotMemory = [null, null];

  // ---- page setup --------------------------------------------------------------------------
  function setup() {
    document.documentElement.style.setProperty('--scale', String(cfg.scale));
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'themes/' + cfg.theme + '.css';
    document.head.appendChild(link);
    document.body.classList.add('theme-' + cfg.theme, 'pos-' + cfg.position);
    if (cfg.debug) {
      document.body.classList.add('debug');
      var d = document.createElement('div');
      d.id = 'dbg';
      document.body.appendChild(d);
    }
  }

  function dbg() {
    var d = document.getElementById('dbg');
    if (!d) return;
    d.textContent = opts.name + ' | ' + (S.connected ? 'connected via ' + S.via : 'DISCONNECTED') + ' | theme ' + cfg.theme + ' | match ' + (cfg.match || 'active');
    d.className = S.connected ? 'ok' : 'bad';
  }

  // ---- data --------------------------------------------------------------------------------
  function stripEffects(s) {
    if (!s) return s;
    var c = {};
    for (var k in s) if (k !== 'effects') c[k] = s[k];
    return c;
  }

  function onMessage(m) {
    S.lastMsgAt = Date.now();
    S.connected = true;
    if (m.type === 'state') S.state = m.state;
    else if (m.type === 'overlay') S.overlays = m.overlays;
    else if (m.type === 'trigger') { /* the overlay map carries the trigger id and payload */ }
    refresh();
  }

  var ws = null, wsFails = 0, wsTimer = null, es = null, pollTimer = null;

  function startWs() {
    var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?' + (cfg.preview ? '' : 'overlay=' + encodeURIComponent(opts.name)) + (cfg.match ? '&match=' + encodeURIComponent(cfg.match) : '');
    try { ws = new WebSocket(url); } catch (e) { return wsClosed(); }
    ws.onopen = function () {
      wsFails = 0;
      S.via = 'websocket';
      stopFallbacks();
      try { ws.send(JSON.stringify({ type: 'hello', overlay: cfg.preview ? null : opts.name, match: cfg.match || null })); } catch (e) { /* ignore */ }
    };
    ws.onmessage = function (ev) { try { onMessage(JSON.parse(ev.data)); } catch (e) { /* ignore bad frames */ } };
    ws.onclose = wsClosed;
    ws.onerror = function () { try { ws.close(); } catch (e) { /* ignore */ } };
  }

  function wsClosed() {
    if (S.via === 'websocket') { S.connected = false; S.via = 'none'; refresh(); }
    wsFails += 1;
    if (wsFails >= 2) startSse();
    clearTimeout(wsTimer);
    wsTimer = setTimeout(startWs, Math.min(500 * Math.pow(2, wsFails), 15000));
  }

  function startSse() {
    if (es || pollTimer || !window.EventSource) return startPolling();
    es = new EventSource('/events?' + (cfg.preview ? '' : 'overlay=' + encodeURIComponent(opts.name)) + (cfg.match ? '&match=' + encodeURIComponent(cfg.match) : ''));
    S.via = 'sse';
    ['state', 'overlay', 'trigger', 'clients', 'ping'].forEach(function (t) {
      es.addEventListener(t, function (ev) { try { onMessage(JSON.parse(ev.data)); } catch (e) { /* ignore */ } });
    });
    es.onerror = function () {
      if (es && es.readyState === 2) { es.close(); es = null; startPolling(); }
    };
  }

  function startPolling() {
    if (pollTimer) return;
    S.via = 'polling';
    var tick = function () {
      Promise.all([
        fetch('/api/state' + (cfg.match ? '?match=' + encodeURIComponent(cfg.match) : '')).then(function (r) { return r.ok ? r.json() : null; }),
        fetch('/api/overlays').then(function (r) { return r.json(); }),
      ]).then(function (res) {
        S.lastMsgAt = Date.now();
        S.connected = true;
        S.state = res[0];
        S.overlays = res[1].overlays;
        refresh();
      }).catch(function () { S.connected = false; refresh(); });
    };
    tick();
    pollTimer = setInterval(tick, 1000);
  }

  function stopFallbacks() {
    if (es) { es.close(); es = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ---- render pipeline ---------------------------------------------------------------------
  function refresh() {
    dbg();
    var entry = S.overlays ? S.overlays[opts.name] : null;
    var online = S.connected && Date.now() - S.lastMsgAt < 45000;
    var visible = !!S.state && (cfg.force || (!!entry && entry.visible)) && (online || cfg.force);
    var payload = entry ? entry.payload : null;
    if (cfg.force && !payload && opts.sample && S.state) payload = opts.sample(S.state);
    if (S.state) {
      var sj = JSON.stringify(stripEffects(S.state));
      var pj = JSON.stringify(payload);
      if (sj !== lastStateJson || pj !== lastPayloadJson) {
        lastStateJson = sj;
        lastPayloadJson = pj;
        try { opts.render(S.state, payload, U); } catch (e) { if (window.console) console.error(e); }
      }
    }
    var trig = entry ? entry.triggerId : 0;
    if (visible && trig !== lastTrigger && stage.classList.contains('on') && opts.transient) {
      stage.classList.remove('on');
      void stage.offsetWidth;
    }
    lastTrigger = trig;
    if (entry && entry.durationMs) stage.style.setProperty('--hide-ms', entry.durationMs + 'ms');
    stage.classList.toggle('on', visible);
  }

  // ---- helpers for overlay scripts ---------------------------------------------------------
  function setText(el, text) {
    text = text === null || text === undefined ? '' : String(text);
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('tick');
    void el.offsetWidth;
    el.classList.add('tick');
  }

  function chips(el, list) {
    var key = list.map(function (c) { return c.kind + ':' + c.label; }).join('|');
    if (el.getAttribute('data-key') === key) return;
    el.setAttribute('data-key', key);
    el.innerHTML = '';
    list.forEach(function (c) {
      var s = document.createElement('span');
      s.className = 'chip k-' + c.kind;
      s.textContent = c.label;
      el.appendChild(s);
    });
  }

  function currentInnings(state) {
    return state.current || state.innings[state.innings.length - 1] || null;
  }

  /** Two stable slots for the batters at the crease: a name never moves when strike rotates. */
  function slots(inn) {
    var ids = [inn.strikerId, inn.nonStrikerId].filter(function (x) { return !!x; });
    var next = [null, null];
    slotMemory.forEach(function (id, i) { if (id && ids.indexOf(id) >= 0) next[i] = id; });
    ids.forEach(function (id) {
      if (next.indexOf(id) < 0) next[next[0] === null ? 0 : 1] = id;
    });
    slotMemory = next;
    return next;
  }

  function batter(inn, id) {
    for (var i = 0; i < inn.batting.length; i++) if (inn.batting[i].id === id) return inn.batting[i];
    return null;
  }

  function bowlerOf(inn) {
    for (var i = 0; i < inn.bowling.length; i++) if (inn.bowling[i].id === inn.bowlerId) return inn.bowling[i];
    for (var j = 0; j < inn.bowling.length; j++) if (inn.bowling[j].current) return inn.bowling[j];
    return null;
  }

  function initials(name) {
    return String(name || '').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 3).toUpperCase();
  }

  function teamBadge(el, team) {
    var key = (team.logo || '') + '|' + team.shortName + '|' + team.color;
    if (el.getAttribute('data-key') === key) return;
    el.setAttribute('data-key', key);
    el.innerHTML = '';
    el.style.setProperty('--tc', team.color);
    if (team.logo) {
      var img = document.createElement('img');
      img.src = team.logo;
      img.alt = '';
      el.appendChild(img);
    } else {
      el.textContent = team.shortName.charAt(0);
    }
  }

  function chaseText(inn) {
    if (inn.target === null || inn.complete) return '';
    return 'Need ' + inn.runsNeeded + ' off ' + inn.ballsRemaining;
  }

  function fix2(n) { return n === null || n === undefined ? '-' : Number(n).toFixed(2); }
  function fix1(n) { return Number(n || 0).toFixed(1); }

  function colors(state, inn) {
    var r = document.documentElement.style;
    r.setProperty('--ta', state.teams.A.color);
    r.setProperty('--tb', state.teams.B.color);
    r.setProperty('--tbat', inn ? state.teams[inn.battingSide].color : state.teams.A.color);
  }

  var U = {
    cfg: cfg, setText: setText, chips: chips, currentInnings: currentInnings, slots: slots, batter: batter, bowlerOf: bowlerOf,
    initials: initials, teamBadge: teamBadge, chaseText: chaseText, fix1: fix1, fix2: fix2, colors: colors,
    el: function (id) { return document.getElementById(id); },
    empty: function (b) { stage.classList.toggle('empty', !!b); },
  };

  window.Overlay = {
    init: function (o) {
      opts = o;
      setup();
      stage = document.getElementById('stage');
      stage.classList.add('stage');
      if (!o.sample) o.sample = null;
      startWs();
      setInterval(refresh, 1000);
      dbg();
    },
  };
})();
