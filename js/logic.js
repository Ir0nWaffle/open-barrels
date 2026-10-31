/*
 * Open Barrels — scoring, payout and draw logic.
 * Pure functions with no page code, so they can be tested on their own.
 * Times are kept as whole milliseconds to avoid rounding errors.
 */
(function (root) {
  'use strict';

  const BR = {};

  // Share of the class pot that goes to each division, by number of divisions.
  BR.DEFAULT_DIV_PCT = {
    1: [100],
    2: [60, 40],
    3: [50, 30, 20],
    4: [40, 30, 20, 10],
    5: [35, 25, 20, 12, 8],
  };

  // Share of a division's money that goes to each place, by number of places.
  const PLACE_PCT = {
    1: [100],
    2: [60, 40],
    3: [50, 30, 20],
    4: [40, 30, 20, 10],
    5: [30, 25, 20, 15, 10],
    6: [28, 22, 18, 14, 10, 8],
    7: [25, 20, 16, 13, 11, 8, 7],
    8: [23, 19, 15, 12, 10, 8, 7, 6],
  };

  BR.defaultDivPct = function (divisions) {
    if (BR.DEFAULT_DIV_PCT[divisions]) return BR.DEFAULT_DIV_PCT[divisions].slice();
    return evenDecreasing(divisions);
  };

  BR.defaultPlacePct = function (places) {
    if (places <= 0) return [];
    if (PLACE_PCT[places]) return PLACE_PCT[places].slice();
    return evenDecreasing(places);
  };

  // n, n-1, ... 1 weights scaled to 100 (rounded to 0.5), remainder put on first.
  function evenDecreasing(n) {
    const total = (n * (n + 1)) / 2;
    const out = [];
    for (let i = 0; i < n; i++) out.push(Math.round(((n - i) / total) * 200) / 2);
    const diff = 100 - out.reduce((a, b) => a + b, 0);
    out[0] = Math.round((out[0] + diff) * 10) / 10;
    return out;
  }

  BR.sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);

  /** "16.234" -> 16234 ms. Returns null for blank or invalid input. */
  BR.parseTime = function (str) {
    if (str == null) return null;
    const s = String(str).trim().replace(',', '.');
    if (!s) return null;
    if (!/^\d+(\.\d*)?$|^\.\d+$/.test(s)) return null;
    const n = parseFloat(s);
    if (!isFinite(n) || n <= 0 || n > 999) return null;
    return Math.round(n * 1000);
  };

  BR.formatTime = function (ms) {
    if (ms == null) return '';
    return (ms / 1000).toFixed(3);
  };

  BR.formatMoney = function (cents) {
    const v = (cents || 0) / 100;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  BR.ordinal = function (n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  BR.norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  /** Total time including knocked-barrel penalties, or null if no valid run. */
  BR.finalMs = function (entry, cls) {
    if (entry.status !== 'ran' || entry.timeMs == null) return null;
    const pen = Math.round((cls.penalty == null ? 5 : Number(cls.penalty)) * 1000);
    return entry.timeMs + (entry.barrels || 0) * pen;
  };

  /** Make a class's per-division arrays match its division count. */
  BR.normalizeClass = function (cls) {
    const D = Math.max(1, Math.min(10, parseInt(cls.divisions, 10) || 1));
    cls.divisions = D;
    if (!Array.isArray(cls.places)) cls.places = [];
    const fallbackPlaces = cls.places[0] || 3;
    while (cls.places.length < D) cls.places.push(fallbackPlaces);
    cls.places.length = D;
    cls.places = cls.places.map((p) => Math.max(0, Math.min(50, parseInt(p, 10) || 0)));

    if (!Array.isArray(cls.divPct) || cls.divPct.length !== D) cls.divPct = BR.defaultDivPct(D);

    if (!Array.isArray(cls.placePct)) cls.placePct = [];
    for (let d = 0; d < D; d++) {
      const want = cls.places[d];
      if (!Array.isArray(cls.placePct[d]) || cls.placePct[d].length !== want) {
        cls.placePct[d] = BR.defaultPlacePct(want);
      }
    }
    cls.placePct.length = D;
    return cls;
  };

  /**
   * Work out divisions, places and payouts for one class.
   * Division rule: 1D starts at the fastest time; each later division starts
   * `split` seconds after the one before (e.g. 0.5 split: 2D begins at fastest + 0.500).
   * Tied riders share the combined money for the places they occupy.
   */
  BR.computeResults = function (cls, entries) {
    BR.normalizeClass(cls);
    const D = cls.divisions;
    const splitMs = Math.max(1, Math.round((Number(cls.split) || 0.5) * 1000));

    const runs = [];
    const noTime = [];
    const scratched = [];
    const waiting = [];
    for (const e of entries) {
      if (e.status === 'scratch') scratched.push(e);
      else if (e.status === 'nt') noTime.push(e);
      else {
        const ms = BR.finalMs(e, cls);
        if (ms == null) waiting.push(e);
        else runs.push({ entry: e, ms });
      }
    }
    runs.sort((a, b) => a.ms - b.ms);
    const fastest = runs.length ? runs[0].ms : null;

    // Money, in cents.
    const paidEntries = entries.length - scratched.length;
    const perEntry = Math.max(0, Math.round(((Number(cls.entryFee) || 0) - (Number(cls.officeFee) || 0)) * 100));
    const added = Math.round((Number(cls.addedMoney) || 0) * 100);
    const pot = paidEntries * perEntry + added;

    const divisions = [];
    for (let d = 0; d < D; d++) {
      divisions.push({
        index: d,
        name: d + 1 + 'D',
        startMs: fastest == null ? null : fastest + d * splitMs,
        places: cls.places[d],
        potCents: Math.round((pot * (Number(cls.divPct[d]) || 0)) / 100),
        rows: [],
        paidCents: 0,
      });
    }
    for (const r of runs) {
      const idx = Math.min(D - 1, Math.floor((r.ms - fastest) / splitMs));
      divisions[idx].rows.push(r);
    }

    for (const div of divisions) {
      const pct = cls.placePct[div.index] || [];
      let pos = 0;
      const rows = div.rows;
      let i = 0;
      while (i < rows.length) {
        let j = i;
        while (j + 1 < rows.length && rows[j + 1].ms === rows[i].ms) j++;
        const group = j - i + 1;
        let groupPct = 0;
        for (let p = pos; p < pos + group; p++) if (p < div.places) groupPct += Number(pct[p]) || 0;
        const groupCents = Math.round((div.potCents * groupPct) / 100);
        const each = Math.floor(groupCents / group);
        let extra = groupCents - each * group; // leftover pennies go to the first tied rows
        for (let k = i; k <= j; k++) {
          const row = rows[k];
          row.place = pos + 1;
          row.tied = group > 1;
          row.placed = pos < div.places;
          row.payoutCents = row.placed ? each + (extra-- > 0 ? 1 : 0) : 0;
          div.paidCents += row.payoutCents;
        }
        pos += group;
        i = j + 1;
      }
      div.unpaidCents = div.potCents - div.paidCents;
    }

    return {
      cls,
      fastestMs: fastest,
      splitMs,
      potCents: pot,
      paidEntries,
      divisions,
      noTime,
      scratched,
      waiting,
      runCount: runs.length,
    };
  };

  // ---------------------------------------------------------------- draw

  function makeRng(seed) {
    if (seed == null) return Math.random;
    let s = seed >>> 0 || 1;
    return function () {
      // mulberry32
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  BR.entryKeys = function (item, spaceHorses) {
    const keys = [];
    const r = BR.norm(item.rider);
    const h = BR.norm(item.horse);
    if (r) keys.push('r:' + r);
    if (spaceHorses && h) keys.push('h:' + h);
    return keys;
  };

  /**
   * Measure spacing in a full running order.
   * Only pairs that touch the `from..to` range (the part being drawn) are counted.
   */
  BR.measureSpacing = function (seq, gap, spaceHorses, from, to) {
    if (from == null) from = 0;
    if (to == null) to = seq.length;
    const last = new Map();
    let violations = 0;
    let shortfall = 0;
    let minGap = Infinity;
    const problems = [];
    seq.forEach((item, pos) => {
      for (const k of BR.entryKeys(item, spaceHorses)) {
        if (last.has(k)) {
          const prev = last.get(k);
          const between = pos - prev - 1;
          if ((pos >= from && pos < to) || (prev >= from && prev < to)) {
            minGap = Math.min(minGap, between);
            if (between < gap) {
              violations++;
              shortfall += gap - between;
              problems.push({ key: k, pos, prev, between, item });
            }
          }
        }
        last.set(k, pos);
      }
    });
    return { violations, shortfall, minGap: minGap === Infinity ? null : minGap, problems };
  };

  /**
   * Shuffle a class's running order so the same rider (and optionally the same
   * horse) has at least `gap` other runs between their trips. `prefix` and
   * `suffix` are runs just before/after this class (e.g. the end of the previous
   * class) so a rider moving between classes also gets time.
   * Returns { order: [items], violations, minGap, problems }.
   */
  BR.shuffleDraw = function (items, opts) {
    opts = opts || {};
    const gap = Math.max(0, parseInt(opts.gap, 10) || 0);
    const spaceHorses = opts.spaceHorses !== false;
    const prefix = opts.prefix || [];
    const suffix = opts.suffix || [];
    const rng = makeRng(opts.seed);
    const attempts = opts.attempts || 400;
    const n = items.length;
    if (n === 0) return { order: [], violations: 0, minGap: null, problems: [] };

    const keysOf = items.map((it) => BR.entryKeys(it, spaceHorses));
    const P = prefix.length;

    // First appearance of each key in the suffix (positions after this class).
    const suffixFirst = new Map();
    suffix.forEach((it, j) => {
      for (const k of BR.entryKeys(it, spaceHorses)) if (!suffixFirst.has(k)) suffixFirst.set(k, j);
    });

    function attempt(mode) {
      const last = new Map();
      prefix.forEach((it, i) => {
        for (const k of BR.entryKeys(it, spaceHorses)) last.set(k, i);
      });
      const remaining = new Map();
      keysOf.forEach((ks) => ks.forEach((k) => remaining.set(k, (remaining.get(k) || 0) + 1)));
      let pool = items.map((_, i) => i);
      const out = [];
      for (let i = 0; i < n; i++) {
        const pos = P + i;
        let best = [];
        let bestScore = -Infinity;
        const feasible = [];
        for (const idx of pool) {
          let minDist = Infinity;
          for (const k of keysOf[idx]) {
            if (last.has(k)) minDist = Math.min(minDist, pos - last.get(k) - 1);
            if (suffixFirst.has(k)) minDist = Math.min(minDist, n - i - 1 + suffixFirst.get(k));
          }
          if (minDist >= gap) feasible.push(idx);
          const score = Math.min(minDist, 1e6);
          if (score > bestScore) {
            bestScore = score;
            best = [idx];
          } else if (score === bestScore) best.push(idx);
        }
        let pickFrom;
        if (feasible.length) {
          if (mode === 'tight') {
            // Prefer whoever still has the most runs left, so they don't bunch up at the end.
            let top = -1;
            pickFrom = [];
            for (const idx of feasible) {
              const need = Math.max(0, ...keysOf[idx].map((k) => remaining.get(k) || 0));
              if (need > top) {
                top = need;
                pickFrom = [idx];
              } else if (need === top) pickFrom.push(idx);
            }
          } else pickFrom = feasible;
        } else pickFrom = best;
        const choice = pickFrom[Math.floor(rng() * pickFrom.length)];
        out.push(choice);
        for (const k of keysOf[choice]) {
          last.set(k, pos);
          remaining.set(k, remaining.get(k) - 1);
        }
        pool = pool.filter((x) => x !== choice);
      }
      return out.map((i) => items[i]);
    }

    function score(order) {
      const full = prefix.concat(order, suffix);
      return BR.measureSpacing(full, gap, spaceHorses, P, P + n);
    }

    function better(a, b) {
      if (!b) return true;
      if (a.violations !== b.violations) return a.violations < b.violations;
      if (a.shortfall !== b.shortfall) return a.shortfall < b.shortfall;
      return (a.minGap == null ? Infinity : a.minGap) > (b.minGap == null ? Infinity : b.minGap);
    }

    let best = null;
    let bestOrder = null;
    // Plain random attempts first: the first one that meets the spacing is used,
    // so the draw stays as random as possible.
    for (let a = 0; a < attempts; a++) {
      const order = attempt(a % 4 === 3 ? 'tight' : 'random');
      const s = score(order);
      if (better(s, best)) {
        best = s;
        bestOrder = order;
      }
      if (best.violations === 0) break;
    }
    return { order: bestOrder, violations: best.violations, minGap: best.minGap, problems: best.problems };
  };

  root.BR = BR;
  if (typeof module !== 'undefined') module.exports = BR;
})(typeof window !== 'undefined' ? window : globalThis);
