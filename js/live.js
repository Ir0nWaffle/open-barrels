/*
 * Open Barrels — read-only live results page for spectators.
 * Link format: live.html#e=<event id>[&s=<server address>]
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  const id = (params.get('e') || '').toLowerCase();
  const server = (params.get('s') || (window.OB_CONFIG && window.OB_CONFIG.liveServer) || '').replace(/\/+$/, '');

  const view = { cls: null, mode: null };
  try {
    Object.assign(view, JSON.parse(sessionStorage.getItem('ob-live-view-' + id) || '{}'));
  } catch (e) { /* no saved view */ }

  let data = null;
  let ended = false;
  let ws = null;
  let retryMs = 1000;
  let pingTimer = null;
  let reconnectTimer = null;

  function setConn(on, text) {
    $('#conn').classList.toggle('off', !on);
    $('#connText').textContent = text;
  }

  function message(html) {
    $('#main').innerHTML = `<section class="card empty">${html}</section>`;
  }

  if (!/^[a-z0-9]{6,24}$/.test(id) || !server) {
    setConn(false, 'No link');
    message('<p>This page shows live results from an Open Barrels event.</p><p>Ask the organizer for the live link.</p>');
    return;
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (ended) return;
    const wsUrl = server.replace(/^http/, 'ws') + '/v1/rooms/' + id + '/ws';
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      return scheduleReconnect();
    }
    ws.onopen = () => {
      retryMs = 1000;
      setConn(true, 'Live');
      clearInterval(pingTimer);
      pingTimer = setInterval(() => ws && ws.readyState === 1 && ws.send('ping'), 50000);
    };
    ws.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg.type === 'snapshot') {
        data = msg.data;
        render();
      } else if (msg.type === 'empty') {
        if (!data) message('<p>The organizer hasn’t posted anything yet.</p><p class="muted small">This page updates by itself.</p>');
      } else if (msg.type === 'ended') {
        endedView();
      }
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      if (ended) return;
      setConn(false, 'Reconnecting…');
      checkStillExists();
      scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch (e) { /* ignore */ }
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 20000);
  }

  // A closed socket might mean the link was ended while we were away.
  function checkStillExists() {
    fetch(server + '/v1/rooms/' + id, { cache: 'no-store' })
      .then((r) => {
        if (r.status === 404) endedView();
      })
      .catch(() => {});
  }

  function endedView() {
    ended = true;
    clearTimeout(reconnectTimer);
    setConn(false, 'Ended');
    if (data) {
      render();
      const note = document.createElement('div');
      note.className = 'notice warn';
      note.textContent = 'The organizer has ended live results. This is the last update.';
      $('#main').prepend(note);
    } else message('<p>This live link has ended or doesn’t exist.</p><p class="muted small">Ask the organizer for a new link.</p>');
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !ended && (!ws || ws.readyState > 1)) {
      retryMs = 1000;
      connect();
    }
  });
  window.addEventListener('online', () => {
    if (!ended && (!ws || ws.readyState > 1)) connect();
  });

  // ------------------------------------------------------------ drawing

  function render() {
    if (!data) return;
    const d = data;
    document.title = (d.name || 'Live Results') + ' — Live';
    const classes = d.classes || [];
    let cls = classes.find((c) => c.id === view.cls);
    if (!cls) cls = classes.find((c) => c.state === 'running') || classes.find((c) => c.state === 'waiting') || classes[0];
    const modes = [];
    if (cls && (cls.results || cls.resultsLater)) modes.push(['standings', 'Standings']);
    if (cls && cls.draw) modes.push(['draw', 'Draw']);
    let mode = modes.find((m) => m[0] === view.mode) ? view.mode : modes[0] && modes[0][0];

    const up = d.upNext || [];
    const upBox = (label, x, cssClass) =>
      `<div class="${cssClass}"><div class="lbl">${label}${x && x.cls && cls && x.cls !== cls.name ? ` <span class="pill">${esc(x.cls)}</span>` : ''}</div>
       <div class="nm ${x ? '' : 'muted'}">${x ? esc(x.rider) : '—'}</div><div class="hs">${x ? esc(x.horse || '—') : '&nbsp;'}</div></div>`;

    const updated = d.updatedAt ? new Date(d.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

    let body = '';
    if (!cls) body = '<section class="card empty"><p>No classes yet.</p></section>';
    else if (mode === 'standings') body = renderStandings(cls, d.show || {});
    else if (mode === 'draw') body = renderDraw(cls, up[0]);
    else body = '<section class="card empty"><p>The organizer isn’t sharing standings or the draw for this class.</p></section>';

    $('#main').innerHTML = `
      <div class="viewer-head">
        <h1>${esc(d.name)}${d.demo ? ' <span class="pill warn">Demo</span>' : ''}</h1>
        <div class="muted small">${esc([d.date, d.location].filter(Boolean).join(' · '))}${updated ? ` · updated ${esc(updated)}` : ''}</div>
      </div>
      ${
        d.demo
          ? `<div class="notice warn">This is a demo of Open Barrels live results. It ends ${esc(
              new Date(d.expiresAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
            )}.</div>`
          : ''
      }
      ${up.length ? `<div class="upnext">${upBox('Now up', up[0], 'now')}${upBox('On deck', up[1], '')}${upBox('In the hole', up[2], '')}</div>` : ''}
      <div class="class-tabs">${classes
        .map(
          (c) => `<button aria-pressed="${cls && c.id === cls.id}" data-cls="${esc(c.id)}">${esc(c.name)}${
            c.state === 'running' ? ' <span class="live-dot"></span>' : c.state === 'done' ? ' <span class="count">✓</span>' : ''
          }</button>`
        )
        .join('')}</div>
      ${modes.length > 1 ? `<div class="seg">${modes.map((m) => `<button data-mode="${m[0]}" aria-pressed="${m[0] === mode}">${m[1]}</button>`).join('')}</div>` : ''}
      ${body}
      <p class="muted small" style="text-align:center">Powered by <a href="./">Open Barrels</a> — free barrel racing software</p>`;
  }

  function renderStandings(cls, show) {
    if (!cls.results) {
      return `<section class="card empty"><p>Placings for ${esc(cls.name)} will be posted when the class is finished.</p></section>`;
    }
    const withTimes = !!show.times;
    const divs = cls.results
      .map((dv) => {
        const rows = dv.rows || [];
        return `<div class="div-block"><h3>${esc(dv.name)} <span class="muted">${dv.start ? 'from ' + esc(dv.start) + ' · ' : ''}${dv.places} ${dv.places === 1 ? 'place' : 'places'}</span></h3>
        ${
          rows.length
            ? `<div class="table-scroll"><table class="res-table"><thead><tr><th>Place</th><th>Rider</th><th>Horse</th>${withTimes ? '<th class="r">Time</th>' : ''}</tr></thead><tbody>
            ${rows
              .map((r) => `<tr class="placed"><td>${esc(r.place)}</td><td>${esc(r.rider)}</td><td>${esc(r.horse)}</td>${withTimes ? `<td class="r num">${esc(r.time || '')}</td>` : ''}</tr>`)
              .join('')}</tbody></table></div>`
            : '<p class="muted small">No times yet.</p>'
        }</div>`;
      })
      .join('');
    const status = cls.state === 'done' ? '<span class="pill good">Final</span>' : cls.state === 'running' ? '<span class="pill warn">In progress</span>' : '';
    return `<section class="card"><div class="card-head"><h2>${esc(cls.name)}</h2>${status}</div>${divs}</section>`;
  }

  function renderDraw(cls, now) {
    const list = cls.draw || [];
    let nowIdx = -1;
    if (now) nowIdx = list.findIndex((x) => x.st === 'waiting');
    if (now && now.cls !== cls.name) nowIdx = -1;
    const rows = list
      .map((x, i) => {
        let res = '';
        if (x.st === 'ran') res = x.time ? esc(x.time) + (x.bbl ? ` <span class="muted small">+${x.bbl} bbl</span>` : '') : '✓';
        else if (x.st === 'nt') res = 'NT';
        else if (x.st === 'scratch') res = '<span class="muted">Scr</span>';
        else if (i === nowIdx) res = '<span class="pill warn">Up now</span>';
        return `<li class="st-${esc(x.st)} ${i === nowIdx ? 'is-now' : ''}"><span class="pos">${i + 1}</span>
          <div class="who"><b>${esc(x.rider)}</b><span class="horse">${esc(x.horse || '—')}${x.late ? ' · late entry' : ''}</span></div>
          <span class="res">${res}</span></li>`;
      })
      .join('');
    return `<section class="card"><div class="card-head"><h2>${esc(cls.name)} draw</h2><span class="muted small">${list.length} runs</span></div>
      ${list.length ? `<ol class="draw-list">${rows}</ol>` : '<p class="muted">No entries yet.</p>'}</section>`;
  }

  document.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-cls]');
    const m = ev.target.closest('[data-mode]');
    if (!c && !m) return;
    if (c) view.cls = c.dataset.cls;
    if (m) view.mode = m.dataset.mode;
    try {
      sessionStorage.setItem('ob-live-view-' + id, JSON.stringify(view));
    } catch (e) { /* ignore */ }
    render();
  });

  connect();
})();
