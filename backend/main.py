"""Шумомер в реално време – бекенд (FastAPI).

Стартиране:
    python backend/main.py           # с истински микрофон
    python backend/main.py --demo    # със симулиран сигнал
"""

import argparse
import asyncio
import csv
import io
import json
import math
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from audio import AudioEngine, sd
from db import Database

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
CONFIG_PATH = ROOT / "config.json"
DB_PATH = ROOT / "noise.db"

SEND_INTERVAL = 0.05        # 20 кадъра в секунда към клиентите
ALARM_RELEASE = 1.0         # колко секунди под прага, за да приключи алармата

# Типичен MEMS микрофон (телефони, лаптопи) има чувствителност около −26 dBFS при
# 94 dB SPL, т.е. 0 dBFS ≈ 120 dB SPL. С този офсет нивата излизат положителни и
# приблизително верни още преди калибриране – като в приложенията за телефон.
DEFAULT_CALIBRATION = 120.0

DEFAULT_CONFIG = {
    "calibration_offset": DEFAULT_CALIBRATION,
    "device": None,
    "alarm_enabled": False,
    "alarm_threshold": 85.0,
    "alarm_duration": 3.0,
}


def load_config() -> dict:
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    return {**DEFAULT_CONFIG, **{k: v for k, v in data.items() if k in DEFAULT_CONFIG}}


def save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


class Alarm:
    """Следи LAF спрямо прага. Събитие започва, след като нивото е над прага
    `alarm_duration` секунди без прекъсване, и свършва след ALARM_RELEASE s под него."""

    def __init__(self):
        self.active = False
        self.event_id: int | None = None
        self.over_since: float | None = None
        self.under_since: float | None = None
        self.max_level = -math.inf

    def message(self) -> dict:
        return {
            "type": "alarm",
            "active": self.active,
            "started_at": self.over_since if self.active else None,
            "max_level": round(self.max_level, 1) if self.active else None,
            "threshold": config["alarm_threshold"],
        }

    def update(self, level: float, now: float) -> dict | None:
        """Връща съобщение за клиентите, ако състоянието се е сменило."""
        threshold = config["alarm_threshold"]
        if not config["alarm_enabled"]:
            return self.finish(now) if self.active else self._clear()

        if level >= threshold:
            self.under_since = None
            if self.over_since is None:
                self.over_since = now
                self.max_level = level
            self.max_level = max(self.max_level, level)
            if not self.active and now - self.over_since >= config["alarm_duration"]:
                self.active = True
                session_id = recording["id"] if recording else None
                self.event_id = db.start_event(session_id, self.over_since, threshold, self.max_level)
                return self.message()
        elif self.active:
            if self.under_since is None:
                self.under_since = now
            elif now - self.under_since >= ALARM_RELEASE:
                return self.finish(now)
        else:
            self.over_since = None
        return None

    def finish(self, now: float) -> dict | None:
        if not self.active:
            return self._clear()
        db.end_event(self.event_id, self.under_since or now, self.max_level)
        self.active = False
        self.event_id = None
        self._clear()
        return self.message()

    def _clear(self) -> None:
        self.over_since = None
        self.under_since = None
        self.max_level = -math.inf


engine: AudioEngine       # създават се в main()
db: Database
config: dict
alarm = Alarm()
recording: dict | None = None   # текущият запис в базата: id, name, started_at
clients: set[WebSocket] = set()


def device_name() -> str | None:
    if engine.demo:
        return "Демо сигнал"
    if sd is None:
        return None
    try:
        return sd.query_devices(config["device"], "input")["name"]
    except Exception:
        return None


def status_message() -> dict:
    return {
        "type": "status",
        "running": engine.running,
        "demo": engine.demo,
        "device": config["device"],
        "calibration_offset": config["calibration_offset"],
        "default_calibration": DEFAULT_CALIBRATION,
        "error": engine.error,
        "recording": recording,
        "alarm": {
            "enabled": config["alarm_enabled"],
            "threshold": config["alarm_threshold"],
            "duration": config["alarm_duration"],
            "active": alarm.active,
            "started_at": alarm.over_since if alarm.active else None,
        },
    }


async def broadcast(message: dict) -> None:
    targets = list(clients)
    if not targets:
        return
    text = json.dumps(message)
    results = await asyncio.gather(*(ws.send_text(text) for ws in targets), return_exceptions=True)
    for ws, result in zip(targets, results):
        if isinstance(result, Exception):
            clients.discard(ws)


def flush_seconds() -> None:
    """Прехвърля готовите едносекундни обобщения в базата (ако има активен запис)."""
    rows = engine.pop_seconds()
    if recording:
        db.add_measurements(recording["id"], rows)


async def broadcaster() -> None:
    loop = asyncio.get_running_loop()
    while True:
        started = loop.time()
        if engine.running:
            flush_seconds()
            change = alarm.update(engine.level("A", "F"), time.time())
            if change:
                await broadcast(change)
            if clients:
                await broadcast(engine.compute_frame())
        await asyncio.sleep(max(0.0, SEND_INTERVAL - (loop.time() - started)))


def start_recording(name: str | None) -> None:
    global recording
    if recording:
        return
    name = (name or "").strip() or f"Запис {datetime.now():%Y-%m-%d %H:%M}"
    session_id = db.create_session(name, config["calibration_offset"], device_name())
    recording = {"id": session_id, "name": name, "started_at": db.get_session(session_id)["started_at"]}


def stop_recording() -> None:
    global recording
    if not recording:
        return
    flush_seconds()
    db.end_session(recording["id"])
    recording = None


def stop_audio() -> None:
    stop_recording()
    alarm.finish(time.time())
    engine.stop()
    engine.pop_seconds()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        engine.start()
    except Exception as exc:
        # Запазеното устройство може вече да го няма – пробваме системното
        if not engine.demo and config["device"] is not None:
            print(f"Устройство {config['device']} не може да се отвори ({exc}), ползвам системното.")
            config["device"] = None
            try:
                engine.start()
            except Exception as exc2:
                print(f"Не може да се стартира записът: {exc2}")
        else:
            print(f"Не може да се стартира записът: {exc}")
    task = asyncio.create_task(broadcaster())
    yield
    task.cancel()
    stop_audio()


app = FastAPI(title="Шумомер", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class DeviceIn(BaseModel):
    index: int | None = None


class CalibrationIn(BaseModel):
    offset: float


class AlarmIn(BaseModel):
    enabled: bool
    threshold: float = Field(ge=-200, le=200)
    duration: float = Field(ge=0, le=3600)


class RecordingIn(BaseModel):
    name: str | None = Field(default=None, max_length=200)


class SessionUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)


# --- страници ---------------------------------------------------------------

@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/sessions")
async def sessions_page():
    # Записите вече са раздел в основната страница; старият адрес води там
    return RedirectResponse("/#records")


# --- измерване --------------------------------------------------------------

@app.get("/api/status")
async def get_status():
    return status_message()


@app.get("/api/devices")
async def get_devices():
    if engine.demo:
        return {"devices": [{"index": -1, "name": "Демо сигнал (симулация)", "hostapi": "", "default": True}]}
    if sd is None:
        return {"devices": []}
    default_in = sd.default.device[0]
    hostapis = sd.query_hostapis()
    devices = [
        {
            "index": i,
            "name": d["name"],
            "hostapi": hostapis[d["hostapi"]]["name"],
            "default": i == default_in,
        }
        for i, d in enumerate(sd.query_devices())
        if d["max_input_channels"] > 0
    ]
    return {"devices": devices}


@app.post("/api/device")
async def set_device(body: DeviceIn):
    if engine.demo:
        raise HTTPException(400, "В демо режим входното устройство не може да се сменя")
    previous = config["device"]
    was_running = engine.running
    flush_seconds()
    engine.stop()
    config["device"] = body.index
    try:
        engine.start()
    except Exception as exc:
        config["device"] = previous
        if was_running:
            try:
                engine.start()
            except Exception:
                pass
        await broadcast(status_message())
        raise HTTPException(400, f"Устройството не може да се отвори: {exc}")
    save_config(config)
    await broadcast(status_message())
    return status_message()


@app.post("/api/calibration")
async def set_calibration(body: CalibrationIn):
    if not math.isfinite(body.offset) or abs(body.offset) > 200:
        raise HTTPException(400, "Офсетът трябва да е число между -200 и 200 dB")
    config["calibration_offset"] = round(body.offset, 2)
    save_config(config)
    await broadcast(status_message())
    return status_message()


@app.post("/api/start")
async def start():
    try:
        engine.start()
    except Exception as exc:
        await broadcast(status_message())
        raise HTTPException(400, f"Записът не може да започне: {exc}")
    await broadcast(status_message())
    return status_message()


@app.post("/api/stop")
async def stop():
    stop_audio()
    await broadcast(status_message())
    await broadcast(alarm.message())
    return status_message()


# --- аларма -----------------------------------------------------------------

@app.post("/api/alarm")
async def set_alarm(body: AlarmIn):
    config["alarm_enabled"] = body.enabled
    config["alarm_threshold"] = round(body.threshold, 1)
    config["alarm_duration"] = round(body.duration, 1)
    save_config(config)
    if not body.enabled:
        alarm.finish(time.time())
        await broadcast(alarm.message())
    await broadcast(status_message())
    return status_message()


@app.get("/api/events")
async def list_events(limit: int = 20):
    return {"events": db.events(limit=max(1, min(limit, 500)))}


# --- записи в базата ----------------------------------------------------------

@app.post("/api/recording/start")
async def recording_start(body: RecordingIn):
    if not engine.running:
        try:
            engine.start()
        except Exception as exc:
            raise HTTPException(400, f"Записът не може да започне: {exc}")
    start_recording(body.name)
    await broadcast(status_message())
    return status_message()


@app.post("/api/recording/stop")
async def recording_stop():
    stop_recording()
    await broadcast(status_message())
    return status_message()


@app.get("/api/sessions")
async def list_sessions():
    sessions = db.list_sessions()
    now = time.time()
    for s in sessions:
        s["active"] = bool(recording and recording["id"] == s["id"])
        s["duration"] = (s["ended_at"] or now) - s["started_at"]
    return {"sessions": sessions}


@app.get("/api/sessions/{session_id}")
async def session_report(session_id: int):
    report = db.report(session_id)
    if report is None:
        raise HTTPException(404, "Няма такъв запис")
    report["active"] = bool(recording and recording["id"] == session_id)
    return report


@app.patch("/api/sessions/{session_id}")
async def update_session(session_id: int, body: SessionUpdateIn):
    name = body.name.strip() if body.name is not None else None
    if name == "":
        raise HTTPException(400, "Името не може да е празно")
    note = body.note.strip() if body.note is not None else None
    if not db.update_session(session_id, name=name, note=note):
        raise HTTPException(404, "Няма такъв запис")
    if name and recording and recording["id"] == session_id:
        recording["name"] = name
        await broadcast(status_message())
    return {"ok": True}


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: int):
    if recording and recording["id"] == session_id:
        raise HTTPException(400, "Първо спри записа")
    if not db.delete_session(session_id):
        raise HTTPException(404, "Няма такъв запис")
    return {"ok": True}


@app.get("/api/sessions/{session_id}/csv")
async def session_csv(session_id: int):
    session = db.get_session(session_id)
    if session is None:
        raise HTTPException(404, "Няма такъв запис")
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["време", "unix_t", "LAeq_1s", "LAFmax", "LAFmin", "LCeq_1s", "LZeq_1s", "LZpeak"])
    for r in db.measurements(session_id):
        writer.writerow([
            datetime.fromtimestamp(r["t"]).isoformat(sep=" ", timespec="seconds"),
            round(r["t"], 3),
            *(round(r[k], 1) for k in ("laeq", "lafmax", "lafmin", "lceq", "lzeq", "lzpeak")),
        ])
    # BOM, за да отвори Excel кирилицата правилно
    return Response(
        "﻿" + out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="noise-session-{session_id}.csv"'},
    )


# --- WebSocket ----------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        await ws.send_text(json.dumps(status_message()))
        await ws.send_text(json.dumps(alarm.message()))
        while True:
            await ws.receive_text()  # клиентът не праща нищо; така разбираме за прекъсване
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


def main() -> None:
    global engine, db, config, CONFIG_PATH
    parser = argparse.ArgumentParser(description="Шумомер в реално време")
    parser.add_argument("--demo", action="store_true", help="симулиран сигнал вместо микрофон")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db", default=str(DB_PATH), help="път до файла на базата (по подразбиране noise.db)")
    parser.add_argument("--config", default=str(CONFIG_PATH), help="път до настройките (по подразбиране config.json)")
    args = parser.parse_args()

    # Конзолата на Windows може да е с кодиране без кирилица (напр. cp1252)
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")

    CONFIG_PATH = Path(args.config)
    config = load_config()
    db = Database(args.db)
    engine = AudioEngine(demo=args.demo, config=config)
    print(f"Шумомер: http://localhost:{args.port}" + ("  (демо режим)" if args.demo else ""))
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
