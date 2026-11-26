"""
AquaGrid public-portal worker (NEW service - does not change any existing service)

1. Pothole Condition Assessment for public submissions
   - downloads the private image, reads photo GPS (EXIF) if the user gave no location
   - runs the EXISTING DrainX YOLO model (models/best.pt) and stores an AI assessment
   - if the model is missing, the assessment is stored as 'model_unavailable' - never invented
2. Background duplicate detection (image hash + distance + time); flags only, never deletes
3. Alert-response verification: Unverified / Corroborated / Conflicting / Requires Admin Review

Run:  python public_portal_worker.py           (loop)
      python public_portal_worker.py --once    (one pass, for testing)
"""
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

from common import HERE, env, env_float, get_db, get_logger, heartbeat, now_iso
from drainx_ai import classify, exif_gps, model_info, pothole_boxes
from duplicates import dhash, find_duplicate
from risk_model import condition_text, submission_severity
from verification import verify

log = get_logger("public_portal")
BUCKET = "submissions"


class Assessor:
    """Thin wrapper around the existing DrainX YOLO weights."""

    def __init__(self, model=None):
        p = env("POTHOLE_MODEL", "models/best.pt", required=False)
        self.path = p if os.path.isabs(p) else os.path.join(HERE, p)
        self.min_conf = env_float("POTHOLE_MIN_CONF", 0.25)
        self.info, self.model = model_info(self.path), model
        if self.model is None and self.info["model_loaded"]:
            try:
                from ultralytics import YOLO
                self.model = YOLO(self.path)
            except Exception as e:      # ultralytics not installed on this laptop
                self.info = {"model_loaded": False, "problem": f"ultralytics not available: {e}"}

    def assess(self, image_path):
        if self.model is None:
            return {"status": "model_unavailable", "error": self.info.get("problem", "model not loaded")}
        r = self.model.predict(image_path, conf=self.min_conf, verbose=False)[0]
        boxes = [b for b in pothole_boxes(r) if float(b.conf) >= self.min_conf]
        h, w = r.orig_shape
        area, _ = classify(boxes, h, w)
        sev = submission_severity(area, len(boxes))
        annotated = None
        if boxes:
            try:
                import cv2
                ok, buf = cv2.imencode(".jpg", r.plot())
                annotated = buf.tobytes() if ok else None
            except Exception:
                annotated = None
        return {"status": "completed",
                "detected_issue": "pothole" if boxes else "no pothole detected",
                "pothole_condition": condition_text(sev, len(boxes)),
                "severity": sev, "confidence": round(max((float(b.conf) for b in boxes), default=0), 4) or None,
                "boxes": len(boxes), "box_area_pct": area,
                "model_version": self.info.get("model_version"), "_annotated": annotated}


# ----------------------------------------------------------------- submissions
def process_submission(db, s, assessor):
    db.table("public_submissions").update({"assessment_status": "processing"}).eq("id", s["id"]).execute()
    path = None
    try:
        data = db.storage.from_(BUCKET).download(s["image_path"])
        suffix = os.path.splitext(s["image_path"])[1] or ".jpg"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            path = tmp.name
        update = {}

        if s.get("location_source", "none") == "none":
            fix = exif_gps(path)
            if fix:
                update.update(lat=fix[0], lng=fix[1], location_source="gps_exif")
                s.update(lat=fix[0], lng=fix[1])

        try:
            from PIL import Image
            with Image.open(path) as im:
                update["image_hash"] = dhash(im)
        except Exception as e:
            log.warning("could not hash %s: %s", s["tracking_id"], e)

        a = assessor.assess(path)
        annotated = a.pop("_annotated", None)
        if annotated:
            key = f"assessed/{s['id']}.jpg"
            try:
                db.storage.from_(BUCKET).upload(key, annotated, {"content-type": "image/jpeg", "upsert": "true"})
                a["annotated_path"] = key
            except Exception as e:
                log.warning("annotated image not stored: %s", e)
        db.table("submission_assessments").insert({"submission_id": s["id"], **a}).execute()

        since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        cands = (db.table("public_submissions").select("id,image_hash,lat,lng,segment,category,created_at")
                 .gte("created_at", since).execute().data or [])
        new = {**s, **update}
        dup, score, why = find_duplicate(new, [c for c in cands if c["id"] != s["id"]])
        if dup:
            update.update(possible_duplicate_of=dup, duplicate_score=score, duplicate_reasons=why)
            log.info("%s may repeat an earlier report (score %.2f): %s", s["tracking_id"], score, "; ".join(why))

        update["assessment_status"] = "done" if a["status"] == "completed" else a["status"]
        db.table("public_submissions").update(update).eq("id", s["id"]).execute()
        log.info("%s assessed: %s %s", s["tracking_id"], a["status"],
                 f"{a.get('severity')} ({a.get('confidence')})" if a["status"] == "completed" else a.get("error", ""))
        return a
    except Exception as e:
        log.error("assessment of %s failed: %s", s.get("tracking_id"), e)
        db.table("submission_assessments").insert({"submission_id": s["id"], "status": "failed",
                                                   "error": str(e)[:300]}).execute()
        db.table("public_submissions").update({"assessment_status": "failed"}).eq("id", s["id"]).execute()
        return {"status": "failed", "error": str(e)}
    finally:
        if path and os.path.exists(path):
            os.unlink(path)


# ----------------------------------------------------------------- alert responses
def nearest_real_reading(db, alert, at_iso):
    """Closest reading (within 30 min) from the REAL node linked to the alert's segment/node."""
    node_id = alert.get("node_id")
    if not node_id and alert.get("segment"):
        n = (db.table("nodes").select("id,kind").eq("swmm_node", alert["segment"]).eq("kind", "real")
             .execute().data or [])
        node_id = n[0]["id"] if n else None
    if not node_id:
        return None
    t = datetime.fromisoformat(str(at_iso).replace("Z", "+00:00"))
    rows = (db.table("readings").select("level_pct,is_simulated,sensor_status,created_at").eq("node_id", node_id)
            .gte("created_at", (t - timedelta(minutes=30)).isoformat()).order("id", desc=True).limit(200)
            .execute().data or [])
    rows = [r for r in rows if r.get("created_at") and
            abs((datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00")) - t).total_seconds()) <= 1800]
    if not rows:
        return None
    return min(rows, key=lambda r: abs((datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00")) - t)
                                       .total_seconds()))


def verify_responses(db):
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    resp = db.table("alert_responses").select("*").gte("created_at", since).execute().data or []
    by_alert, changed = {}, 0
    for r in resp:
        by_alert.setdefault(r["alert_id"], []).append(r)
    for alert_id, group in by_alert.items():
        alert = (db.table("alerts").select("*").eq("id", alert_id).execute().data or [{}])[0]
        for r in group:
            reading = nearest_real_reading(db, alert, r["created_at"])
            status, score, reasons = verify(r, group, reading)
            if status != r.get("verification_status") or score != r.get("verification_score"):
                db.table("alert_responses").update({
                    "verification_status": status, "verification_score": score,
                    "verification_reasons": reasons, "verified_at": now_iso()}).eq("id", r["id"]).execute()
                changed += 1
    return changed


def main():
    db = get_db()
    once = "--once" in sys.argv
    assessor = Assessor()
    if assessor.model is None:
        log.warning("DrainX model unavailable - submissions will be stored as 'model_unavailable': %s",
                    assessor.info.get("problem"))
    last_verify = 0.0
    while True:
        try:
            queued = (db.table("public_submissions").select("*").eq("assessment_status", "queued")
                      .order("created_at").limit(3).execute().data or [])
            for s in queued:
                process_submission(db, s, assessor)
            if time.time() - last_verify >= 30 or once:
                n = verify_responses(db)
                last_verify = time.time()
                if n:
                    log.info("updated verification of %d alert response(s)", n)
            heartbeat(db, "public_portal", "ok" if assessor.model else "warning",
                      model_loaded=assessor.model is not None, model_problem=assessor.info.get("problem"),
                      queued=len(queued))
        except Exception as e:
            log.error("worker loop error: %s", e)
            heartbeat(db, "public_portal", "error", error=str(e)[:200])
        if once:
            break
        time.sleep(3)


if __name__ == "__main__":
    main()
