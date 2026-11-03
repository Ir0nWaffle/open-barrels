"""Tests demo live links (no organizer code, 24 hours, capped per day).

Needs the live server running locally with DEMO_PER_DAY=3 in worker/.dev.vars:
    cd worker && npx wrangler dev
Then:  python3 tests/test_demo.py
"""
import functools
import http.server
import json
import pathlib
import threading
import time
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
SERVER = "http://127.0.0.1:8787"
UA = {"User-Agent": "Mozilla/5.0 (open-barrels test)", "Content-Type": "application/json"}


def call(method, path, body=None, key=None):
    headers = dict(UA)
    if key:
        headers["Authorization"] = "Bearer " + key
    req = urllib.request.Request(SERVER + path, data=None if body is None else json.dumps(body).encode(), method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    handler.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = browser.new_page()
        admin.on("pageerror", lambda e: errors.append(str(e)))
        admin.on("dialog", lambda d: d.accept())
        admin.goto(base)
        admin.click("text=+ Open")
        admin.click("text=Advanced: use your own live server")
        admin.fill("#live-server", SERVER)
        admin.locator("#live-server").press("Tab")
        admin.click("text=Try a demo link")
        expect(admin.locator("#live-url")).to_be_visible()
        expect(admin.locator(".live-card .pill")).to_contain_text("Demo")
        link = admin.locator("#live-url").input_value()

        viewer = browser.new_page(viewport={"width": 390, "height": 844})
        viewer.on("pageerror", lambda e: errors.append(str(e)))
        viewer.goto(link)
        expect(viewer.locator("h1 .pill")).to_have_text("Demo", timeout=8000)
        expect(viewer.locator(".notice")).to_contain_text("demo")
        browser.close()
    srv.shutdown()

    # The app can't remove the demo label by sending demo: false.
    s, r = call("POST", "/v1/rooms", {"demo": True})
    assert s == 201 and r["demo"] and r["expiresAt"] - time.time() * 1000 > 23 * 3600 * 1000, (s, r)
    s2, _ = call("PUT", f"/v1/rooms/{r['id']}", {"name": "x", "demo": False, "expiresAt": 9e15}, r["adminKey"])
    assert s2 == 200
    _, snap = call("GET", f"/v1/rooms/{r['id']}")
    assert snap["data"]["demo"] is True and snap["data"]["expiresAt"] == r["expiresAt"], snap

    # Demos are too small to be abused for big uploads.
    s3, _ = call("PUT", f"/v1/rooms/{r['id']}", {"name": "x" * 70000}, r["adminKey"])
    assert s3 == 413, s3

    # Cap: 3 per day locally -> the 4th is refused with a friendly message.
    s4, r4 = call("POST", "/v1/rooms", {"demo": True})
    assert s4 == 201, s4
    s5, r5 = call("POST", "/v1/rooms", {"demo": True})
    assert s5 == 429 and "used up" in r5["error"], (s5, r5)

    # Real organizer codes still work when demos are used up.
    s6, r6 = call("POST", "/v1/rooms", {"organizerCode": "test-code"})
    assert s6 == 201 and "demo" not in r6, (s6, r6)

    if errors:
        raise SystemExit("FAIL page errors: " + str(errors))
    print("PASS demo links")


if __name__ == "__main__":
    main()
