"""SQLite база (един файл): записи (сесии), едносекундни измервания и събития от алармата."""

import math
import sqlite3
import threading
import time

import numpy as np

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL,
    started_at         REAL NOT NULL,
    ended_at           REAL,
    calibration_offset REAL NOT NULL,
    device             TEXT,
    note               TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS measurements (
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    t          REAL NOT NULL,
    laeq       REAL NOT NULL,
    lafmax     REAL NOT NULL,
    lafmin     REAL NOT NULL,
    lceq       REAL NOT NULL,
    lzeq       REAL NOT NULL,
    lzpeak     REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_measurements_session ON measurements(session_id, t);

CREATE TABLE IF NOT EXISTS sources (
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    t          REAL NOT NULL,
    category   TEXT NOT NULL,
    score      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_session ON sources(session_id);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    started_at REAL NOT NULL,
    ended_at   REAL,
    threshold  REAL NOT NULL,
    max_level  REAL NOT NULL
);
"""

MEASUREMENT_FIELDS = ("t", "laeq", "lafmax", "lafmin", "lceq", "lzeq", "lzpeak")
REPORT_THRESHOLDS = (60, 70, 80, 85, 90)
MAX_SERIES_POINTS = 1500

# Стандарти за шумова доза: критерий (dB за 8 ч = 100%), обменен коефициент
# (с колко dB повече времето се намалява наполовина) и праг, под който не се брои.
DOSE_STANDARDS = {
    "niosh": {"criterion": 85.0, "exchange": 3.0, "threshold": 80.0},
    "osha": {"criterion": 90.0, "exchange": 5.0, "threshold": 80.0},
}
WORK_DAY = 8 * 3600


class _LeqAggregate:
    """SQL агрегат leq(x): енергийно средно на нива в dB – 10·log10(средно(10^(x/10)))."""

    def __init__(self):
        self.total = 0.0
        self.n = 0

    def step(self, value):
        if value is not None:
            self.total += 10 ** (value / 10)
            self.n += 1

    def finalize(self):
        return 10 * math.log10(self.total / self.n) if self.n else None


def energy_mean(levels: np.ndarray) -> float:
    return float(10 * np.log10(np.mean(10 ** (levels / 10))))


def noise_dose(laeq_seconds: np.ndarray, criterion: float, exchange: float, threshold: float) -> dict:
    """Доза в % от допустимото за работен ден. При ниво L допустимото време е
    8 ч / 2^((L − критерий) / обменен коефициент); всеки ред е 1 секунда."""
    levels = laeq_seconds[laeq_seconds >= threshold]
    allowed = WORK_DAY / 2 ** ((levels - criterion) / exchange)
    dose = float(100 * np.sum(1 / allowed))
    # TWA – постоянното ниво за 8 ч, което би дало същата доза
    twa = criterion + exchange / math.log10(2) * math.log10(dose / 100) if dose > 0 else None
    return {
        "dose": dose,
        "twa": twa,
        "projected": dose * WORK_DAY / len(laeq_seconds),
    }


class Database:
    def __init__(self, path):
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.create_aggregate("leq", 1, _LeqAggregate)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)
        self._migrate()
        self._close_interrupted()

    def _add_column(self, table: str, column: str, declaration: str) -> None:
        columns = {r["name"] for r in self._conn.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")

    def _migrate(self) -> None:
        """Обновява стари бази до текущата схема. Версията се пази в PRAGMA user_version;
        всяка миграция е безопасна и при повторно пускане (новите бази вече имат колоните от SCHEMA)."""
        migrations = [
            lambda: self._add_column("sessions", "note", "TEXT NOT NULL DEFAULT ''"),
        ]
        version = self._conn.execute("PRAGMA user_version").fetchone()[0]
        with self._conn:
            for step in migrations[version:]:
                step()
            self._conn.execute(f"PRAGMA user_version = {len(migrations)}")

    def _close_interrupted(self) -> None:
        """Записи, останали „отворени“ след срив, приключват при последното си измерване."""
        with self._lock, self._conn:
            self._conn.execute(
                """UPDATE sessions SET ended_at = COALESCE(
                       (SELECT MAX(t) FROM measurements WHERE session_id = sessions.id), started_at)
                   WHERE ended_at IS NULL"""
            )
            self._conn.execute(
                "UPDATE events SET ended_at = started_at WHERE ended_at IS NULL"
            )

    # --- записи -------------------------------------------------------------

    def create_session(self, name: str, calibration_offset: float, device: str | None) -> int:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO sessions (name, started_at, calibration_offset, device) VALUES (?, ?, ?, ?)",
                (name, time.time(), calibration_offset, device),
            )
            return cur.lastrowid

    def end_session(self, session_id: int) -> None:
        with self._lock, self._conn:
            self._conn.execute("UPDATE sessions SET ended_at = ? WHERE id = ?", (time.time(), session_id))

    def update_session(self, session_id: int, name: str | None = None, note: str | None = None) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "UPDATE sessions SET name = COALESCE(?, name), note = COALESCE(?, note) WHERE id = ?",
                (name, note, session_id),
            )
            return cur.rowcount > 0

    def delete_session(self, session_id: int) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            return cur.rowcount > 0

    def add_measurements(self, session_id: int, rows: list[dict]) -> None:
        if not rows:
            return
        with self._lock, self._conn:
            self._conn.executemany(
                f"INSERT INTO measurements (session_id, {', '.join(MEASUREMENT_FIELDS)}) "
                f"VALUES (?, {', '.join('?' * len(MEASUREMENT_FIELDS))})",
                [(session_id, *(r[f] for f in MEASUREMENT_FIELDS)) for r in rows],
            )

    def add_sources(self, session_id: int, results: list[dict]) -> None:
        if not results:
            return
        with self._lock, self._conn:
            self._conn.executemany(
                "INSERT INTO sources (session_id, t, category, score) VALUES (?, ?, ?, ?)",
                [(session_id, r["t"], r["category"], r["score"]) for r in results],
            )

    def sources(self, session_id: int) -> list[dict]:
        """Колко време (в разпознавания, ~1 s всяко) е чуван всеки източник."""
        with self._lock:
            rows = self._conn.execute(
                """SELECT category, COUNT(*) AS seconds FROM sources
                   WHERE session_id = ? GROUP BY category ORDER BY seconds DESC""",
                (session_id,),
            ).fetchall()
        total = sum(r["seconds"] for r in rows)
        return [{"category": r["category"], "seconds": r["seconds"], "share": r["seconds"] / total} for r in rows]

    def list_sessions(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                """SELECT s.*, COUNT(m.t) AS seconds, leq(m.laeq) AS laeq, MAX(m.lafmax) AS lafmax
                   FROM sessions s LEFT JOIN measurements m ON m.session_id = s.id
                   GROUP BY s.id ORDER BY s.started_at DESC"""
            ).fetchall()
        return [dict(r) for r in rows]

    def get_session(self, session_id: int) -> dict | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return dict(row) if row else None

    def measurements(self, session_id: int) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(
                f"SELECT {', '.join(MEASUREMENT_FIELDS)} FROM measurements WHERE session_id = ? ORDER BY t",
                (session_id,),
            ).fetchall()

    def report(self, session_id: int) -> dict | None:
        session = self.get_session(session_id)
        if session is None:
            return None
        rows = self.measurements(session_id)
        events = self.events(session_id=session_id)
        end = session["ended_at"] or time.time()
        report = {"session": session, "duration": end - session["started_at"], "events": events,
                  "summary": None, "series": None, "histogram": None, "above": None, "dose": None,
                  "sources": self.sources(session_id)}
        if not rows:
            return report

        data = np.array([tuple(r) for r in rows], dtype=float)
        t, laeq, lafmax, lafmin, lceq, lzeq, lzpeak = data.T
        report["summary"] = {
            "seconds": len(t),
            "laeq": energy_mean(laeq),
            "lafmax": float(lafmax.max()),
            "lafmin": float(lafmin.min()),
            "lceq": energy_mean(lceq),
            "lzeq": energy_mean(lzeq),
            "lzpeak": float(lzpeak.max()),
            # Статистически нива от едносекундните LAeq: L10 е надвишено 10% от времето и т.н.
            "l10": float(np.percentile(laeq, 90)),
            "l50": float(np.percentile(laeq, 50)),
            "l90": float(np.percentile(laeq, 10)),
        }
        report["above"] = [{"threshold": thr, "seconds": int(np.sum(laeq >= thr))} for thr in REPORT_THRESHOLDS]
        report["dose"] = {name: noise_dose(laeq, **std) for name, std in DOSE_STANDARDS.items()}
        loudest = int(np.argmax(lafmax))
        report["summary"]["loudest_at"] = float(t[loudest])

        # Хистограма през 2 dB
        lo = math.floor(laeq.min() / 2) * 2
        hi = math.ceil(laeq.max() / 2) * 2 + 2
        counts, edges = np.histogram(laeq, bins=np.arange(lo, hi + 1, 2))
        report["histogram"] = {"edges": edges.tolist(), "counts": counts.tolist()}

        # За дълги записи групираме точките, за да не пращаме десетки хиляди
        if len(t) > MAX_SERIES_POINTS:
            groups = np.array_split(np.arange(len(t)), MAX_SERIES_POINTS)
            report["series"] = {
                "t": [float(t[g[0]]) for g in groups],
                "laeq": [round(energy_mean(laeq[g]), 1) for g in groups],
                "lafmax": [round(float(lafmax[g].max()), 1) for g in groups],
            }
        else:
            report["series"] = {
                "t": t.tolist(),
                "laeq": np.round(laeq, 1).tolist(),
                "lafmax": np.round(lafmax, 1).tolist(),
            }
        return report

    # --- събития ------------------------------------------------------------

    def start_event(self, session_id: int | None, started_at: float, threshold: float, level: float) -> int:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO events (session_id, started_at, threshold, max_level) VALUES (?, ?, ?, ?)",
                (session_id, started_at, threshold, level),
            )
            return cur.lastrowid

    def end_event(self, event_id: int, ended_at: float, max_level: float) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE events SET ended_at = ?, max_level = ? WHERE id = ?", (ended_at, max_level, event_id)
            )

    def events(self, session_id: int | None = None, limit: int | None = None) -> list[dict]:
        sql = "SELECT * FROM events"
        params: list = []
        if session_id is not None:
            sql += " WHERE session_id = ?"
            params.append(session_id)
        sql += " ORDER BY started_at DESC"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]
