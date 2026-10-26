"""Записи по график: кога е активен даден прозорец (вкл. през полунощ)."""

from datetime import datetime, time


def _parse(hhmm: str) -> time:
    hours, minutes = map(int, hhmm.split(":"))
    return time(hours, minutes)


def is_active(schedule: dict, now: datetime) -> bool:
    """Прозорец 23:00–07:00 с ден „понеделник“ значи от понеделник 23:00 до вторник 07:00."""
    if not schedule["enabled"]:
        return False
    start, end = _parse(schedule["start_time"]), _parse(schedule["end_time"])
    days = {int(d) for d in schedule["days"]}
    weekday, current = now.weekday(), now.time()
    if start < end:
        return weekday in days and start <= current < end
    # През полунощ: вечерната част е в избрания ден, сутрешната – в следващия
    return (weekday in days and current >= start) or ((weekday - 1) % 7 in days and current < end)


def active_schedule(schedules: list[dict], now: datetime) -> dict | None:
    return next((s for s in schedules if is_active(s, now)), None)
