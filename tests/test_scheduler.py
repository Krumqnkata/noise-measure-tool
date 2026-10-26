from datetime import datetime

import numpy as np
import pytest

from db import sleep_analysis
from scheduler import active_schedule, is_active

NIGHTS = {"id": 1, "name": "Нощ", "days": "0123456", "start_time": "23:00", "end_time": "07:00", "enabled": 1}
WORK = {"id": 2, "name": "Работа", "days": "01234", "start_time": "09:00", "end_time": "17:30", "enabled": 1}


@pytest.mark.parametrize("when, expected", [
    (datetime(2026, 10, 26, 22, 59), False),
    (datetime(2026, 10, 26, 23, 0), True),
    (datetime(2026, 10, 27, 3, 0), True),
    (datetime(2026, 10, 27, 6, 59), True),
    (datetime(2026, 10, 27, 7, 0), False),
])
def test_overnight_window(when, expected):
    assert is_active(NIGHTS, when) is expected


def test_overnight_window_morning_belongs_to_previous_day():
    only_friday = {**NIGHTS, "days": "4"}                        # петък 23:00 – събота 07:00
    assert is_active(only_friday, datetime(2026, 10, 31, 5, 0))   # събота сутрин
    assert not is_active(only_friday, datetime(2026, 10, 30, 5, 0))   # петък сутрин


def test_day_window_and_weekdays():
    assert is_active(WORK, datetime(2026, 10, 26, 9, 0))           # понеделник
    assert not is_active(WORK, datetime(2026, 10, 25, 10, 0))      # неделя
    assert not is_active({**WORK, "enabled": 0}, datetime(2026, 10, 26, 10, 0))
    assert active_schedule([WORK, NIGHTS], datetime(2026, 10, 26, 23, 30))["id"] == 1


def test_sleep_events_are_merged_and_get_a_source():
    t = np.arange(100.0)
    lafmax = np.full(100, 35.0)
    lafmax[[10, 12, 14]] = 50        # близки превишавания – едно събитие
    lafmax[60] = 62                  # отделно събитие
    sources = [(12.0, "dog"), (13.0, "dog"), (60.0, "traffic")]
    sleep = sleep_analysis(t, np.full(100, 30.0), lafmax, sources)
    events = sleep["events"]
    assert len(events) == 2
    assert events[0]["start"] == 10 and events[0]["end"] == 14 and events[0]["source"] == "dog"
    assert events[1]["max"] == 62 and events[1]["source"] == "traffic"
