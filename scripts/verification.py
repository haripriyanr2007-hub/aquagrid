"""
Public alert-response verification (pure functions, unit-tested).

Each public response to an alert gets one of:
  Unverified            - not enough evidence either way (default)
  Corroborated          - supported by other independent respondents and/or a REAL sensor
  Conflicting           - independent respondents disagree about the same alert
  Requires Admin Review - contradicts a real sensor reading, or looks like spam
A response is never labelled fake. Simulated sensor readings are NOT used as evidence.
"""
from datetime import datetime

WET = {"flooding", "waterlogging", "road_blocked"}
DRY = {"no_flooding"}
NEAR_M = 1000
WINDOW_H = 3


def _t(v):
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def claim(r):
    t = r.get("response_type")
    return "wet" if t in WET else "dry" if t in DRY else None


def _near(a, b):
    if None in (a.get("lat"), b.get("lat")):
        return True                       # same alert, unknown position: treat as same area
    from duplicates import haversine_m
    return haversine_m(a["lat"], a["lng"], b["lat"], b["lng"]) <= NEAR_M


def sensor_evidence(reading):
    """'wet' / 'dry' / None from a REAL (non-simulated) node reading close in time."""
    if not reading or reading.get("is_simulated") or reading.get("level_pct") is None:
        return None
    if reading.get("sensor_status") not in (None, "ok"):
        return None
    if reading["level_pct"] >= 60:
        return "wet"
    if reading["level_pct"] <= 20:
        return "dry"
    return None


def verify(response, others, reading=None):
    """others: other responses to the SAME alert. reading: nearest real reading in time, or None."""
    c = claim(response)
    reasons = []
    t0 = _t(response["created_at"])
    peers = [o for o in others if o["id"] != response["id"]
             and abs((_t(o["created_at"]) - t0).total_seconds()) <= WINDOW_H * 3600 and _near(response, o)]
    independent = [o for o in peers if o.get("respondent_key") != response.get("respondent_key")]
    same_person = [o for o in peers if o.get("respondent_key") == response.get("respondent_key")
                   and abs((_t(o["created_at"]) - t0).total_seconds()) <= 600]

    agree = {o["respondent_key"] for o in independent if c and claim(o) == c}
    disagree = {o["respondent_key"] for o in independent if c and claim(o) and claim(o) != c}
    sensor = sensor_evidence(reading)

    if len(same_person) >= 3:
        reasons.append(f"{len(same_person) + 1} responses from the same device within 10 minutes")
        return "Requires Admin Review", 0.2, reasons
    if c is None:
        reasons.append("response type cannot be checked automatically (other / pothole)")
        return "Unverified", 0.5, reasons
    if sensor and sensor != c:
        reasons.append(f"real sensor reading suggests '{sensor}' but the report says '{c}'")
        if agree:
            reasons.append(f"{len(agree)} other respondent(s) agree with the report")
        return "Requires Admin Review", 0.3, reasons

    score = 0.5 + 0.15 * min(len(agree), 3) - 0.15 * min(len(disagree), 3) + (0.25 if sensor == c else 0)
    score = round(max(0.0, min(1.0, score)), 2)
    if agree:
        reasons.append(f"{len(agree)} independent respondent(s) report the same")
    if disagree:
        reasons.append(f"{len(disagree)} independent respondent(s) report the opposite")
    if sensor == c:
        reasons.append("matches a real sensor reading")
    if disagree:
        return "Conflicting", score, reasons
    if len(agree) >= 2 or sensor == c:
        return "Corroborated", score, reasons
    if not reasons:
        reasons.append("no other reports or sensor data to compare yet")
    return "Unverified", score, reasons


def classify_text(text):
    """Map a free-text Telegram reply to a response type (simple keywords, English + common Kannada/Hindi words)."""
    t = (text or "").lower()
    if any(w in t for w in ("no water", "no flood", "dry", "clear", "normal", "nothing", "fine", "illa", "nahi")):
        return "no_flooding"
    if any(w in t for w in ("blocked", "closed", "jam", "stuck", "cannot pass", "can't pass")):
        return "road_blocked"
    if any(w in t for w in ("pothole", "gundi", "gaddha")):
        return "pothole"
    if any(w in t for w in ("flood", "knee", "deep", "neeru", "paani", "water level")):
        return "flooding"
    if any(w in t for w in ("water", "logging", "logged", "puddle", "stagnant")):
        return "waterlogging"
    return "other"
