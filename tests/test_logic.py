"""Checks the scoring, payout and shuffle logic in a real browser.

Run:  python3 tests/test_logic.py      (needs: pip install playwright && playwright install chromium)
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOGIC = (ROOT / "js" / "logic.js").read_text()

TESTS = r"""
const out = [];
const ok = (cond, name, extra) => out.push({ ok: !!cond, name, extra: extra === undefined ? '' : JSON.stringify(extra) });

// --- time parsing
ok(BR.parseTime('16.234') === 16234, 'parse 16.234');
ok(BR.parseTime('16,5') === 16500, 'parse comma decimal');
ok(BR.parseTime('') === null && BR.parseTime('abc') === null && BR.parseTime('-3') === null, 'reject bad times');

// --- divisions on a 0.5 split
const cls = BR.normalizeClass({ divisions: 4, split: 0.5, penalty: 5, places: [3, 3, 3, 3], entryFee: 30, officeFee: 5, addedMoney: 100 });
const mk = (rider, t, extra) => Object.assign({ id: rider, rider, horse: 'H-' + rider, status: 'ran', timeMs: Math.round(t * 1000), barrels: 0 }, extra || {});
const entries = [
  mk('A', 15.000), mk('B', 15.499), mk('C', 15.500), mk('D', 15.999), mk('E', 16.000),
  mk('F', 16.600), mk('G', 14.100, { barrels: 1 }), mk('H', 0, { status: 'nt', timeMs: null }),
  mk('I', 0, { status: 'scratch', timeMs: null }),
];
const r = BR.computeResults(cls, entries);
const divOf = (id) => r.divisions.findIndex((d) => d.rows.some((x) => x.entry.id === id));
ok(r.fastestMs === 15000, 'fastest time', r.fastestMs);
ok(divOf('A') === 0 && divOf('B') === 0, '1D = fastest to +0.499');
ok(divOf('C') === 1 && divOf('D') === 1, '2D starts at fastest +0.500');
ok(divOf('E') === 2, '3D starts at +1.000');
ok(divOf('F') === 3, '4D starts at +1.500');
ok(divOf('G') === 3, 'knocked barrel adds 5s (14.1 -> 19.1 = 4D)');
ok(r.noTime.length === 1 && r.scratched.length === 1, 'NT and scratch counted');
// Pot: 8 paid entries (scratch refunded) * $25 + $100 = $300
ok(r.potCents === 30000, 'pot', r.potCents);
ok(r.divisions[0].potCents === 12000, '1D gets 40% of pot', r.divisions[0].potCents);
const a = r.divisions[0].rows[0];
ok(a.place === 1 && a.payoutCents === 6000, '1D winner gets 50% of 1D money', a);

// --- ties split the combined money of the places they hold
const cls2 = BR.normalizeClass({ divisions: 1, split: 0.5, places: [3], entryFee: 10, officeFee: 0, addedMoney: 0 });
const tie = BR.computeResults(cls2, [mk('A', 15), mk('B', 15.2), mk('C', 15.2), mk('D', 15.3), mk('E', 15.9), mk('F', 15.95), mk('G', 16), mk('H', 16), mk('I', 16), mk('J', 16)]);
const rows = tie.divisions[0].rows;
// pot $100: 1st 50, 2nd 30, 3rd 20. B & C tie for 2nd -> share 2nd+3rd = $50 -> $25 each. D is 4th, unpaid.
ok(rows[1].payoutCents === 2500 && rows[2].payoutCents === 2500 && rows[1].tied, 'tie for 2nd splits 2nd+3rd', rows.slice(1, 3).map((x) => x.payoutCents));
ok(rows[3].place === 4 && rows[3].payoutCents === 0, 'next rider after tie is 4th and unpaid');
ok(tie.divisions[0].paidCents === 10000, 'all money paid');

// --- each division can pay a different number of places
const cls3 = BR.normalizeClass({ divisions: 2, split: 0.5, places: [5, 2] });
ok(cls3.placePct[0].length === 5 && cls3.placePct[1].length === 2, 'per-division places');
ok(Math.abs(BR.sum(BR.defaultPlacePct(12)) - 100) < 0.01, 'default % sums to 100 for 12 places', BR.defaultPlacePct(12));

// --- shuffle spacing
function check(items, gap, opts) {
  const res = BR.shuffleDraw(items, Object.assign({ gap, seed: 7 }, opts || {}));
  const m = BR.measureSpacing(res.order, gap, true);
  return { res, m };
}
const field = [];
for (let i = 0; i < 20; i++) field.push({ id: 's' + i, rider: 'Solo ' + i, horse: 'Horse ' + i });
field.push({ id: 'k1', rider: 'Kaylee', horse: 'Blue' }, { id: 'k2', rider: 'Kaylee', horse: 'Red' }, { id: 'k3', rider: 'Kaylee', horse: 'Dash' });
field.push({ id: 'j1', rider: 'Jess', horse: 'Pepper' }, { id: 'j2', rider: 'Jess', horse: 'Salt' });
field.push({ id: 'm1', rider: 'Mia', horse: 'Horse 3' }); // shares a horse with Solo 3
const c1 = check(field, 5);
ok(c1.res.order.length === field.length && new Set(c1.res.order.map((x) => x.id)).size === field.length, 'shuffle keeps every entry once');
ok(c1.m.violations === 0 && c1.res.violations === 0, 'shuffle spaces riders >= 5 apart', c1.m.problems.map((p) => [p.item.rider, p.between]));

// Impossible case: one rider with 3 horses in a class of 4 -> best effort, reports it.
const tight = [{ id: 1, rider: 'X', horse: 'a' }, { id: 2, rider: 'X', horse: 'b' }, { id: 3, rider: 'X', horse: 'c' }, { id: 4, rider: 'Y', horse: 'd' }];
const c2 = check(tight, 5);
ok(c2.res.violations > 0 && c2.res.order.length === 4, 'impossible spacing reported, not crashed');

// Spacing across a class boundary: rider at end of previous class shouldn't open the next one.
const prefix = [{ id: 'p1', rider: 'Other', horse: 'o' }, { id: 'p2', rider: 'Kaylee', horse: 'Old' }];
const next = [];
for (let i = 0; i < 10; i++) next.push({ id: 'n' + i, rider: 'N' + i, horse: 'nh' + i });
next.push({ id: 'nk', rider: 'Kaylee', horse: 'Blue' });
let firstOk = true;
for (let seed = 1; seed < 40; seed++) {
  const res = BR.shuffleDraw(next, { gap: 4, prefix, seed });
  const pos = res.order.findIndex((x) => x.id === 'nk');
  if (pos < 4) firstOk = false;
}
ok(firstOk, 'rider finishing previous class gets >= 4 runs before next class ride');

// Randomness: different seeds give different orders.
const o1 = BR.shuffleDraw(field, { gap: 5, seed: 1 }).order.map((x) => x.id).join();
const o2 = BR.shuffleDraw(field, { gap: 5, seed: 2 }).order.map((x) => x.id).join();
ok(o1 !== o2, 'shuffle is random');

// Fairness: multi-horse riders aren't always stuck at the front.
let firstSlotsK = 0;
for (let seed = 1; seed <= 200; seed++) {
  const ord = BR.shuffleDraw(field, { gap: 5, seed }).order;
  if (ord[0].rider === 'Kaylee') firstSlotsK++;
}
ok(firstSlotsK < 60, 'multi-horse rider not always drawn first', firstSlotsK);
return out;
"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.add_script_tag(content=LOGIC)
        results = page.evaluate("() => { " + TESTS + " }")
        browser.close()
    failed = 0
    for t in results:
        mark = "PASS" if t["ok"] else "FAIL"
        if not t["ok"]:
            failed += 1
        print(f"{mark}  {t['name']}" + (f"   {t['extra']}" if not t["ok"] and t["extra"] else ""))
    print(f"\n{len(results) - failed}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
