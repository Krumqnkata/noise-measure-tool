"""Прави снимките за README: пуска сървъра в демо режим с временни настройки и база,
отваря страницата в Chrome чрез Playwright и снима всеки раздел + анимация на уреда.

    pip install -r requirements-dev.txt
    python scripts/screenshots.py

Не пипа твоите config.json и noise.db. Снимките отиват в docs/screenshots/.
"""

import io
import json
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "screenshots"
DESKTOP = {"width": 1440, "height": 900}
PHONE = {"width": 390, "height": 844}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def api(base: str, path: str, body: dict | None = None, method: str | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method or ("POST" if body is not None else "GET"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


def wait_for_server(base: str, timeout: float = 20) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            api(base, "/api/status")
            return
        except OSError:
            time.sleep(0.3)
    raise RuntimeError("Сървърът не тръгна")


def new_page(browser, theme: str, lang: str, **options):
    """Страница с фиксирани тема и език (иначе зависят от системата на този, който снима)."""
    page = browser.new_page(service_workers="block", **options)
    page.add_init_script(f"localStorage.setItem('theme', '\"{theme}\"'); localStorage.setItem('lang', '\"{lang}\"');")
    return page


def show(page, section: str, wait: float = 2.0) -> None:
    page.evaluate(f"location.hash = '#{section}'")
    page.wait_for_timeout(wait * 1000)


def seed_history(db_path: Path, days: int = 21) -> None:
    """Три седмици минутни нива (тихи нощи, шумни вечери, трафик сутрин в делник) –
    за таблото и прогнозата. Записва се направо в базата, преди сървърът да тръгне."""
    sys.path.insert(0, str(ROOT / "backend"))
    from db import Database

    rng = np.random.default_rng(7)
    db = Database(db_path)
    end = time.time() - 3600
    start = end - days * 86400
    sid = db.create_session("Балкон: 3 седмици наблюдение", 120.0, "демо")
    rows, sources = [], []
    for t in np.arange(start, end, 60.0):
        lt = time.localtime(t)
        h = lt.tm_hour + lt.tm_min / 60
        weekday = lt.tm_wday < 5
        base = (33 + 16 * (7 <= h < 22) + 12 * np.exp(-((h - 8.5) / 1.5) ** 2) * weekday
                + 9 * np.exp(-((h - 20.5) / 1.8) ** 2))
        laeq = float(base + rng.normal(0, 2.5))
        rows.append({"t": float(t), "laeq": laeq, "lafmax": laeq + 8, "lafmin": laeq - 5, "lceq": laeq + 6,
                     "lzeq": laeq + 9, "lzpeak": laeq + 25, "laimax": laeq + 10, "lcpeak": laeq + 22})
        category = ("silence" if laeq < 38 else "traffic" if 7 <= h < 10 or (weekday and 16 <= h < 19)
                    else "people" if h >= 19 else "household")
        sources.append({"t": float(t), "category": category, "score": 0.6})
    db.add_measurements(sid, rows)
    db.add_sources(sid, sources)
    with db._conn:
        db._conn.execute("UPDATE sessions SET started_at = ?, ended_at = ? WHERE id = ?", (start, end, sid))
    db._conn.close()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for old in ("dose.png", "alarm.png", "phone-analysis.png", "light-en-records.png"):   # от по-стари версии
        (OUT / old).unlink(missing_ok=True)
    port = free_port()
    base = f"http://127.0.0.1:{port}"

    # На Windows базата може да е заключена още миг след спирането на сървъра
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        config = Path(tmp) / "config.json"
        # Алармата на 80 dB, за да има събития (и клипове) в отчета
        config.write_text(json.dumps({"alarm_enabled": True, "alarm_threshold": 80, "alarm_duration": 0.3}))
        seed_history(Path(tmp) / "noise.db")
        server = subprocess.Popen(
            [sys.executable, str(ROOT / "backend" / "main.py"), "--demo", "--port", str(port),
             "--db", str(Path(tmp) / "noise.db"), "--config", str(config)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            wait_for_server(base)
            while api(base, "/api/status")["classifier"]["state"] in ("starting", "downloading"):
                time.sleep(0.5)
            ml_ready = api(base, "/api/status")["classifier"]["state"] == "ready"
            session_id = api(base, "/api/recording/start", {"name": "Демо: стая през деня"})["recording"]["id"]
            if ml_ready:
                print("Свой звук и профил за аномалии…")
                sound = api(base, "/api/custom-sounds", {"name": "Прахосмукачка", "icon": "🧹", "alert": False})["sounds"][-1]
                for _ in range(3):
                    api(base, f"/api/custom-sounds/{sound['id']}/examples", {"seconds": 4})
                api(base, "/api/anomaly/learn", {"name": "Стаята през деня", "minutes": 0.5})

            with sync_playwright() as p:
                browser = p.chromium.launch(channel="chrome")
                page = new_page(browser, theme="dark", lang="bg", viewport=DESKTOP, device_scale_factor=1)
                page.goto(base + "/#meter")
                print("Събирам данни (35 s)…")
                page.wait_for_timeout(35_000)
                page.screenshot(path=OUT / "meter.png")

                # Анимация: само уредът и показанията до него
                print("Анимация на уреда…")
                gauge = page.locator("section[data-section=meter] .grid.items-center").first
                frames = []
                for _ in range(48):
                    frames.append(Image.open(io.BytesIO(gauge.screenshot())).convert("RGB"))
                    page.wait_for_timeout(90)
                w = 760
                frames = [f.resize((w, round(f.height * w / f.width)), Image.LANCZOS) for f in frames]
                frames = [f.quantize(colors=128, method=Image.Quantize.MEDIANCUT) for f in frames]
                frames[0].save(OUT / "meter.gif", save_all=True, append_images=frames[1:],
                               duration=120, loop=0, optimize=True)

                show(page, "analysis", 0.5)
                page.check("#spec-hold")
                page.wait_for_timeout(4000)
                page.screenshot(path=OUT / "analysis.png")
                show(page, "norms")
                page.screenshot(path=OUT / "norms.png", full_page=True)
                print("RT60…")
                show(page, "room", 1)
                page.click("#rt-start")
                page.wait_for_function("document.getElementById('rt-value').textContent !== '--'", timeout=30_000)
                page.wait_for_timeout(500)
                page.screenshot(path=OUT / "room.png", full_page=True)
                show(page, "sounds", 4)
                page.screenshot(path=OUT / "sounds.png", full_page=True)
                show(page, "settings")
                page.screenshot(path=OUT / "settings.png")

                api(base, "/api/recording/stop", {})
                api(base, f"/api/sessions/{session_id}",
                    {"note": "Демо запис: разговор, прахосмукачка и няколко силни удара."}, "PATCH")
                show(page, f"records/{session_id}", 3)
                page.screenshot(path=OUT / "records.png", full_page=True)
                show(page, "records/dashboard", 3)
                page.screenshot(path=OUT / "dashboard.png", full_page=True)

                report = new_page(browser, theme="light", lang="bg", viewport={"width": 900, "height": 1270},
                                  device_scale_factor=1)
                report.goto(f"{base}/report/{session_id}")
                report.wait_for_timeout(3000)
                report.screenshot(path=OUT / "report.png")

                phone = new_page(browser, theme="dark", lang="bg", viewport=PHONE, device_scale_factor=2,
                                 is_mobile=True, has_touch=True)
                phone.goto(base + "/#meter")
                phone.wait_for_timeout(6000)
                phone.screenshot(path=OUT / "phone-meter.png")
                show(phone, "norms", 3)
                phone.screenshot(path=OUT / "phone-norms.png")

                # Светла тема на английски
                print("Светла тема, английски…")
                light = new_page(browser, theme="light", lang="en", viewport=DESKTOP, device_scale_factor=1)
                light.goto(base + "/#meter")
                light.wait_for_timeout(12_000)
                light.screenshot(path=OUT / "light-en-meter.png")
                show(light, "analysis", 4)
                light.screenshot(path=OUT / "light-en-analysis.png")
                show(light, "sounds", 3)
                light.screenshot(path=OUT / "light-en-sounds.png", full_page=True)
                browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)

    for f in sorted(OUT.iterdir()):
        print(f"{f.relative_to(ROOT)}  {f.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
