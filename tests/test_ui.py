"""Clicks through the app like a show secretary would.

Run:  python3 tests/test_ui.py [--shots DIR]
Starts its own local web server, so no setup beyond Playwright is needed.
"""
import functools
import http.server
import pathlib
import sys
import threading

from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parent.parent
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


def shot(page, name):
    if SHOTS:
        page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)


def run(width, height, tag, base):
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": width, "height": height}, has_touch=width < 700)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.on("dialog", lambda d: d.accept())
        page.goto(base)

        # Setup: two classes, Junior pays 5 places.
        page.click("text=+ Peewee")
        page.click("text=+ Junior")
        junior = page.locator("[data-class-card]").nth(1)
        junior.locator("[data-field=places][data-d='0']").fill("5")
        junior.locator("[data-field=places][data-d='0']").press("Tab")
        junior = page.locator("[data-class-card]").nth(1)
        assert junior.locator("[data-field=placePct][data-d='0']").input_value() == "30, 25, 20, 15, 10"
        junior.locator("details.payout summary").click()
        junior.locator("[data-field=officeFee]").fill("0")
        junior.locator("[data-field=officeFee]").press("Tab")
        junior = page.locator("[data-class-card]").nth(1)
        junior.locator("[data-field=entryFee]").fill("25")
        junior.locator("[data-field=entryFee]").press("Tab")
        shot(page, f"{tag}-1-setup")

        # Entries
        page.click(".tabs [data-tab=entries]")
        bulk_junior = "\n".join([f"Rider {i}, Horse {i}" for i in range(16)] + ["Kaylee, Blue", "Kaylee, Red", "Kaylee, Dash"])
        page.locator("#addClasses label", has_text="Peewee").click()  # off
        page.locator("#addClasses label", has_text="Junior").click()  # on
        page.click("text=Add many at once")
        page.fill("#bulkText", bulk_junior)
        page.click("text=Add these entries")
        page.locator("#addClasses label", has_text="Junior").click()  # off
        page.locator("#addClasses label", has_text="Peewee").click()  # on
        for r, h in [("Lily", "Pony"), ("Kaylee", "Blue"), ("Sam", "Tater")]:
            page.fill("#add-rider", r)
            page.fill("#add-horse", h)
            page.click("text=Add entry")
        assert page.locator(".entry-list li").count() == 22
        shot(page, f"{tag}-2-entries")

        # Run: shuffle all
        page.click(".tabs [data-tab=run]")
        page.click("text=Shuffle all classes")
        page.click("[data-action=run-class]:has-text('Junior')")
        expect(page.locator(".notice")).to_contain_text("at least 5 runs")
        order = page.locator(".run-row .who b").all_inner_texts()
        ks = [i for i, n in enumerate(order) if n == "Kaylee"]
        assert all(b - a > 5 for a, b in zip(ks, ks[1:])), ks

        # Enter times with Enter-to-advance
        first = page.locator(".time-in").first
        first.fill("16.250")
        first.press("Enter")
        focused = page.evaluate("document.activeElement.dataset.time")
        second_id = page.locator(".run-row").nth(1).get_attribute("data-id")
        assert focused == second_id, (focused, second_id)
        page.keyboard.type("15.900")
        page.keyboard.press("Enter")
        page.keyboard.type("16.420")
        page.keyboard.press("Enter")
        page.wait_for_timeout(50)
        expect(page.locator(".run-row").nth(2).locator(".time-in")).to_have_value("16.420")

        # Rider 4 missed their turn -> move to end via menu
        missed = page.locator(".run-row").nth(3)
        missed_id = missed.get_attribute("data-id")
        missed.locator(".more-btn").click()
        page.click("#menu >> text=Move to end of class")
        assert page.locator(".run-row").last.get_attribute("data-id") == missed_id

        # Drag row 8 up to position 5 using the handle
        moving = page.locator(".run-row").nth(7)
        moving_id = moving.get_attribute("data-id")
        page.locator(".run-row").nth(4).evaluate("el => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 70)")
        handle = moving.locator(".drag-handle")
        hb = handle.bounding_box()
        tb = page.locator(".run-row").nth(4).bounding_box()
        assert hb["y"] < page.viewport_size["height"] and tb["y"] > 0, (hb, tb)
        page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
        page.mouse.down()
        steps = 20
        for s in range(1, steps + 1):
            y = hb["y"] + (tb["y"] + 5 - hb["y"]) * s / steps
            page.mouse.move(hb["x"] + 5, y)
            page.wait_for_timeout(10)
        page.mouse.up()
        page.wait_for_timeout(50)
        ids = [el.get_attribute("data-id") for el in page.locator(".run-row").all()]
        assert ids.index(moving_id) == 4, ids.index(moving_id)
        assert ids[-1] == missed_id
        expect(page.locator(".run-row").nth(4)).to_contain_text("Moved")

        # Knocked barrel + NT
        row = page.locator(".run-row").nth(3)
        row.locator(".time-in").fill("15.100")
        row.locator(".time-in").press("Tab")
        page.locator(".run-row").nth(3).locator(".pen-in").select_option("1")
        page.locator(".run-row").nth(4).locator(".nt-btn").click()
        expect(page.locator(".upnext .now .nm")).to_be_visible()
        shot(page, f"{tag}-3-run")

        # Late entry goes to the end and is flagged
        page.click("text=+ Add late entry")
        page.locator("#addClasses label", has_text="Peewee").click()  # off
        page.locator("#addClasses label", has_text="Junior").click()  # on
        page.fill("#add-rider", "Late Larry")
        page.fill("#add-horse", "Slowpoke")
        page.click("text=Add entry")
        page.click(".tabs [data-tab=run]")
        expect(page.locator(".run-row").last).to_contain_text("Late Larry")
        expect(page.locator(".run-row").last).to_contain_text("Late")

        # Fill the rest of the times
        for i in range(page.locator(".run-row").count()):
            inp = page.locator(".run-row").nth(i).locator(".time-in")
            if inp.is_enabled() and not inp.input_value() and "NT" not in (inp.get_attribute("placeholder") or ""):
                inp.fill(f"{15.5 + i * 0.13:.3f}")
                inp.press("Tab")
        page.wait_for_timeout(50)

        # Results
        page.click(".tabs [data-tab=results]")
        junior_res = page.locator("section.card", has=page.locator("h2", has_text="Junior"))
        expect(junior_res).to_contain_text("Pot $500.00")  # 20 entries * $25
        expect(junior_res).to_contain_text("1st")
        expect(junior_res).to_contain_text("1D from 15.900 · pays 5 places")
        expect(page.locator("text=Payout by rider")).to_be_visible()
        shot(page, f"{tag}-4-results")

        # Reload: data persisted
        page.reload()
        page.click(".tabs [data-tab=results]")
        expect(page.locator("section.card", has=page.locator("h2", has_text="Junior"))).to_contain_text("Pot $500.00")

        # Backup download works
        with page.expect_download() as dl:
            page.click(".tabs [data-tab=setup]")
            page.click("text=Download backup")
        assert dl.value.suggested_filename.endswith(".json")

        # New event with the same classes & riders: entries carried over, no times, fresh draw
        page.click("text=New event with these classes & riders")
        page.click(".tabs [data-tab=entries]")
        assert page.locator(".entry-list li").count() == 23  # 22 + Late Larry
        page.click(".tabs [data-tab=run]")
        expect(page.locator("text=Shuffle all classes")).to_be_visible()
        page.click("[data-action=run-class]:has-text('Junior')")
        assert all(not page.locator(".time-in").nth(i).input_value() for i in range(page.locator(".time-in").count()))
        expect(page.locator(".run-row", has_text="Late Larry")).not_to_contain_text("Late entry")
        shot(page, f"{tag}-5-copied")

        browser.close()
    return errors


def main():
    srv = serve()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    ok = True
    for w, h, tag in [(1200, 900, "desktop"), (390, 844, "phone")]:
        try:
            errs = run(w, h, tag, base)
            if errs:
                ok = False
                print(f"FAIL {tag}: page errors: {errs}")
            else:
                print(f"PASS {tag}")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"FAIL {tag}: {type(e).__name__}: {e}")
    srv.shutdown()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
