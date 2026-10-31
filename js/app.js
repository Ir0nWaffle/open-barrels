/*
 * Open Barrels — page code. Everything is saved in this browser (localStorage);
 * use Setup → Backup to move an event to another device.
 */
(function () {
  'use strict';

  const STORE_KEY = 'openbarrels.v1';
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => new Date().toISOString().slice(0, 10);
  const CLASS_PRESETS = ['Peewee', 'Youth', 'Junior', 'Senior', 'Open', 'Novice Horse', 'Exhibition'];
  const PEN_LABELS = ['—', '+1 bbl', '+2 bbl', '+3 bbl'];

  // ------------------------------------------------------------ state

  let S = load();
  const ui = { tab: 'setup', runClassId: null, showAll: false, drawNotes: {}, openPay: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY + '.ui') || '{}');
    if (saved.tab) ui.tab = saved.tab;
    if (saved.runClassId) ui.runClassId = saved.runClassId;
  } catch (e) { /* no stored view */ }

  function blankState() {
    return { version: 1, currentId: null, events: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const st = JSON.parse(raw);
        if (st && Array.isArray(st.events)) return st;
      }
    } catch (e) { /* storage blocked or corrupt */ }
    return blankState();
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 150);
    queueLivePush();
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(S));
      localStorage.setItem(STORE_KEY + '.ui', JSON.stringify({ tab: ui.tab, runClassId: ui.runClassId }));
    } catch (e) {
      toast('Could not save on this device — use Backup to keep a copy');
    }
  }
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveNow());

  function newEvent(name) {
    return {
      id: uid(),
      name: name || 'Jackpot ' + today(),
      date: today(),
      location: '',
      gap: 5,
      spaceHorses: true,
      classes: [],
      entries: [],
    };
  }

  function newClass(name, copyFrom) {
    const base = copyFrom
      ? JSON.parse(JSON.stringify(copyFrom))
      : { divisions: 4, split: 0.5, penalty: 5, places: [3, 3, 3, 3], entryFee: 0, officeFee: 0, addedMoney: 0 };
    const cls = {
      id: uid(),
      name: name || 'New class',
      divisions: base.divisions,
      split: base.split,
      penalty: base.penalty,
      places: base.places,
      entryFee: base.entryFee,
      officeFee: base.officeFee,
      addedMoney: base.addedMoney,
      divPct: base.divPct,
      placePct: base.placePct,
      order: [],
      drawn: false,
    };
    return BR.normalizeClass(cls);
  }

  function ev() {
    let e = S.events.find((x) => x.id === S.currentId);
    if (!e) {
      e = S.events[0];
      if (!e) {
        e = newEvent();
        S.events.push(e);
      }
      S.currentId = e.id;
    }
    return e;
  }

  const classById = (id) => ev().classes.find((c) => c.id === id);
  const entryById = (id) => ev().entries.find((x) => x.id === id);

  /** Entries of a class in running order (repairs the order list if needed). */
  function classEntries(cls) {
    const all = ev().entries.filter((x) => x.classId === cls.id);
    const ids = new Set(all.map((x) => x.id));
    cls.order = (cls.order || []).filter((id) => ids.has(id));
    const inOrder = new Set(cls.order);
    for (const x of all) if (!inOrder.has(x.id)) cls.order.push(x.id);
    const map = new Map(all.map((x) => [x.id, x]));
    return cls.order.map((id) => map.get(id));
  }

  /** The whole day's running order, class after class. */
  function fullSequence() {
    const seq = [];
    for (const c of ev().classes) for (const x of classEntries(c)) seq.push(x);
    return seq;
  }

  const classStarted = (cls) => classEntries(cls).some((x) => x.status !== 'waiting');

  // ------------------------------------------------------------ helpers

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  const slug = (s) => String(s || 'event').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'event';

  function knownNames() {
    const riders = new Map();
    const horsesByRider = new Map();
    const horses = new Map();
    for (const e of S.events)
      for (const x of e.entries) {
        if (x.rider) riders.set(BR.norm(x.rider), x.rider);
        if (x.horse) {
          horses.set(BR.norm(x.horse), x.horse);
          const k = BR.norm(x.rider);
          if (!horsesByRider.has(k)) horsesByRider.set(k, new Map());
          horsesByRider.get(k).set(BR.norm(x.horse), x.horse);
        }
      }
    return { riders, horses, horsesByRider };
  }

  function printHTML(html) {
    const area = $('#printArea');
    area.innerHTML = html;
    document.body.classList.add('printing');
    const done = () => {
      document.body.classList.remove('printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1500);
  }

  // ------------------------------------------------------------ render

  function render() {
    const active = document.activeElement;
    const focusId = active && active.id ? active.id : null;
    // Keep whatever is half-typed in the focused box (e.g. the next rider's time).
    const typed = active && active.classList && active.classList.contains('time-in') ? active.value : null;
    let sel = null;
    try {
      if (focusId && active.selectionStart != null) sel = [active.selectionStart, active.selectionEnd];
    } catch (e) { /* not a text field */ }
    const scroll = window.scrollY;

    const e = ev();
    const es = $('#eventSelect');
    es.innerHTML =
      S.events
        .map((x) => `<option value="${esc(x.id)}" ${x.id === e.id ? 'selected' : ''}>${esc(x.name)}${x.date ? ' · ' + esc(x.date) : ''}</option>`)
        .join('') + '<option value="__new">+ New event…</option>';

    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
    const main = $('#main');
    if (ui.tab === 'setup') main.innerHTML = renderSetup();
    else if (ui.tab === 'entries') main.innerHTML = renderEntries();
    else if (ui.tab === 'run') main.innerHTML = renderRun();
    else main.innerHTML = renderResults();

    window.scrollTo(0, scroll);
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        if (typed != null && el.value !== typed) el.value = typed;
        el.focus({ preventScroll: true });
        if (sel && el.setSelectionRange) {
          try { el.setSelectionRange(sel[0], sel[1]); } catch (err) { /* ignore */ }
        }
      }
    }
    if (ui.tab === 'entries') updateHorseList();
  }

  // ---------------- setup tab

  function renderSetup() {
    const e = ev();
    return `
    <section class="card">
      <div class="card-head"><h2>Event</h2></div>
      <div class="grid">
        <label class="field wide">Event name<input id="ev-name" data-ev="name" value="${esc(e.name)}" autocomplete="off"></label>
        <label class="field">Date<input id="ev-date" type="date" data-ev="date" value="${esc(e.date)}"></label>
        <label class="field">Location<input id="ev-loc" data-ev="location" value="${esc(e.location)}" autocomplete="off"></label>
        <label class="field">Runs between a rider's horses
          <input id="ev-gap" type="number" inputmode="numeric" min="0" max="50" data-ev="gap" value="${esc(e.gap)}"></label>
      </div>
      <p style="margin-top:10px"><label class="check"><input type="checkbox" data-ev="spaceHorses" ${e.spaceHorses ? 'checked' : ''}>
        Also space out a horse that is shared by more than one rider</label></p>
      <p class="muted small">Shuffle tries to give each rider at least this many runs between their horses, including across the end of one class and the start of the next.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Classes</h2><span class="muted small">Run in this order</span></div>
      ${e.classes.length ? '' : '<p class="muted">Add the classes for this event. Each class has its own divisions, split and number of places.</p>'}
      <div class="row-actions">
        ${CLASS_PRESETS.map((n) => `<button class="small" data-action="add-class" data-name="${esc(n)}">+ ${esc(n)}</button>`).join('')}
        <button class="small primary" data-action="add-class" data-name="">+ Other…</button>
      </div>
    </section>

    ${e.classes.map((c, i) => renderClassCard(c, i, e.classes.length)).join('')}

    ${renderLiveCard(e)}

    <section class="card">
      <div class="card-head"><h2>Events &amp; backup</h2></div>
      <p class="muted small">Everything is saved on this device only. Download a backup to keep a copy or open the event on another phone or computer.</p>
      <div class="row-actions">
        <button data-action="new-event">New blank event</button>
        <button data-action="copy-event">New event with these classes</button>
        <button data-action="export-event">Download backup</button>
        <label class="btn" for="importFile">Open backup…</label>
        <input id="importFile" type="file" accept=".json,application/json" hidden>
        <span class="spacer"></span>
        <button class="danger" data-action="delete-event">Delete this event</button>
      </div>
    </section>
    <p class="muted small" style="text-align:center">Open Barrels is free and open source.</p>`;
  }

  function renderClassCard(c, i, count) {
    BR.normalizeClass(c);
    const D = c.divisions;
    const hasMoney = (Number(c.entryFee) || 0) > 0 || (Number(c.addedMoney) || 0) > 0;
    const divPctSum = BR.sum(c.divPct);
    const n = classEntries(c).length;
    const rows = [];
    for (let d = 0; d < D; d++) {
      const pp = c.placePct[d] || [];
      const ppSum = BR.sum(pp);
      rows.push(`<tr>
        <td><b>${d + 1}D</b></td>
        <td><input class="places-in" id="c-${c.id}-pl-${d}" type="number" inputmode="numeric" min="0" max="50"
             data-cls="${c.id}" data-field="places" data-d="${d}" value="${c.places[d]}" aria-label="Places paid in ${d + 1}D"></td>
        <td class="pay-col"><input class="pct-in" id="c-${c.id}-dp-${d}" type="number" inputmode="decimal" step="0.5" min="0" max="100"
             data-cls="${c.id}" data-field="divPct" data-d="${d}" value="${c.divPct[d]}" aria-label="Percent of pot for ${d + 1}D"></td>
        <td class="pay-col"><input id="c-${c.id}-pp-${d}" data-cls="${c.id}" data-field="placePct" data-d="${d}"
             value="${esc(pp.join(', '))}" aria-label="Percent per place in ${d + 1}D" autocomplete="off">
             ${pp.length && Math.abs(ppSum - 100) > 0.01 ? `<span class="pill warn">adds to ${ppSum}%</span>` : ''}</td>
      </tr>`);
    }
    return `
    <section class="card class-card ${hasMoney ? 'has-money' : ''} ${hasMoney || ui.openPay[c.id] ? 'show-pay' : ''}" data-class-card="${c.id}">
      <div class="card-head">
        <h3>${esc(c.name)} <span class="muted small">· ${n} ${n === 1 ? 'entry' : 'entries'}</span></h3>
        <div class="row-actions">
          <button class="small ghost" data-action="class-up" data-cls="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move class up">▲</button>
          <button class="small ghost" data-action="class-down" data-cls="${c.id}" ${i === count - 1 ? 'disabled' : ''} aria-label="Move class down">▼</button>
          <button class="small danger" data-action="del-class" data-cls="${c.id}">Delete</button>
        </div>
      </div>
      <div class="grid">
        <label class="field">Class name<input id="c-${c.id}-name" data-cls="${c.id}" data-field="name" value="${esc(c.name)}" autocomplete="off"></label>
        <label class="field">Divisions
          <select id="c-${c.id}-div" data-cls="${c.id}" data-field="divisions">
            ${[1, 2, 3, 4, 5, 6].map((v) => `<option value="${v}" ${v === D ? 'selected' : ''}>${v}D</option>`).join('')}
          </select></label>
        <label class="field">Split (seconds)
          <input id="c-${c.id}-split" type="number" inputmode="decimal" step="0.1" min="0.1" data-cls="${c.id}" data-field="split" value="${esc(c.split)}"></label>
        <label class="field">Penalty per barrel (s)
          <input id="c-${c.id}-pen" type="number" inputmode="decimal" step="1" min="0" data-cls="${c.id}" data-field="penalty" value="${esc(c.penalty)}"></label>
      </div>

      <table class="div-table">
        <thead><tr><th>Div</th><th>Places paid</th>
          <th class="pay-col">% of pot</th><th class="pay-col">% to each place (1st, 2nd, …)</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      ${hasMoney && Math.abs(divPctSum - 100) > 0.01 ? `<p class="notice warn">Division percentages add up to ${divPctSum}%, not 100%.</p>` : ''}

      <details class="payout" data-pay="${c.id}" ${hasMoney || ui.openPay[c.id] ? 'open' : ''}>
        <summary>Jackpot money ${hasMoney ? '' : '<span class="muted small">(optional — leave at $0 for places only)</span>'}</summary>
        <div class="grid">
          <label class="field">Entry fee ($)<input id="c-${c.id}-fee" type="number" inputmode="decimal" step="1" min="0" data-cls="${c.id}" data-field="entryFee" value="${esc(c.entryFee)}"></label>
          <label class="field">Office / arena fee kept ($ per run)<input id="c-${c.id}-off" type="number" inputmode="decimal" step="1" min="0" data-cls="${c.id}" data-field="officeFee" value="${esc(c.officeFee)}"></label>
          <label class="field">Added money ($)<input id="c-${c.id}-add" type="number" inputmode="decimal" step="1" min="0" data-cls="${c.id}" data-field="addedMoney" value="${esc(c.addedMoney)}"></label>
        </div>
        <p class="muted small">Pot = (entry fee − office fee) × runs + added money. Scratched entries are treated as refunded. The % columns in the table above say how the pot is shared.</p>
      </details>
    </section>`;
  }

  // ---------------- entries tab

  function renderEntries() {
    const e = ev();
    if (!e.classes.length) {
      return `<section class="card empty"><p>Add your classes first.</p><button class="primary" data-action="goto" data-tab="setup">Go to Setup</button></section>`;
    }
    const names = knownNames();
    const last = ui.lastClasses || [e.classes[0].id];
    const classChecks = e.classes
      .map((c) => `<label class="chip-check"><input type="checkbox" name="addClass" value="${c.id}" ${last.includes(c.id) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`)
      .join('');

    const groups = e.classes
      .map((c) => {
        const list = classEntries(c);
        const late = list.filter((x) => x.late).length;
        return `<section class="card">
          <div class="card-head"><h3>${esc(c.name)} <span class="muted small">· ${list.length} ${list.length === 1 ? 'entry' : 'entries'}${late ? ` · ${late} late` : ''}</span></h3></div>
          ${
            list.length
              ? `<ul class="entry-list">${list
                  .slice()
                  .sort((a, b) => a.rider.localeCompare(b.rider) || a.horse.localeCompare(b.horse))
                  .map(
                    (x) => `<li>
                <div class="who"><b>${esc(x.rider)}</b><span class="horse">${esc(x.horse || '—')}</span></div>
                ${x.late ? '<span class="pill warn">Late</span>' : ''}
                ${x.status === 'scratch' ? '<span class="pill">Scratched</span>' : ''}
                <button class="small" data-action="edit-entry" data-id="${x.id}">Edit</button>
                <button class="small danger" data-action="del-entry" data-id="${x.id}" aria-label="Remove ${esc(x.rider)}">✕</button>
              </li>`
                  )
                  .join('')}</ul>`
              : '<p class="muted small">No entries yet.</p>'
          }
        </section>`;
      })
      .join('');

    return `
    <section class="card">
      <div class="card-head"><h2>Add a rider</h2></div>
      <form id="addForm" autocomplete="off">
        <div class="grid">
          <label class="field">Rider<input id="add-rider" name="rider" list="riderList" required placeholder="Rider name"></label>
          <label class="field">Horse<input id="add-horse" name="horse" list="horseList" placeholder="Horse name"></label>
        </div>
        <p class="small muted" style="margin:12px 0 6px">Classes (pick one or more)</p>
        <div class="chips" id="addClasses">${classChecks}</div>
        <div class="row-actions" style="margin-top:12px">
          <button class="primary" type="submit">Add entry</button>
          <span class="muted small">Riders added after the draw go to the end of the class.</span>
        </div>
      </form>
      <datalist id="riderList">${Array.from(names.riders.values()).sort().map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
      <datalist id="horseList"></datalist>
      <details style="margin-top:14px">
        <summary><b>Add many at once</b></summary>
        <p class="muted small">One entry per line: <code>Rider, Horse</code>. They go into the classes picked above.</p>
        <textarea id="bulkText" placeholder="Jane Smith, Dash For Cash&#10;Kaylee Jones, Blue"></textarea>
        <div class="row-actions" style="margin-top:8px"><button data-action="bulk-add">Add these entries</button></div>
      </details>
    </section>
    ${groups}`;
  }

  function updateHorseList() {
    const rEl = $('#add-rider');
    const list = $('#horseList');
    if (!rEl || !list) return;
    const names = knownNames();
    const mine = names.horsesByRider.get(BR.norm(rEl.value));
    const first = mine ? Array.from(mine.values()).sort() : [];
    const rest = Array.from(names.horses.values()).filter((h) => !mine || !mine.has(BR.norm(h))).sort();
    list.innerHTML = first.concat(rest).map((h) => `<option value="${esc(h)}">`).join('');
  }

  function addEntries(pairs, classIds) {
    const e = ev();
    let added = 0;
    let dupes = 0;
    let late = 0;
    for (const cid of classIds) {
      const cls = classById(cid);
      if (!cls) continue;
      const isLate = cls.drawn || classStarted(cls);
      classEntries(cls);
      for (const [rider, horse] of pairs) {
        const exists = e.entries.some(
          (x) => x.classId === cid && BR.norm(x.rider) === BR.norm(rider) && BR.norm(x.horse) === BR.norm(horse)
        );
        if (exists) {
          dupes++;
          continue;
        }
        const entry = { id: uid(), classId: cid, rider, horse, status: 'waiting', timeMs: null, barrels: 0, late: isLate };
        e.entries.push(entry);
        cls.order.push(entry.id);
        added++;
        if (isLate) late++;
      }
    }
    save();
    let msg = added === 1 ? 'Added 1 entry' : `Added ${added} entries`;
    if (late) msg += ` (${late} at end of draw)`;
    if (dupes) msg += ` · ${dupes} already entered`;
    toast(msg);
    return added;
  }

  // ---------------- run tab

  function renderRun() {
    const e = ev();
    if (!e.classes.length) {
      return `<section class="card empty"><p>Add your classes first.</p><button class="primary" data-action="goto" data-tab="setup">Go to Setup</button></section>`;
    }
    let cls = classById(ui.runClassId);
    if (!cls) {
      cls = e.classes.find((c) => classEntries(c).some((x) => x.status === 'waiting')) || e.classes[0];
      ui.runClassId = cls.id;
    }
    const list = classEntries(cls);
    const seq = fullSequence();

    // Spacing check across the whole day, flags rows that come too soon.
    const spacing = BR.measureSpacing(seq, e.gap, e.spaceHorses);
    const tooSoon = new Map();
    for (const p of spacing.problems) {
      const prev = tooSoon.get(p.item.id);
      if (!prev || p.between < prev.between) tooSoon.set(p.item.id, p);
    }

    const nowIdx = seq.findIndex((x) => x.classId === cls.id && x.status === 'waiting');
    const upcoming = [];
    if (nowIdx >= 0) for (let i = nowIdx; i < seq.length && upcoming.length < 3; i++) if (seq[i].status === 'waiting') upcoming.push(seq[i]);
    const nowId = upcoming[0] ? upcoming[0].id : null;

    const upBox = (label, x, cssClass) => {
      if (!x) return `<div class="${cssClass}"><div class="lbl">${label}</div><div class="nm muted">—</div><div class="hs">&nbsp;</div></div>`;
      const other = x.classId !== cls.id ? ` <span class="pill">${esc(classById(x.classId).name)}</span>` : '';
      return `<div class="${cssClass}"><div class="lbl">${label}${other}</div><div class="nm">${esc(x.rider)}</div><div class="hs">${esc(x.horse || '—')}</div></div>`;
    };

    const tabs = e.classes
      .map((c) => {
        const l = classEntries(c);
        const done = l.filter((x) => x.status !== 'waiting').length;
        return `<button aria-pressed="${c.id === cls.id}" data-action="run-class" data-cls="${c.id}">${esc(c.name)} <span class="count">${done}/${l.length}</span></button>`;
      })
      .join('');

    const note = ui.drawNotes[cls.id];
    const rows = list
      .map((x, i) => {
        const soon = tooSoon.get(x.id);
        const flags = [];
        if (x.late) flags.push('<span class="pill warn">Late</span>');
        if (x.moved) flags.push('<span class="pill">Moved</span>');
        if (soon) {
          const why = soon.key.startsWith('h:') ? 'horse' : 'rider';
          flags.push(`<span class="pill warn" title="Same ${why} ran ${soon.between} runs earlier">⚠ ${soon.between} runs after last ${why === 'horse' ? 'run on this horse' : 'ride'}</span>`);
        }
        const status = x.status;
        return `<li class="run-row ${status !== 'waiting' ? 'done' : ''} status-${status} ${x.id === nowId ? 'is-now' : ''}" data-id="${x.id}">
          <button class="drag-handle" aria-label="Drag to move ${esc(x.rider)}" title="Drag to move">⠿</button>
          <span class="pos">${i + 1}</span>
          <div class="who"><b>${esc(x.rider)}</b><span class="horse">${esc(x.horse || '—')}</span>${flags.length ? `<div class="flags">${flags.join('')}</div>` : ''}</div>
          <div class="controls">
            <input class="time-in" id="t-${x.id}" data-time="${x.id}" inputmode="decimal" autocomplete="off" enterkeyhint="next"
              placeholder="${status === 'nt' ? 'NT' : status === 'scratch' ? 'Scr' : 'Time'}" value="${x.timeMs != null && status === 'ran' ? BR.formatTime(x.timeMs) : ''}"
              ${status === 'scratch' ? 'disabled' : ''} aria-label="Time for ${esc(x.rider)}">
            <select class="pen-in" id="p-${x.id}" data-pen="${x.id}" aria-label="Knocked barrels" ${status === 'scratch' ? 'disabled' : ''}>
              ${PEN_LABELS.map((l, n) => `<option value="${n}" ${n === (x.barrels || 0) ? 'selected' : ''}>${n ? '+' + n * (Number(cls.penalty) || 0) + 's' : 'Clean'}</option>`).join('')}
            </select>
            <button class="nt-btn small" data-action="nt" data-id="${x.id}" aria-pressed="${status === 'nt'}" ${status === 'scratch' ? 'disabled' : ''} title="No time">NT</button>
          </div>
          <button class="more-btn small ghost" data-action="more" data-id="${x.id}" aria-label="More options for ${esc(x.rider)}">⋯</button>
        </li>`;
      })
      .join('');

    return `
      ${e.live ? `<div class="live-strip"><span class="live-dot"></span> Live link on · <span data-live-status="${e.id}">${esc(liveStatusText(e))}</span></div>` : ''}
      <div class="class-tabs">${tabs}</div>
      ${
        nowId || classStarted(cls)
          ? `<div class="upnext">${upBox('Now up', upcoming[0], 'now')}${upBox('On deck', upcoming[1], '')}${upBox('In the hole', upcoming[2], '')}</div>`
          : ''
      }
      <section class="card">
        <div class="card-head">
          <h2>${esc(cls.name)} draw</h2>
          <div class="row-actions">
            <button class="primary" data-action="shuffle" data-cls="${cls.id}" ${list.length < 2 ? 'disabled' : ''}>Shuffle</button>
            <button data-action="shuffle-all">Shuffle all classes</button>
            <button data-action="print-draw">Print draw</button>
          </div>
        </div>
        ${note ? `<div class="notice ${note.ok ? 'good' : 'warn'}">${esc(note.text)}</div>` : ''}
        ${
          list.length
            ? `<p class="muted small">Type each time and press Enter. Drag ⠿ to move a rider who missed their turn, or use ⋯ → Move to end.</p>
               <ol class="run-list" id="runList">${rows}</ol>`
            : `<div class="empty"><p>No entries in this class yet.</p><button data-action="goto" data-tab="entries">Add entries</button></div>`
        }
        <div class="row-actions" style="margin-top:10px">
          <button data-action="goto" data-tab="entries">+ Add late entry</button>
          <span class="spacer"></span>
          <button data-action="goto" data-tab="results">See results →</button>
        </div>
      </section>`;
  }

  function shuffleClass(cls, useNeighbours) {
    const e = ev();
    const list = classEntries(cls);
    // Runs already made stay where they are; only riders still waiting move.
    const fixed = list.filter((x) => x.status !== 'waiting');
    const pending = list.filter((x) => x.status === 'waiting');
    const ci = e.classes.indexOf(cls);
    const before = [];
    for (let i = 0; i < ci; i++) before.push(...classEntries(e.classes[i]));
    const prefix = before.concat(fixed).slice(-Math.max(1, e.gap + 1) * 3);
    const after = [];
    if (useNeighbours) for (let i = ci + 1; i < e.classes.length; i++) after.push(...classEntries(e.classes[i]));
    const res = BR.shuffleDraw(pending, { gap: e.gap, spaceHorses: e.spaceHorses, prefix, suffix: after.slice(0, (e.gap + 1) * 3) });
    cls.order = fixed.concat(res.order).map((x) => x.id);
    cls.drawn = true;
    for (const x of res.order) delete x.moved;
    ui.drawNotes[cls.id] = spacingNote(cls, pending.length);
    return res;
  }

  /** Spacing summary for one class, measured on the whole day's order. */
  function spacingNote(cls, shuffled) {
    const e = ev();
    const seq = fullSequence();
    const problems = BR.measureSpacing(seq, e.gap, e.spaceHorses).problems.filter(
      (p) => seq[p.pos].classId === cls.id || seq[p.prev].classId === cls.id
    );
    if (shuffled != null && shuffled < 2) return { ok: true, text: 'Nothing to shuffle.' };
    if (!problems.length) {
      return { ok: true, text: e.gap > 0 ? `Shuffled. Every rider has at least ${e.gap} runs between horses.` : 'Shuffled.' };
    }
    const who = Array.from(new Set(problems.map((p) => p.item.rider))).slice(0, 3).join(', ');
    const n = problems.length;
    return {
      ok: false,
      text: `Shuffled as evenly as possible, but ${n} ${n === 1 ? 'spot has' : 'spots have'} fewer than ${e.gap} runs between (${who}). The class may be too small for that many horses per rider.`,
      count: n,
    };
  }

  /** Shuffle every class, then re-shuffle each one knowing its neighbours, until spacing works. */
  function shuffleAll() {
    const e = ev();
    for (const c of e.classes) shuffleClass(c, false);
    for (let round = 0; round < 6; round++) {
      const bad = e.classes.filter((c) => !spacingNote(c).ok);
      if (!bad.length) break;
      for (const c of e.classes) shuffleClass(c, true);
    }
    let bad = 0;
    for (const c of e.classes) {
      ui.drawNotes[c.id] = spacingNote(c, classEntries(c).filter((x) => x.status === 'waiting').length);
      if (!ui.drawNotes[c.id].ok) bad++;
    }
    return bad;
  }

  function moveEntry(cls, id, toIndex) {
    const order = cls.order.filter((x) => x !== id);
    order.splice(Math.max(0, Math.min(order.length, toIndex)), 0, id);
    cls.order = order;
    const x = entryById(id);
    if (x) x.moved = true;
    save();
  }

  // ---------------- results tab

  function computeAll() {
    return ev().classes.map((c) => BR.computeResults(c, classEntries(c)));
  }

  function renderResults() {
    const e = ev();
    if (!e.classes.length) {
      return `<section class="card empty"><p>No classes yet.</p><button class="primary" data-action="goto" data-tab="setup">Go to Setup</button></section>`;
    }
    const all = computeAll();
    const blocks = all.map((r) => renderClassResult(r, ui.showAll, false)).join('');
    const totals = riderTotals(all);
    return `
      <div class="row-actions" style="margin-bottom:12px">
        <label class="check"><input type="checkbox" data-action="toggle-all" ${ui.showAll ? 'checked' : ''}> Show every run</label>
        <span class="spacer"></span>
        <button data-action="print-results">Print results</button>
        <button data-action="export-csv">Download CSV</button>
      </div>
      ${blocks}
      ${
        totals.length
          ? `<section class="card"><div class="card-head"><h2>Payout by rider</h2><span class="muted small">for writing checks</span></div>
          <div class="table-scroll"><table class="res-table"><thead><tr><th>Rider</th><th>Won in</th><th class="r">Total</th></tr></thead><tbody>
          ${totals.map((t) => `<tr><td>${esc(t.rider)}</td><td class="small">${esc(t.items.join('; '))}</td><td class="r num"><b>${BR.formatMoney(t.cents)}</b></td></tr>`).join('')}
          </tbody></table></div></section>`
          : ''
      }`;
  }

  function placeLabel(row) {
    return (row.tied ? 'T-' : '') + BR.ordinal(row.place);
  }

  function renderClassResult(r, showAll, forPrint) {
    const c = r.cls;
    const hasMoney = r.potCents > 0;
    const head = `
      <div class="stats">
        <span>Entries <b>${r.paidEntries}</b></span>
        <span>Times <b>${r.runCount}</b></span>
        ${r.waiting.length ? `<span>Still to run <b>${r.waiting.length}</b></span>` : ''}
        <span>Fastest <b class="num">${r.fastestMs != null ? BR.formatTime(r.fastestMs) : '—'}</b></span>
        <span>Split <b>${esc(c.split)}s</b></span>
        ${hasMoney ? `<span>Pot <b>${BR.formatMoney(r.potCents)}</b></span>` : ''}
      </div>`;
    const divs = r.divisions
      .map((d) => {
        const rows = d.rows.filter((x) => showAll || x.placed);
        const range = d.startMs != null ? `from ${BR.formatTime(d.startMs)}` : '';
        const table = rows.length
          ? `<div class="table-scroll"><table class="res-table">
            <thead><tr><th>Place</th><th>Rider</th><th>Horse</th><th class="r">Time</th>${hasMoney ? '<th class="r">Payout</th>' : ''}</tr></thead>
            <tbody>${rows
              .map(
                (x) => `<tr class="${x.placed ? 'placed' : 'unplaced'}"><td>${x.placed ? placeLabel(x) : '—'}</td>
                <td>${esc(x.entry.rider)}</td><td>${esc(x.entry.horse)}</td>
                <td class="r num">${BR.formatTime(x.ms)}${x.entry.barrels ? ` <span class="muted small">(${x.entry.barrels} bbl)</span>` : ''}</td>
                ${hasMoney ? `<td class="r num">${x.payoutCents ? BR.formatMoney(x.payoutCents) : ''}</td>` : ''}</tr>`
              )
              .join('')}</tbody></table></div>`
          : '<p class="muted small">No times in this division.</p>';
        const unpaid =
          hasMoney && d.unpaidCents > 0 && r.waiting.length === 0
            ? `<p class="muted small">${BR.formatMoney(d.unpaidCents)} of ${d.name} money not paid out (not enough runners to fill ${d.places} places).</p>`
            : '';
        return `<div class="div-block"><h3>${d.name} <span class="muted">${range} · pays ${d.places} ${d.places === 1 ? 'place' : 'places'}${hasMoney ? ' · ' + BR.formatMoney(d.potCents) : ''}</span></h3>${table}${unpaid}</div>`;
      })
      .join('');
    const extra = [];
    if (r.noTime.length) extra.push(`<b>No time:</b> ${r.noTime.map((x) => esc(x.rider) + ' (' + esc(x.horse) + ')').join(', ')}`);
    if (r.scratched.length) extra.push(`<b>Scratched:</b> ${r.scratched.map((x) => esc(x.rider) + ' (' + esc(x.horse) + ')').join(', ')}`);
    if (forPrint) return `<div class="page"><h2>${esc(c.name)}</h2>${head}${divs}${extra.length ? `<p>${extra.join('<br>')}</p>` : ''}</div>`;
    return `<section class="card"><div class="card-head"><h2>${esc(c.name)}</h2>${
      r.waiting.length ? '<span class="pill warn">In progress</span>' : r.runCount ? '<span class="pill good">Complete</span>' : ''
    }</div>${head}${divs}${extra.length ? `<p class="small muted" style="margin-top:10px">${extra.join('<br>')}</p>` : ''}</section>`;
  }

  function riderTotals(all) {
    const map = new Map();
    for (const r of all)
      for (const d of r.divisions)
        for (const x of d.rows) {
          if (!x.payoutCents) continue;
          const k = BR.norm(x.entry.rider);
          if (!map.has(k)) map.set(k, { rider: x.entry.rider, cents: 0, items: [] });
          const t = map.get(k);
          t.cents += x.payoutCents;
          t.items.push(`${r.cls.name} ${d.name} ${placeLabel(x)} on ${x.entry.horse} (${BR.formatMoney(x.payoutCents)})`);
        }
    return Array.from(map.values()).sort((a, b) => a.rider.localeCompare(b.rider));
  }

  function resultsCSV() {
    const e = ev();
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Event', 'Date', 'Class', 'Division', 'Place', 'Rider', 'Horse', 'Raw time', 'Barrels down', 'Final time', 'Payout'].map(q).join(',')];
    for (const r of computeAll()) {
      for (const d of r.divisions)
        for (const x of d.rows)
          lines.push(
            [e.name, e.date, r.cls.name, d.name, x.placed ? placeLabel(x) : '', x.entry.rider, x.entry.horse, BR.formatTime(x.entry.timeMs), x.entry.barrels || 0, BR.formatTime(x.ms), x.payoutCents ? (x.payoutCents / 100).toFixed(2) : '']
              .map(q)
              .join(',')
          );
      for (const x of r.noTime) lines.push([e.name, e.date, r.cls.name, '', 'NT', x.rider, x.horse, '', '', '', ''].map(q).join(','));
      for (const x of r.scratched) lines.push([e.name, e.date, r.cls.name, '', 'Scratch', x.rider, x.horse, '', '', '', ''].map(q).join(','));
    }
    return lines.join('\r\n');
  }

  // ------------------------------------------------------------ menus & dialogs

  function openMenu(anchor, items) {
    const m = $('#menu');
    m.innerHTML = items.map((it, i) => `<button data-mi="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
    m.hidden = false;
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    m.style.top = top + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
    m.onclick = (ev2) => {
      const b = ev2.target.closest('[data-mi]');
      if (!b) return;
      closeMenu();
      items[+b.dataset.mi].run();
    };
    setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true), 0);
  }
  function outsideMenu(e2) {
    if (!$('#menu').contains(e2.target)) closeMenu();
  }
  function closeMenu() {
    $('#menu').hidden = true;
    document.removeEventListener('pointerdown', outsideMenu, true);
  }

  function editEntryDialog(x) {
    const e = ev();
    const dlg = $('#dlg');
    dlg.innerHTML = `<form method="dialog" id="editForm">
      <h2>Edit entry</h2>
      <div class="grid">
        <label class="field wide">Rider<input name="rider" value="${esc(x.rider)}" required list="riderList" autocomplete="off"></label>
        <label class="field wide">Horse<input name="horse" value="${esc(x.horse)}" autocomplete="off"></label>
        <label class="field wide">Class<select name="classId">${e.classes.map((c) => `<option value="${c.id}" ${c.id === x.classId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div class="row-actions"><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="ok">Save</button></div>
    </form>`;
    dlg.showModal();
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const f = $('#editForm', dlg);
      const rider = f.rider.value.trim();
      if (!rider) return;
      x.rider = rider;
      x.horse = f.horse.value.trim();
      if (f.classId.value !== x.classId) {
        const old = classById(x.classId);
        if (old) old.order = old.order.filter((id) => id !== x.id);
        x.classId = f.classId.value;
        const nc = classById(x.classId);
        nc.order.push(x.id);
        x.late = nc.drawn || classStarted(nc);
      }
      save();
      render();
    };
  }

  // ------------------------------------------------------------ actions

  function act(name, el) {
    const e = ev();
    const cls = el.dataset.cls ? classById(el.dataset.cls) : null;
    const entry = el.dataset.id ? entryById(el.dataset.id) : null;
    switch (name) {
      case 'goto':
        ui.tab = el.dataset.tab;
        break;
      case 'add-class': {
        let nm = el.dataset.name;
        if (!nm) {
          nm = prompt('Class name');
          if (!nm || !nm.trim()) return;
          nm = nm.trim();
        }
        const prev = e.classes[e.classes.length - 1];
        const c = newClass(nm, prev);
        e.classes.push(c);
        save();
        render();
        const card = document.querySelector(`[data-class-card="${c.id}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        toast(prev ? `Added ${nm} (settings copied from ${prev.name})` : `Added ${nm}`);
        return;
      }
      case 'class-up':
      case 'class-down': {
        const i = e.classes.indexOf(cls);
        const j = name === 'class-up' ? i - 1 : i + 1;
        if (j < 0 || j >= e.classes.length) return;
        [e.classes[i], e.classes[j]] = [e.classes[j], e.classes[i]];
        break;
      }
      case 'del-class': {
        const n = classEntries(cls).length;
        if (!confirm(`Delete ${cls.name}${n ? ` and its ${n} entries` : ''}?`)) return;
        e.classes = e.classes.filter((c) => c !== cls);
        e.entries = e.entries.filter((x) => x.classId !== cls.id);
        break;
      }
      case 'new-event': {
        const nm = prompt('Event name', 'Jackpot ' + today());
        if (nm == null) return render();
        const ne = newEvent(nm.trim() || undefined);
        S.events.unshift(ne);
        S.currentId = ne.id;
        ui.tab = 'setup';
        break;
      }
      case 'copy-event': {
        const nm = prompt('Name for the new event', e.name.replace(/\s*\d{4}-\d{2}-\d{2}$/, '') + ' ' + today());
        if (nm == null) return;
        const ne = newEvent(nm.trim() || undefined);
        ne.gap = e.gap;
        ne.spaceHorses = e.spaceHorses;
        ne.liveShow = e.liveShow;
        ne.location = e.location;
        ne.classes = e.classes.map((c) => {
          const nc = newClass(c.name, c);
          return nc;
        });
        S.events.unshift(ne);
        S.currentId = ne.id;
        toast('New event created with the same classes');
        break;
      }
      case 'delete-event':
        if (!confirm(`Delete "${e.name}" and all its entries and times? This cannot be undone.`)) return;
        S.events = S.events.filter((x) => x !== e);
        S.currentId = S.events[0] ? S.events[0].id : null;
        break;
      case 'export-event':
        download(`open-barrels-${slug(e.name)}-${e.date || today()}.json`, JSON.stringify({ app: 'open-barrels', version: 1, events: [e] }, null, 2), 'application/json');
        return;
      case 'bulk-add': {
        const text = $('#bulkText').value;
        const classIds = $$('input[name=addClass]:checked').map((i) => i.value);
        if (!classIds.length) return toast('Pick at least one class');
        const pairs = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const parts = l.split(/\t|,|;| - /);
            return [parts[0].trim(), parts.slice(1).join(' ').trim()];
          })
          .filter((p) => p[0]);
        if (!pairs.length) return toast('Nothing to add');
        ui.lastClasses = classIds;
        addEntries(pairs, classIds);
        break;
      }
      case 'edit-entry':
        return editEntryDialog(entry);
      case 'del-entry':
        if (!confirm(`Remove ${entry.rider}${entry.horse ? ' on ' + entry.horse : ''}?`)) return;
        e.entries = e.entries.filter((x) => x !== entry);
        break;
      case 'run-class':
        ui.runClassId = cls.id;
        break;
      case 'shuffle': {
        if (classStarted(cls) && !confirm('Some riders have already run. Shuffle only the riders still waiting?')) return;
        if (cls.drawn && !classStarted(cls) && !confirm(`Reshuffle the ${cls.name} draw?`)) return;
        shuffleClass(cls, true);
        break;
      }
      case 'shuffle-all': {
        if (!confirm('Shuffle every class? Riders who already ran stay in place.')) return;
        const bad = shuffleAll();
        toast(bad ? `Shuffled — ${bad} class${bad === 1 ? '' : 'es'} could not be fully spaced` : 'All classes shuffled');
        break;
      }
      case 'print-draw':
        return printDraw();
      case 'print-results':
        return printHTML(`<h1>${esc(e.name)} — Results</h1><p>${esc(e.date)} ${esc(e.location)}</p>` + computeAll().map((r) => renderClassResult(r, true, true)).join(''));
      case 'export-csv':
        download(`results-${slug(e.name)}-${e.date || today()}.csv`, resultsCSV(), 'text/csv');
        return;
      case 'toggle-all':
        ui.showAll = el.checked;
        break;
      case 'nt':
        entry.status = entry.status === 'nt' ? 'waiting' : 'nt';
        if (entry.status === 'nt') entry.timeMs = null;
        break;
      case 'live-start':
        return startLive();
      case 'live-stop':
        return stopLive();
      case 'live-copy':
        copyText(liveLink(e)).then((ok) => toast(ok ? 'Link copied' : 'Press and hold the link to copy it'));
        return;
      case 'live-share':
        if (navigator.share) navigator.share({ title: e.name + ' — live results', url: liveLink(e) }).catch(() => {});
        else copyText(liveLink(e)).then(() => toast('Link copied'));
        return;
      case 'more':
        return openRowMenu(el, entry);
      default:
        return;
    }
    save();
    render();
  }

  function openRowMenu(anchor, x) {
    const cls = classById(x.classId);
    const items = [
      {
        label: 'Move to end of class',
        run: () => {
          moveEntry(cls, x.id, cls.order.length);
          render();
          toast(`${x.rider} moved to the end`);
        },
      },
      {
        label: 'Move up one',
        run: () => {
          moveEntry(cls, x.id, cls.order.indexOf(x.id) - 1);
          render();
        },
      },
      {
        label: 'Move down one',
        run: () => {
          moveEntry(cls, x.id, cls.order.indexOf(x.id) + 1);
          render();
        },
      },
      {
        label: x.status === 'scratch' ? 'Un-scratch' : 'Scratch (refund)',
        run: () => {
          x.status = x.status === 'scratch' ? 'waiting' : 'scratch';
          if (x.status === 'scratch') x.timeMs = null;
          save();
          render();
        },
      },
    ];
    if (x.status !== 'waiting' && x.status !== 'scratch')
      items.push({
        label: 'Clear time',
        run: () => {
          x.status = 'waiting';
          x.timeMs = null;
          x.barrels = 0;
          save();
          render();
        },
      });
    items.push({ label: 'Edit rider / horse', run: () => editEntryDialog(x) });
    items.push({
      label: 'Remove entry',
      danger: true,
      run: () => {
        if (!confirm(`Remove ${x.rider}${x.horse ? ' on ' + x.horse : ''}?`)) return;
        ev().entries = ev().entries.filter((y) => y !== x);
        save();
        render();
      },
    });
    openMenu(anchor, items);
  }

  function printDraw() {
    const e = ev();
    const pages = e.classes
      .map((c) => {
        const list = classEntries(c);
        return `<div class="page"><h1>${esc(e.name)} — ${esc(c.name)} draw</h1><p>${esc(e.date)} ${esc(e.location)}</p>
        <table><thead><tr><th>#</th><th>Rider</th><th>Horse</th><th class="blank">Time</th><th>Bbl</th></tr></thead><tbody>
        ${list.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.rider)}${x.late ? ' (late)' : ''}</td><td>${esc(x.horse)}</td><td class="blank">${x.status === 'ran' ? BR.formatTime(x.timeMs) : x.status === 'nt' ? 'NT' : x.status === 'scratch' ? 'SCR' : ''}</td><td>${x.barrels || ''}</td></tr>`).join('')}
        </tbody></table></div>`;
      })
      .join('');
    printHTML(pages);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const events = Array.isArray(data.events) ? data.events : data.id && data.classes ? [data] : null;
        if (!events) throw new Error('not a backup');
        let n = 0;
        for (const imported of events) {
          if (!imported || !Array.isArray(imported.classes) || !Array.isArray(imported.entries)) continue;
          const existing = S.events.findIndex((x) => x.id === imported.id);
          if (existing >= 0) {
            if (!confirm(`"${imported.name}" is already on this device. Replace it with the backup?`)) {
              imported.id = uid();
              imported.name += ' (copy)';
              S.events.unshift(imported);
            } else S.events[existing] = imported;
          } else S.events.unshift(imported);
          imported.classes.forEach(BR.normalizeClass);
          S.currentId = imported.id;
          n++;
        }
        save();
        render();
        toast(n ? `Opened ${n} event${n === 1 ? '' : 's'} from backup` : 'No events found in that file');
      } catch (err) {
        toast('That file is not an Open Barrels backup');
      }
    };
    reader.readAsText(file);
  }

  // ------------------------------------------------------------ drag & drop (mouse + touch)

  function startDrag(handle, pe) {
    const row = handle.closest('.run-row');
    const list = row.parentElement;
    const cls = classById(ui.runClassId);
    if (!cls) return;
    pe.preventDefault();
    const rect = row.getBoundingClientRect();
    const offsetY = pe.clientY - rect.top;
    const ph = document.createElement('li');
    ph.className = 'run-row placeholder';
    ph.style.height = rect.height + 'px';
    list.insertBefore(ph, row);
    Object.assign(row.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', zIndex: 1000 });
    row.classList.add('dragging');
    document.body.classList.add('is-dragging');
    try { handle.setPointerCapture(pe.pointerId); } catch (e) { /* ignore */ }
    let y = pe.clientY;
    let raf = null;

    function place() {
      row.style.top = y - offsetY + 'px';
      const others = Array.from(list.children).filter((c) => c !== row && c !== ph);
      let before = null;
      for (const o of others) {
        const r = o.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          before = o;
          break;
        }
      }
      if (before) list.insertBefore(ph, before);
      else list.appendChild(ph);
    }
    function tick() {
      const edge = 70;
      let dy = 0;
      if (y < edge) dy = -Math.ceil((edge - y) / 6);
      else if (y > window.innerHeight - edge) dy = Math.ceil((y - (window.innerHeight - edge)) / 6);
      if (dy) {
        window.scrollBy(0, dy);
        place();
      }
      raf = requestAnimationFrame(tick);
    }
    function move(ev2) {
      y = ev2.clientY;
      place();
    }
    function up() {
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      const ids = Array.from(list.children)
        .map((c) => (c === ph ? row.dataset.id : c === row ? null : c.dataset.id))
        .filter(Boolean);
      document.body.classList.remove('is-dragging');
      const oldIndex = cls.order.indexOf(row.dataset.id);
      const newIndex = ids.indexOf(row.dataset.id);
      if (newIndex !== oldIndex && newIndex >= 0) {
        moveEntry(cls, row.dataset.id, newIndex);
        const x = entryById(row.dataset.id);
        toast(`${x.rider} moved to #${newIndex + 1}`);
      }
      render();
    }
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    raf = requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------ live results link

  // Address of the live results server (see worker/). Organizers can point at
  // their own server in Setup → Live results link → Advanced.
  const DEFAULT_LIVE_SERVER = (window.OB_CONFIG && window.OB_CONFIG.liveServer) || '';
  const liveServer = () => S.liveServer || DEFAULT_LIVE_SERVER;
  const liveState = {}; // per event: { ok, at, viewers, error, sending, lastBody, retry }
  const defaultLiveShow = () => ({ draw: true, times: true, results: 'live' });

  function liveLink(e) {
    if (!e.live) return '';
    const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
    const q = new URLSearchParams({ e: e.live.id });
    if (e.live.server !== DEFAULT_LIVE_SERVER) q.set('s', e.live.server);
    return base + 'live.html#' + q.toString();
  }

  function liveStatusText(e) {
    const st = liveState[e.id] || {};
    if (st.error) return st.error;
    if (st.sending) return 'Sending…';
    if (st.at) {
      const t = new Date(st.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      const v = st.viewers || 0;
      return `Updated ${t} · ${v} watching`;
    }
    return navigator.onLine === false ? 'No signal — will send when it comes back' : 'Waiting to send…';
  }

  function updateLiveStatus() {
    for (const e of S.events) {
      const txt = liveStatusText(e);
      document.querySelectorAll(`[data-live-status="${e.id}"]`).forEach((el) => (el.textContent = txt));
    }
  }

  /** What viewers see. Money (fees, pot, payouts) is never included. */
  function buildLiveSnapshot(e) {
    const show = Object.assign(defaultLiveShow(), e.liveShow);
    const classes = e.classes.map((c) => {
      const list = classEntries(c);
      const res = BR.computeResults(c, list);
      const done = list.length > 0 && list.every((x) => x.status !== 'waiting');
      const started = list.some((x) => x.status !== 'waiting');
      const out = { id: c.id, name: c.name, state: done ? 'done' : started ? 'running' : 'waiting', count: list.length };
      if (show.draw) {
        out.draw = list.map((x) => {
          const d = { rider: x.rider, horse: x.horse, st: x.status };
          if (x.late) d.late = 1;
          if (show.times && x.status === 'ran') {
            d.time = BR.formatTime(BR.finalMs(x, c));
            if (x.barrels) d.bbl = x.barrels;
          }
          return d;
        });
      }
      if (show.results === 'live' || (show.results === 'done' && done)) {
        out.results = res.divisions.map((d) => {
          const div = { name: d.name, places: d.places, rows: [] };
          if (show.times && d.startMs != null) div.start = BR.formatTime(d.startMs);
          div.rows = d.rows
            .filter((r) => r.placed)
            .map((r) => {
              const row = { place: placeLabel(r), rider: r.entry.rider, horse: r.entry.horse };
              if (show.times) row.time = BR.formatTime(r.ms);
              return row;
            });
          return div;
        });
      } else if (show.results === 'done') out.resultsLater = true;
      return out;
    });
    const upNext = [];
    if (show.draw)
      for (const c of e.classes)
        for (const x of classEntries(c))
          if (x.status === 'waiting' && upNext.length < 3) upNext.push({ rider: x.rider, horse: x.horse, cls: c.name });
    return { v: 1, name: e.name, date: e.date, location: e.location, show, classes, upNext };
  }

  let liveTimer = null;
  function queueLivePush(delay) {
    if (!S.events.some((e) => e.live)) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(pushLive, delay == null ? 1200 : delay);
  }

  async function pushLive() {
    for (const e of S.events) {
      if (!e.live) continue;
      const st = (liveState[e.id] = liveState[e.id] || {});
      const body = JSON.stringify(buildLiveSnapshot(e));
      if (body === st.lastBody || st.sending) continue;
      st.sending = true;
      updateLiveStatus();
      try {
        const res = await fetch(`${e.live.server}/api/events/${e.live.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + e.live.adminKey },
          body,
        });
        if (res.status === 403 || res.status === 404) {
          st.error = 'This live link no longer works. Stop it and start a new one.';
          st.lastBody = body;
        } else if (!res.ok) throw new Error('server ' + res.status);
        else {
          const r = await res.json().catch(() => ({}));
          Object.assign(st, { ok: true, at: Date.now(), viewers: r.viewers || 0, error: null, lastBody: body });
        }
      } catch (err) {
        st.error = navigator.onLine === false ? 'No signal — will send when it comes back' : 'Could not reach the live server — retrying';
        clearTimeout(st.retry);
        st.retry = setTimeout(() => queueLivePush(0), 15000);
      } finally {
        st.sending = false;
      }
      // Something may have changed while sending.
      if (body !== JSON.stringify(buildLiveSnapshot(e)) && !st.error) queueLivePush(300);
      updateLiveStatus();
    }
  }
  window.addEventListener('online', () => queueLivePush(0));

  async function startLive() {
    const e = ev();
    const code = (S.organizerCode || ($('#live-code') && $('#live-code').value) || '').trim();
    if (!code) return toast('Enter your organizer code first');
    S.organizerCode = code;
    const server = liveServer();
    const btn = $('[data-action=live-start]');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(server + '/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizerCode: code }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'The live server said no (' + res.status + ')');
      e.live = { id: r.id, adminKey: r.adminKey, server, started: Date.now() };
      e.liveShow = Object.assign(defaultLiveShow(), e.liveShow);
      delete liveState[e.id];
      save();
      render();
      queueLivePush(0);
      toast('Live link is ready — share it!');
    } catch (err) {
      toast(err.message && !/fetch/i.test(err.message) ? err.message : 'Could not reach the live server. Check your signal.');
      if (btn) btn.disabled = false;
    }
  }

  async function stopLive() {
    const e = ev();
    if (!e.live) return;
    if (!confirm('Stop the live link? Anyone watching will see that it has ended, and the link will stop working.')) return;
    try {
      await fetch(`${e.live.server}/api/events/${e.live.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + e.live.adminKey } });
    } catch (err) {
      /* if offline the link simply expires later */
    }
    delete e.live;
    delete liveState[e.id];
    save();
    render();
    toast('Live link stopped');
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      const i = $('#live-url');
      if (i) {
        i.select();
        try {
          return document.execCommand('copy');
        } catch (e2) {
          return false;
        }
      }
      return false;
    }
  }

  function qrSvg(text) {
    if (typeof qrcode !== 'function') return '';
    try {
      const q = qrcode(0, 'M');
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch (err) {
      return '';
    }
  }

  function renderLiveCard(e) {
    const show = Object.assign(defaultLiveShow(), e.liveShow);
    const options = `
      <div class="live-options">
        <label class="check"><input type="checkbox" data-live-show="draw" ${show.draw ? 'checked' : ''}> Show the draw and who's up next</label>
        <label class="check"><input type="checkbox" data-live-show="times" ${show.times ? 'checked' : ''}> Show times</label>
        <label class="field">Placings
          <select data-live-show="results" id="live-results">
            <option value="live" ${show.results === 'live' ? 'selected' : ''}>Show live as riders run</option>
            <option value="done" ${show.results === 'done' ? 'selected' : ''}>Show when each class is finished</option>
            <option value="off" ${show.results === 'off' ? 'selected' : ''}>Don't show placings</option>
          </select></label>
        <p class="muted small">Viewers never see entry fees, the pot or payouts.</p>
      </div>`;
    if (!e.live) {
      return `<section class="card">
        <div class="card-head"><h2>Live results link</h2><span class="pill">Optional</span></div>
        <p>Share a link so families can follow the draw and standings on their phones. They don't need an app or an account.</p>
        ${options}
        <div class="grid" style="margin-top:12px">
          <label class="field">Organizer code<input id="live-code" value="${esc(S.organizerCode || '')}" autocomplete="off" placeholder="from the app's owner"></label>
        </div>
        <div class="row-actions" style="margin-top:12px"><button class="primary" data-action="live-start">Start live link</button></div>
        <details style="margin-top:12px"><summary class="small muted">Advanced: use your own live server</summary>
          <label class="field" style="margin-top:8px">Live server address<input id="live-server" value="${esc(S.liveServer || '')}" placeholder="${esc(DEFAULT_LIVE_SERVER)}" autocomplete="off"></label>
          <p class="muted small">Groups can run their own free copy of the live server. See the project README.</p>
        </details>
      </section>`;
    }
    const link = liveLink(e);
    return `<section class="card live-card">
      <div class="card-head"><h2>Live results link</h2><span class="pill good"><span class="live-dot"></span> On</span></div>
      <div class="live-share">
        <div class="qr" aria-label="QR code for the live link">${qrSvg(link)}</div>
        <div class="live-share-main">
          <label class="field">Share this link<input id="live-url" value="${esc(link)}" readonly></label>
          <div class="row-actions" style="margin-top:8px">
            <button class="primary" data-action="live-share">Share…</button>
            <button data-action="live-copy">Copy link</button>
            <a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Open</a>
          </div>
          <p class="small muted" style="margin-top:8px" data-live-status="${e.id}">${esc(liveStatusText(e))}</p>
        </div>
      </div>
      ${options}
      <div class="row-actions" style="margin-top:12px"><span class="spacer"></span><button class="danger" data-action="live-stop">Stop live link</button></div>
    </section>`;
  }

  // ------------------------------------------------------------ wiring

  document.addEventListener('click', (e2) => {
    const tab = e2.target.closest('.tabs [data-tab]');
    if (tab) {
      ui.tab = tab.dataset.tab;
      saveNow();
      render();
      window.scrollTo(0, 0);
      return;
    }
    const a = e2.target.closest('[data-action]');
    if (a && a.tagName !== 'INPUT') {
      e2.preventDefault();
      act(a.dataset.action, a);
    }
  });

  document.addEventListener('pointerdown', (e2) => {
    const h = e2.target.closest('.drag-handle');
    if (h && (e2.button === 0 || e2.pointerType !== 'mouse')) startDrag(h, e2);
  });

  document.addEventListener('change', (e2) => {
    const t = e2.target;
    const e = ev();
    if (t.id === 'eventSelect') {
      if (t.value === '__new') return act('new-event', t);
      S.currentId = t.value;
      ui.runClassId = null;
      saveNow();
      return render();
    }
    if (t.id === 'importFile') {
      if (t.files[0]) importBackup(t.files[0]);
      t.value = '';
      return;
    }
    if (t.dataset.action === 'toggle-all') return act('toggle-all', t);
    if (t.dataset.liveShow) {
      e.liveShow = Object.assign(defaultLiveShow(), e.liveShow);
      const k = t.dataset.liveShow;
      e.liveShow[k] = t.type === 'checkbox' ? t.checked : t.value;
      save();
      return render();
    }
    if (t.id === 'live-code') {
      S.organizerCode = t.value.trim();
      return save();
    }
    if (t.id === 'live-server') {
      S.liveServer = t.value.trim().replace(/\/+$/, '');
      return save();
    }
    if (t.dataset.ev) {
      const k = t.dataset.ev;
      if (k === 'gap') e.gap = Math.max(0, Math.min(50, parseInt(t.value, 10) || 0));
      else if (k === 'spaceHorses') e.spaceHorses = t.checked;
      else e[k] = t.value;
      save();
      return render();
    }
    if (t.dataset.cls && t.dataset.field) {
      const c = classById(t.dataset.cls);
      const f = t.dataset.field;
      const d = +t.dataset.d;
      if (f === 'name') c.name = t.value.trim() || c.name;
      else if (f === 'divisions') {
        c.divisions = parseInt(t.value, 10);
        c.divPct = null;
      } else if (f === 'places') c.places[d] = parseInt(t.value, 10) || 0;
      else if (f === 'divPct') c.divPct[d] = parseFloat(t.value) || 0;
      else if (f === 'placePct') {
        const nums = t.value
          .split(/[,\s/]+/)
          .map((v) => parseFloat(v.replace('%', '')))
          .filter((v) => isFinite(v) && v >= 0);
        c.placePct[d] = nums;
        c.places[d] = nums.length;
      } else if (f === 'split') c.split = Math.max(0.01, parseFloat(t.value) || 0.5);
      else c[f] = Math.max(0, parseFloat(t.value) || 0);
      BR.normalizeClass(c);
      save();
      return render();
    }
    if (t.dataset.time) {
      const x = entryById(t.dataset.time);
      const v = t.value.trim();
      if (!v) {
        if (x.status === 'ran') {
          x.status = 'waiting';
          x.timeMs = null;
        }
      } else {
        const ms = BR.parseTime(v);
        if (ms == null) {
          toast('Enter a time like 16.234');
          t.value = x.timeMs != null ? BR.formatTime(x.timeMs) : '';
          return;
        }
        x.timeMs = ms;
        x.status = 'ran';
      }
      save();
      // Let focus land on the next field first so render can keep it there.
      return setTimeout(render, 0);
    }
    if (t.dataset.pen) {
      const x = entryById(t.dataset.pen);
      x.barrels = parseInt(t.value, 10) || 0;
      save();
      return render();
    }
  });

  document.addEventListener('keydown', (e2) => {
    const t = e2.target;
    if (e2.key === 'Enter' && t.dataset && t.dataset.time) {
      e2.preventDefault();
      const inputs = $$('.time-in:not([disabled])');
      const i = inputs.indexOf(t);
      const next = inputs.slice(i + 1).find((n) => !n.value) || inputs[i + 1];
      if (next) next.focus();
      else t.blur();
    }
  });

  document.addEventListener('toggle', (e2) => {
    const d = e2.target;
    if (d.dataset && d.dataset.pay) {
      ui.openPay[d.dataset.pay] = d.open;
      const card = d.closest('.class-card');
      if (card) card.classList.toggle('show-pay', d.open || card.classList.contains('has-money'));
    }
  }, true);

  document.addEventListener('input', (e2) => {
    if (e2.target.id === 'add-rider') updateHorseList();
  });

  document.addEventListener('submit', (e2) => {
    if (e2.target.id !== 'addForm') return;
    e2.preventDefault();
    const f = e2.target;
    const rider = f.rider.value.trim();
    const horse = f.horse.value.trim();
    const classIds = $$('input[name=addClass]:checked', f).map((i) => i.value);
    if (!rider) return toast('Enter the rider name');
    if (!classIds.length) return toast('Pick at least one class');
    ui.lastClasses = classIds;
    addEntries([[rider, horse]], classIds);
    render();
    const r = $('#add-rider');
    const h = $('#add-horse');
    h.value = '';
    r.value = rider;
    r.focus();
    r.select(); // type a new name to replace it, or Tab to keep the same rider
  });

  ev();
  render();
  queueLivePush(500);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
