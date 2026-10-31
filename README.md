# Open Barrels

A free, open-source app for running barrel racing jackpots and shows: take entries, draw the running order, record times, and get divisions, placings and payouts worked out for you. No more doing the math by hand.

It runs in any web browser on a phone, tablet or laptop, keeps working with no signal at the arena, and needs no account or server. Everything is saved on the device you use.

## What it does

- **Classes your way.** Peewee, Youth, Junior, Open, or anything else. Each class has its own number of divisions (1D–6D), split (0.5 s, 1 s, …), knocked-barrel penalty, and **number of places paid in each division** (Peewee can pay 3 per division while Junior pays 5).
- **Entries.** Type a rider and horse and pick one or more classes. Names you've used before are suggested. You can paste a whole list (`Rider, Horse`, one per line).
- **Shuffle the draw.** One tap makes a random running order that keeps a rider's horses apart (default: at least 5 runs between), so they have time to switch horses. It also looks across class boundaries and can space out a horse shared by two riders. If spacing isn't possible (e.g. one rider with 3 horses in a class of 4), it tells you.
- **Late entries** go to the end of the class and are marked *Late*.
- **Missed your turn?** Drag the rider (⠿ handle) to a new spot, or use ⋯ → *Move to end of class*. Works with a mouse or a finger.
- **Timing.** Type each time and press Enter to jump to the next rider. Knocked barrels (+5 s each), NT (no time) and Scratch are one tap. A *Now up / On deck / In the hole* box shows who's next.
- **Results.** Divisions are split from the fastest time (2D starts at fastest + split, and so on). Ties split the money for the places they hold. Optional jackpot money: entry fee, office fee held back, added money, % of pot per division and % per place.
- **Payout by rider** total, for writing checks.
- **Print** the draw sheet or results, **download CSV**, and **back up / move** an event to another device as a file.
- **New event with these classes** copies last week's setup without the riders.
- **Live results link** (optional). Share a link or QR code so families can follow the draw, who's up next, and standings on their phones, with no app or account. The organizer chooses whether to show times, and whether placings appear live or only when a class finishes. Entry fees, the pot and payouts are never sent. Real events need an organizer code from whoever runs the live server (see [`worker/`](worker/README.md)); anyone can press **Try a demo link** for a free 24-hour demo.

## Using it

Open the hosted page (or `index.html`) in a browser. On a phone, use *Add to Home Screen* to get an app icon and offline use.

1. **Setup** – name the event, add classes, set divisions, split and places.
2. **Entries** – add riders and horses.
3. **Run** – press *Shuffle all classes*, then enter times as riders run.
4. **Results** – placings and payouts update live. Print or download when done.

> Data lives in this browser only. Clearing site data deletes it, so use **Setup → Download backup** after each event.

## How the numbers work

| Thing | Rule |
|---|---|
| Final time | clock time + penalty × barrels down |
| Division | 1D = fastest to fastest + split; each next division starts one split later; the last division takes everything slower |
| Pot | (entry fee − office fee) × entries that weren't scratched + added money |
| Division money | pot × that division's % |
| Ties | tied riders share the money for all the places they cover (tie for 2nd with 3 places paid = split 2nd + 3rd) |
| Unfilled places | shown as "not paid out" so the secretary can decide what to do with it |

Default percentages are only starting points—change them to match your association's rules.

## Hosting your own copy

It's plain HTML, CSS and JavaScript with no build step. Put the folder on any static host (GitHub Pages, Netlify, a USB stick). For GitHub Pages: push the repo, then *Settings → Pages → Deploy from branch → main / root*.

## Development

```
python3 -m http.server 8000     # then open http://localhost:8000
```

Code layout:

- `js/logic.js` – times, divisions, payouts and the shuffle (no page code; easy to test)
- `js/app.js` – screens, saving, drag and drop
- `css/style.css` – styles (light and dark)
- `live.html`, `js/live.js` – the read-only page spectators see
- `worker/` – the free Cloudflare live results server
- `sw.js` – offline support

Tests run in a headless browser with Playwright (`pip install playwright && playwright install chromium`):

```
python3 tests/test_logic.py
python3 tests/test_ui.py
python3 tests/test_live.py      # needs the live server running locally, see worker/README.md
```

Contributions welcome—especially from secretaries and producers who know how their associations run things.

## License

MIT — free to use, change and share.
