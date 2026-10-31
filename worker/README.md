# Open Barrels live server

A tiny Cloudflare Worker that relays live results from the organizer's device to spectators. It runs on Cloudflare's **free** plan.

- The organizer's app sends only names, horses, times and places. Money never leaves their device.
- Each event is one Durable Object ("room") that pushes updates to viewers over a WebSocket. Pushing to viewers is free; only connections and organizer updates count toward the 100,000 requests/day free allowance.
- **Demo links** need no code so anyone can try it. They end after 24 hours, hold at most 64 KB, show a "Demo" label the app can't remove, and only `DEMO_PER_DAY` (default 50, in `wrangler.jsonc`) can be made per day in total — so demos can't use up the allowance real events need.
- Events are deleted automatically 60 days after their last update, or right away when the organizer taps **Stop live link**.

## Run your own copy

1. Make a free account at <https://dash.cloudflare.com> and open **Workers & Pages** once to pick your `workers.dev` subdomain.
2. From this folder:
   ```
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
3. Set the organizer codes (comma-separated; give each organizer their own so you can remove one later):
   ```
   npx wrangler secret put ORGANIZER_CODES
   ```
4. Point the app at it: either change `liveServer` in `js/config.js` (for your own hosted copy of the app), or enter the address under **Setup → Live results link → Advanced** on each organizer's device.

## Local testing

```
printf 'ORGANIZER_CODES=test-code\nDEMO_PER_DAY=3\n' > .dev.vars
npx wrangler dev
python3 ../tests/test_live.py
python3 ../tests/test_demo.py      # run with a fresh local server (rm -rf .wrangler/state)
```
