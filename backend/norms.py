"""Норми и справочни таблици за шум: работно място, околна среда, NR/NC криви.

Имената на зоните и помещенията са в интерфейса (static/i18n.js); тук са само
идентификаторите и числата, за да има един източник на стойностите.
"""

import math

import numpy as np

WORK_DAY = 8 * 3600

# --- Шум на работното място --------------------------------------------------
# Директива 2003/10/ЕО, чл. 3; в България – Наредба № 6 от 2005 г. (МТСП и МЗ).
# Пиковете 135 / 137 / 140 dB(C) отговарят на 112 / 140 / 200 Pa.
WORKPLACE_LIMITS = [
    {"id": "lower", "lex": 80.0, "peak": 135.0},   # долни стойности за действие
    {"id": "upper", "lex": 85.0, "peak": 137.0},   # горни стойности за действие
    {"id": "limit", "lex": 87.0, "peak": 140.0},   # гранични стойности (с антифоните)
]


def lex_8h(laeq: float, seconds: float) -> float:
    """Дневна експозиция LEX,8h = LAeq,Te + 10·lg(Te / 8 h)."""
    return laeq + 10 * math.log10(seconds / WORK_DAY)


def workplace_level(lex: float, peak: float | None) -> str | None:
    """Най-високият минат праг (или None), по LEX,8h или по пика."""
    reached = None
    for limit in WORKPLACE_LIMITS:
        if lex >= limit["lex"] or (peak is not None and peak >= limit["peak"]):
            reached = limit["id"]
    return reached


# --- Шум в околната среда ------------------------------------------------------
# Наредба № 6 от 26.06.2006 г. (ДВ бр. 58/2006, изм. ДВ бр. 100/2021).
# Периоди – чл. 4, ал. 4: ден 7–19 ч, вечер 19–23 ч, нощ 23–7 ч.
ENV_PERIODS = {"day": (7, 19), "evening": (19, 23), "night": (23, 7)}
ENV_PENALTY = {"day": 0.0, "evening": 5.0, "night": 10.0}   # за Lden (Приложение 1)
ENV_HOURS = {"day": 12, "evening": 4, "night": 8}

# Приложение 2, таблица 2 – територии и устройствени зони: (ден, вечер, нощ) dB(A)
ENV_ZONES = {
    "residential": (55, 50, 45),   # жилищни зони и територии
    "central": (60, 55, 50),       # смесени централни градски части
    "road": (60, 55, 50),          # с интензивен автомобилен трафик
    "rail": (65, 60, 55),          # релсов железопътен и трамваен транспорт
    "aviation": (65, 65, 50),      # авиационен шум
    "industrial": (70, 70, 70),    # производствено-складови територии и зони
    "recreation": (45, 40, 35),    # обществен и индивидуален отдих
    "medical": (45, 35, 35),       # лечебни заведения
    "education": (45, 40, 35),     # научноизследователска и учебна дейност
    "quiet": (40, 35, 35),         # тихи зони извън урбанизираните територии
}

# Приложение 2, таблица 1 – проникващ шум в помещения: (ден, вечер, нощ) dB(A).
# При тонален или импулсен шум границите на т. 1–5 се намаляват с 5 dB(A).
INDOOR_ROOMS = {
    "hospital": (30, 30, 30),
    "living": (35, 35, 30),
    "doctor": (40, 40, 35),
    "classroom": (40, 40, 40),
    "office": (50, 50, 50),
    "catering": (55, 55, 55),
    "shop": (60, 60, 60),
}
INDOOR_TONAL_PENALTY_ROOMS = {"hospital", "living", "doctor", "classroom", "office"}
INDOOR_TONAL_PENALTY = 5.0


def env_period(hour: int) -> str:
    if 7 <= hour < 19:
        return "day"
    if 19 <= hour < 23:
        return "evening"
    return "night"


def env_limits(kind: str, zone: str, tonal: bool = False) -> dict:
    """Граничните стойности за зона (kind="zone") или помещение (kind="room")."""
    table = ENV_ZONES if kind == "zone" else INDOOR_ROOMS
    values = table[zone]
    penalty = INDOOR_TONAL_PENALTY if kind == "room" and tonal and zone in INDOOR_TONAL_PENALTY_ROOMS else 0.0
    return {p: v - penalty for p, v in zip(("day", "evening", "night"), values)}


def lden(day: float | None, evening: float | None, night: float | None) -> float | None:
    """Lden = 10·lg((12·10^(Ld/10) + 4·10^((Le+5)/10) + 8·10^((Ln+10)/10)) / 24)."""
    if None in (day, evening, night):
        return None
    total = sum(ENV_HOURS[p] * 10 ** ((v + ENV_PENALTY[p]) / 10)
                for p, v in (("day", day), ("evening", evening), ("night", night)))
    return 10 * math.log10(total / 24)


# --- NR и NC криви -------------------------------------------------------------
# NR (Kosten & van Os, ISO R 1996) – таблица на кривите през 10, 31.5 Hz – 8 kHz.
NR_BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000]
NR_CURVES = {
    0: [55, 36, 22, 12, 5, 0, -4, -6, -8],
    10: [62, 43, 31, 21, 15, 10, 7, 4, 2],
    20: [69, 51, 39, 31, 24, 20, 17, 14, 13],
    30: [76, 59, 48, 40, 34, 30, 27, 25, 23],
    40: [83, 67, 57, 49, 44, 40, 37, 35, 33],
    50: [89, 75, 66, 59, 54, 50, 47, 45, 44],
    60: [96, 83, 74, 68, 63, 60, 57, 55, 54],
    70: [103, 91, 83, 77, 73, 70, 68, 66, 64],
    80: [110, 99, 92, 86, 83, 80, 78, 76, 74],
    90: [117, 107, 100, 96, 93, 90, 88, 86, 85],
    100: [124, 115, 109, 105, 102, 100, 98, 96, 95],
    110: [130, 122, 118, 114, 112, 110, 108, 107, 105],
    120: [137, 130, 126, 124, 122, 120, 118, 117, 116],
    130: [144, 138, 135, 133, 131, 130, 128, 127, 126],
}
# NC (Beranek; ANSI S12.2) – 63 Hz – 8 kHz
NC_BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000]
NC_CURVES = {
    15: [47, 36, 29, 22, 17, 14, 12, 11],
    20: [51, 40, 33, 26, 22, 19, 17, 16],
    25: [54, 44, 37, 31, 27, 24, 22, 21],
    30: [57, 48, 41, 35, 31, 29, 28, 27],
    35: [60, 52, 45, 40, 36, 34, 33, 32],
    40: [64, 56, 50, 45, 41, 39, 38, 37],
    45: [67, 60, 54, 49, 46, 44, 43, 42],
    50: [71, 64, 58, 54, 51, 49, 48, 47],
    55: [74, 67, 62, 58, 56, 54, 53, 52],
    60: [77, 71, 67, 63, 61, 59, 58, 57],
    65: [80, 75, 71, 68, 66, 64, 63, 62],
    70: [83, 79, 75, 72, 71, 70, 69, 68],
}

# Третинооктавите от audio.THIRD_OCTAVE_NOMINAL, групирани по октави (по 3 съседни ленти)
THIRD_OCTAVE_NOMINAL = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
    1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]


def thirds_to_octaves(thirds_db, bands=NR_BANDS) -> list[float]:
    """Енергийна сума на трите третинооктави около всяка октава."""
    thirds = np.asarray(thirds_db, dtype=float)
    out = []
    for f in bands:
        i = THIRD_OCTAVE_NOMINAL.index(f)
        out.append(float(10 * np.log10(np.sum(10 ** (thirds[i - 1:i + 2] / 10)))))
    return out


def _rating(levels: list[float], curves: dict) -> float:
    """Най-високата крива, която спектърът докосва – линейна интерполация между кривите
    във всяка лента и максимум по лентите."""
    numbers = np.array(sorted(curves))
    table = np.array([curves[n] for n in numbers], dtype=float)
    per_band = []
    for j, level in enumerate(levels):
        column = table[:, j]
        # Извън таблицата – линейно продължение по крайните две криви
        if level <= column[0]:
            slope = (numbers[1] - numbers[0]) / (column[1] - column[0])
            per_band.append(numbers[0] + (level - column[0]) * slope)
        elif level >= column[-1]:
            slope = (numbers[-1] - numbers[-2]) / (column[-1] - column[-2])
            per_band.append(numbers[-1] + (level - column[-1]) * slope)
        else:
            per_band.append(float(np.interp(level, column, numbers)))
    return max(per_band)


def nr_rating(octaves_db: list[float]) -> int:
    """NR по октавите 31.5 Hz – 8 kHz; закръгля се нагоре до цяло."""
    return max(0, math.ceil(_rating(octaves_db, NR_CURVES) - 1e-9))


def nc_rating(octaves_db: list[float]) -> int:
    """NC по октавите 63 Hz – 8 kHz; под NC-15 се връща 15."""
    return max(15, math.ceil(_rating(octaves_db, NC_CURVES) - 1e-9))


def all_norms() -> dict:
    """Всички таблици за интерфейса."""
    return {
        "workplace": WORKPLACE_LIMITS,
        "env_zones": {k: list(v) for k, v in ENV_ZONES.items()},
        "indoor_rooms": {k: list(v) for k, v in INDOOR_ROOMS.items()},
        "indoor_tonal_penalty_rooms": sorted(INDOOR_TONAL_PENALTY_ROOMS),
        "env_periods": ENV_PERIODS,
        "nr_bands": NR_BANDS,
        "nr_curves": NR_CURVES,
    }
