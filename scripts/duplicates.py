"""
Background duplicate detection for public submissions (pure functions, unit-tested).
A pair is a POSSIBLE duplicate - it is never deleted or hidden automatically.
Signals: perceptual image hash (dHash, 64 bit), distance between locations, time gap, same category.
"""
import math
from datetime import datetime

HASH_NEAR = 10            # hamming distance <= 10 of 64 bits: visually near-identical photo
DIST_NEAR_M = 75          # reports within 75 m
WINDOW_DAYS = 14


def dhash(image, size=8):
    """Difference hash of a PIL image -> 16-char hex string."""
    from PIL import Image
    g = image.convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(g.getdata())
    bits = 0
    for row in range(size):
        for col in range(size):
            left, right = px[row * (size + 1) + col], px[row * (size + 1) + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f"{bits:0{size * size // 4}x}"


def hamming(a, b):
    if not a or not b:
        return None
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def haversine_m(lat1, lng1, lat2, lng2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _t(v):
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def score_pair(new, old):
    """Return (score 0..1, reasons) for how likely `new` repeats `old`."""
    reasons, score = [], 0.0
    h = hamming(new.get("image_hash"), old.get("image_hash"))
    if h is not None and h <= HASH_NEAR:
        score += 0.6 if h <= 4 else 0.45
        reasons.append(f"photo looks {'identical' if h <= 4 else 'very similar'} (hash distance {h}/64)")
    if None not in (new.get("lat"), old.get("lat")):
        d = haversine_m(new["lat"], new["lng"], old["lat"], old["lng"])
        if d <= DIST_NEAR_M:
            score += 0.3
            reasons.append(f"reported {d:.0f} m apart")
    elif new.get("segment") and new.get("segment") == old.get("segment"):
        score += 0.1
        reasons.append("same road segment (no coordinates)")
    if new.get("category") == old.get("category"):
        score += 0.1
    try:
        gap_h = abs((_t(new["created_at"]) - _t(old["created_at"])).total_seconds()) / 3600
        if gap_h <= 24:
            reasons.append(f"submitted {gap_h:.1f} h apart")
    except Exception:
        pass
    return round(min(score, 1.0), 2), reasons


def find_duplicate(new, candidates, threshold=0.55):
    """Best earlier submission that `new` probably repeats, or (None, 0, [])."""
    best = (None, 0.0, [])
    for old in candidates:
        if old.get("id") == new.get("id"):
            continue
        try:
            if abs((_t(new["created_at"]) - _t(old["created_at"])).days) > WINDOW_DAYS:
                continue
        except Exception:
            pass
        s, why = score_pair(new, old)
        if s >= threshold and s > best[1]:
            best = (old.get("id"), s, why)
    return best
