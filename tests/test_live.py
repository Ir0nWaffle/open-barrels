"""End-to-end test of the live results link: organizer app -> live server -> viewer page.

Needs the live server running locally first:
    cd worker && npx wrangler dev        (with ORGANIZER_CODES=test-code in worker/.dev.vars)
Then:
    python3 tests/test_live.py [--server http://127.0.0.1:8787] [--code CODE] [--shots DIR]
"""
import functools
import http.server
import json
import pathlib
import sys
import threading
import urllib.request

from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
SERVER = "http://127.0.0.1:8787"
if "--server" in sys.argv:
    SERVER = sys.argv[sys.argv.index("--server") + 1]
UA = {"User-Agent": "Mozilla/5.0 (open-barrels test)"}
CODE = "test-code"
if "--code" in sys.argv:
    CODE = sys.argv[sys.argv.index("--code") + 1]
SHOTS = None
if "--shots" in sys.argv:
    SHOTS = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1])
    SHOTS.mkdir(parents=True, exist_ok=True)


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    handler.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    srv = serve()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = browser.new_context(viewport={"width": 1100, "height": 900}).new_page()
        admin.on("pageerror", lambda e: errors.append("admin: " + str(e)))
        admin.on("dialog", lambda d: d.accept())
        admin.goto(base)

        # A class with money, so we can prove money never reaches viewers.
        admin.click("text=+ Junior")
        card = admin.locator("[data-class-card]").first
        card.locator("details.payout summary").click()
        card.locator("[data-field=entryFee]").fill("125")
        card.locator("[data-field=entryFee]").press("Tab")
        admin.click(".tabs [data-tab=entries]")
        admin.click("text=Add many at once")
        admin.fill("#bulkText", "\n".join(f"Rider {i}, Horse {i}" for i in range(8)))
        admin.click("text=Add these entries")
        admin.click(".tabs [data-tab=run]")
        admin.click("text=Shuffle all classes")

        # Start the live link against the local server.
        admin.click(".tabs [data-tab=setup]")
        admin.click("text=Advanced: use your own live server")
        admin.fill("#live-server", SERVER)
        admin.locator("#live-server").press("Tab")
        admin.fill("#live-code", "wrong-code")
        admin.locator("#live-code").press("Tab")
        admin.click("text=Start live link")
        expect(admin.locator("#toast")).to_contain_text("not valid")
        admin.fill("#live-code", CODE)
        admin.locator("#live-code").press("Tab")
        admin.click("text=Start live link")
        expect(admin.locator("#live-url")).to_be_visible()
        link = admin.locator("#live-url").input_value()
        assert "live.html#e=" in link, link
        assert admin.locator(".qr svg").count() == 1
        expect(admin.locator("[data-live-status]")).to_contain_text("watching", timeout=8000)
        if SHOTS:
            admin.screenshot(path=str(SHOTS / "live-admin.png"), full_page=True)

        # Viewer on a phone
        viewer = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True).new_page()
        viewer.on("pageerror", lambda e: errors.append("viewer: " + str(e)))
        viewer.goto(link)
        expect(viewer.locator("#connText")).to_have_text("Live", timeout=8000)
        expect(viewer.locator(".upnext .now .nm")).to_be_visible()
        viewer.click(".seg [data-mode=draw]")
        expect(viewer.locator(".draw-list li")).to_have_count(8)

        # Organizer enters a time -> viewer sees it quickly
        admin.click(".tabs [data-tab=run]")
        expect(admin.locator(".live-strip")).to_be_visible()
        first_rider = admin.locator(".run-row").first.locator(".who b").inner_text()
        t = admin.locator(".time-in").first
        t.fill("15.432")
        t.press("Enter")
        expect(viewer.locator(".draw-list li").first).to_contain_text("15.432", timeout=6000)
        viewer.click(".seg [data-mode=standings]")
        expect(viewer.locator(".res-table")).to_contain_text(first_rider)
        expect(viewer.locator(".res-table")).to_contain_text("1st")
        # Viewer count reported back to the organizer
        expect(admin.locator("[data-live-status]")).to_contain_text("1 watching", timeout=6000)
        if SHOTS:
            viewer.screenshot(path=str(SHOTS / "live-viewer.png"), full_page=True)

        # What the server holds must contain no money at all.
        lid = link.split("e=")[1].split("&")[0]
        raw = urllib.request.urlopen(urllib.request.Request(f"{SERVER}/api/events/{lid}", headers=UA)).read().decode()
        snap = json.loads(raw)["data"]
        keys, values = set(), []

        def walk(o):
            if isinstance(o, dict):
                for k, v in o.items():
                    keys.add(k)
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
            else:
                values.append(str(o))

        walk(snap)
        money_words = ("fee", "pot", "pay", "cents", "money", "added", "adminkey")
        bad_keys = [k for k in keys if any(w in k.lower() for w in money_words)]
        assert not bad_keys, f"public data has money fields: {bad_keys}"
        assert not any("$" in v or v == "125" for v in values), "public data contains a dollar amount"
        print("public fields:", sorted(keys))
        assert snap["classes"][0]["draw"][0]["time"] == "15.432"

        # Hide times -> viewer no longer gets them
        admin.click(".tabs [data-tab=setup]")
        admin.locator("[data-live-show=times]").uncheck()
        expect(viewer.locator(".res-table")).not_to_contain_text("15.432", timeout=6000)
        expect(viewer.locator(".res-table th", has_text="Time")).to_have_count(0)

        # Placings only when the class is finished
        admin.select_option("#live-results", "done")
        expect(viewer.locator("main")).to_contain_text("will be posted when the class is finished", timeout=6000)

        # Stop the link -> viewer told it ended
        admin.click("text=Stop live link")
        expect(viewer.locator("#connText")).to_have_text("Ended", timeout=6000)
        expect(admin.locator("text=Start live link")).to_be_visible()
        gone = urllib.request.Request(f"{SERVER}/api/events/{lid}", headers=UA)
        try:
            urllib.request.urlopen(gone)
            raise AssertionError("event still exists after stop")
        except urllib.error.HTTPError as e:
            assert e.code == 404

        # Bad link
        viewer.goto(base + "live.html")
        expect(viewer.locator("main")).to_contain_text("Ask the organizer")
        browser.close()
    srv.shutdown()
    if errors:
        print("FAIL page errors:", errors)
        sys.exit(1)
    print("PASS live link end-to-end")


if __name__ == "__main__":
    main()
