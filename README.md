# AquaGrid — with DrainX road intelligence

AquaGrid is a stormwater-management and road-monitoring platform for Bengaluru. It joins:

- a **smart drain node** (Arduino) that measures water level and quality and sends clean water into a recharge pit,
- a **digital twin** (EPA SWMM + PySWMM) that forecasts flooding from Open-Meteo rain and chooses when to open recharge gates,
- **DrainX**, YOLOv8 pothole detection from images, videos, webcams and phone uploads,
- **road-risk** and **repair-priority** scoring with written explanations,
- **Telegram alerts**, and
- one **live React dashboard** with 10 sections.

Everything talks through one Supabase database. No service calls another directly.

## What's new in v3: Public & Admin portals
One application, two experiences (no second deployment):

| | Public portal (`#/…`, no login) | Admin portal (`#admin/…`, login + admin role) |
|---|---|---|
| Sections | Overview · Live Map · Road Conditions · Alerts · Report an Issue · Track My Report | the 10 existing sections **unchanged** + Submission Review · Alert Responses · Pump Control |
| Data | safe views only: road condition labels, road risk, alerts, approved reports, confirmed potholes | everything, incl. raw readings, private images, AI assessments, notes, commands |
| Can do | report a pothole/drain (camera **or** gallery), get a tracking ID, track it, respond to alerts | approve/reject submissions with notes, see verification results, request pump ON/OFF, set Manual/Automatic mode |

Security is enforced **in the database** (RLS + `is_admin()` + RPC functions), not by hiding buttons.

> **Honesty labels used everywhere.** Virtual nodes are **SIMULATED**. The flood model is an **illustrative, uncalibrated** starter model. Node and segment coordinates are **approximate**. Pothole coordinates are only stored when they come from photo GPS, a GPS module, the phone/browser, or manual entry. Otherwise the record says *location unavailable*.

---

## Features

| Area | What it does | Where |
|---|---|---|
| Database | 8 original tables + migration 002 (history, repairs, upload queue, service health, storage bucket, RLS) | `database/` |
| Hardware bridge | USB serial ↔ Supabase, validated commands, auto-reconnect, hardware status, `--simulate` mode (labelled) | `scripts/bridge.py` |
| City simulator | 20 virtual nodes at flood-prone spots, storm/stop/reset commands | `scripts/simulator.py` |
| Digital twin | Open-Meteo rain, sensor correction, baseline / threshold / optimised scenarios, gate plan | `scripts/brain.py`, `twin/ward.inp` |
| DrainX AI | image, folder, video, webcam, dashboard uploads; boxes, confidence, severity, location, annotated images, alerts | `scripts/pothole_detect.py`, `scripts/drainx_ai.py` |
| Model evaluation | precision, recall, mAP50, mAP50-95, TP/FP/FN, confusion matrix | `scripts/evaluate_model.py` |
| Road risk | 0.6 × flood exposure + 0.4 × pothole density, history, HIGH/CRITICAL alerts | `scripts/road_risk.py`, `scripts/risk_model.py` |
| Repair priority | transparent ranking + reasons; status changed only by signed-in team members (logged) | `scripts/repair_priority.py` |
| Alerts | Telegram /start, /stop, severity, time, map link, sent once, duplicate prevention | `scripts/alerts.py` |
| Dashboard | Overview, Live Map, Flood, Digital Twin, DrainX, Road Risk, Repairs, Alerts, Control Room, System Health | `dashboard/` |
| Firmware | Arduino Uno smart node with quality gate | `firmware/drainx_node/` |

## Technology stack
Python 3.11 · Ultralytics YOLOv8 · OpenCV · PySWMM / EPA SWMM 5.2 · Open-Meteo · Supabase (Postgres, Realtime, Auth, Storage) · Telegram Bot API · React 19 + Vite · react-leaflet (OpenStreetMap) · Recharts · Arduino Uno.

No new frontend libraries were added. On the Python side only **Pillow** was added (to read GPS from photo EXIF).

## Folder structure
```
aquagrid/
├─ README.md                      this file
├─ docs/EXECUTION_GUIDE_WINDOWS.md  step-by-step for VS Code on Windows
├─ database/
│  ├─ 001_initial_schema.sql      original 8 tables (already applied in your project)
│  ├─ 002_aquagrid_upgrade.sql    additive upgrade, safe to re-run
│  └─ 003_portals_admin_pump.sql  v3 - admin roles, submissions, responses, pump settings, RLS
├─ firmware/drainx_node/drainx_node.ino
├─ twin/ward.inp                  SWMM starter model (illustrative)
├─ scripts/                       Python services
│  ├─ common.py  segments.py  risk_model.py  drainx_ai.py      shared modules
│  ├─ bridge.py  simulator.py  brain.py  alerts.py             services
│  ├─ road_risk.py  repair_priority.py  pothole_detect.py  evaluate_model.py
│  ├─ public_portal_worker.py  duplicates.py  verification.py      v3
│  ├─ requirements.txt  requirements-ai.txt  .env.example  start_all.bat
│  └─ models/  (put best.pt here)
├─ dashboard/                     React + Vite app
│  └─ src/  App.jsx  supabase.js  lib/  components/
│          pages/ (10 existing)  pages/public/ (5 new)  pages/admin/ (4 new)
└─ tests/                         offline test-suite + recorded results
```

## Installation
1. Install **Python 3.11**, **Node.js LTS**, **Git**, **VS Code** (and optionally EPA SWMM 5.2 for Windows).
2. Python, from the `scripts` folder:
   ```
   python -m venv .venv
   .venv\Scripts\activate            (Mac/Linux: source .venv/bin/activate)
   pip install -r requirements.txt
   pip install -r requirements-ai.txt   (only on the laptop that runs DrainX)
   ```
3. Dashboard, from the `dashboard` folder: `npm install`

## Configuration
- `scripts/.env` (copy from `.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SERIAL_PORT`, `TELEGRAM_BOT_TOKEN` (or `BOT_TOKEN`), `POTHOLE_MODEL`, `POTHOLE_SEGMENT`, `POTHOLE_MIN_CONF`, `GPS_PORT`, `TWIN_LAT`, `TWIN_LNG`.
- `dashboard/.env` (copy from `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (**anon key only**).
- Never commit `.env` files. They are in `.gitignore`.

## Database setup
Run the files in order in Supabase → SQL Editor (each is safe to re-run):
1. `database/001_initial_schema.sql` (already applied in your project)
2. `database/002_aquagrid_upgrade.sql`
3. **`database/003_portals_admin_pump.sql`** (v3): admin roles, submissions, assessments, reviews, alert responses, pump settings, private `submissions` bucket. It also replaces some *public* read rules with *admin-only* rules (readings, commands, potholes, repairs, jobs, service health). Public pages read safe views instead.

Notes on 002: It only adds columns, tables, policies, a trigger and the `detections` storage bucket. It flags old pothole rows whose coordinates were random as `legacy_random`.
### Admin account creation and role assignment
1. Supabase → Authentication → Users → **Add user** → email + password (tick *Auto confirm*). There is no public sign-up page in the app.
2. Give that user the admin role in SQL Editor:
   ```sql
   insert into admin_users (user_id, email)
   select id, email from auth.users where email = 'admin@yourcollege.edu';
   ```
3. More admins later: repeat both steps. Remove access: `update admin_users set active = false where email = '...';`
4. Recommended: Authentication → Providers → Email → **disable "Allow new users to sign up"**. A signed-up user still cannot enter the admin portal without a row in `admin_users`.

## Running the backend
Each service runs in its own terminal (or double-click `scripts\start_all.bat` on Windows):

| Command | Purpose |
|---|---|
| `python simulator.py` | start first: registers nodes, runs 20 virtual nodes |
| `python bridge.py` (or `python bridge.py --simulate`) | Arduino link (or labelled software model) |
| `python brain.py` | digital twin, forecast every 10 min, demo storms |
| `python alerts.py` | Telegram |
| `python road_risk.py` | risk every 30 s |
| `python repair_priority.py` | repair ranking every 60 s |
| `python pothole_detect.py --worker` | processes admin DrainX uploads |
| `python public_portal_worker.py` | **v3**: AI assessment of public submissions, duplicate detection, alert-response verification |

## Frontend
```
cd dashboard
npm run dev        → http://localhost:5173
npm run build      → production files in dist/ (deploy dashboard/ on Vercel, root directory "dashboard")
```

## Simulator and digital twin
- Control Room → **Start Monsoon** sends `R:ON` to the real node, `STORM` to the simulator and `STORM` to the brain.
- The twin runs three scenarios on `twin/ward.inp` and stores flood volumes, flood curves, the gate plan, the rain source and an **assumptions** note in `runs`.
- Making the model real (elevations, drain sizes, calibration against a past flood) is described in the Software Build Guide, section 6.4. It has **not** been done yet.

## AI detection (DrainX)
1. Copy your trained weights to `scripts/models/best.pt` (not in Git; share via Drive).
2. Examples:
   ```
   python pothole_detect.py --source road.jpg
   python pothole_detect.py --source photos\ --segment J1
   python pothole_detect.py --source road.mp4 --no-show
   python pothole_detect.py --source 0                      (webcam)
   python pothole_detect.py --source road.jpg --lat 12.9177 --lng 77.6238   (only if you know the spot)
   python pothole_detect.py --source 0 --gps-port COM5      (USB GPS module)
   python pothole_detect.py --worker                        (dashboard uploads)
   ```
3. Measure real accuracy: `python evaluate_model.py --data <dataset folder>\data.yaml` (writes `models/metrics.json`, shown on the dashboard).
4. Default confidence threshold is **0.25**. The earlier 0.10 setting accepted very weak detections; the only recorded test so far was **19.22 % confidence**, so accuracy is still unproven.

## Public submissions: how to test
1. Open the public portal (`http://localhost:5173`) → **Report an Issue** → *Take a photo* or *Choose from gallery* → Submit.
2. You get a tracking ID like `AQ-1A2B-3C4D-5E6F` (also remembered on that device). **Track My Report** shows *Pending Review*.
3. With `public_portal_worker.py` running, the **Pothole Condition Assessment** appears in the admin portal within seconds (detected issue, condition, severity Low/Medium/High/Critical, AI confidence). Without `models/best.pt` it is stored as *model unavailable*; nothing is invented.
4. Pending reports are **not** on the public map. The photo sits in a private bucket.

## Reviewing submissions (admin)
1. Click **Admin login** (top right) → sign in → **Submission Review**.
2. Each card shows the original image (signed link, 10 min), the AI assessment (labelled *AI-generated*), location and source, tracking ID, possible-duplicate hint and review history.
3. **Approve** publishes it to the public map (only if it has real coordinates) and sets the tracking status to *Approved*. **Reject** (note required) keeps it hidden but stored. *Add note only* records an internal note. Every action is logged with the admin's email.

## Alert responses & verification
Public users open **Alerts → Tell us what you see**. Telegram subscribers reply to any alert message. Responses are stored with the alert ID, time and a hashed anonymous key. The worker sets *Unverified / Corroborated / Conflicting / Requires Admin Review* by comparing independent reports (±3 h, ≤1 km) and **real** sensor readings. Simulated readings and NO-ECHO readings are never used as evidence, and nothing is labelled fake.

## Pump control (admin), awaiting hardware integration
- **Live hardware information**: latest SS-01 reading, real vs simulated tag, ultrasonic distance (NO ECHO shown as invalid, never 0), water level only when a reference height is configured, turbidity, hardware-reported pump state, bridge connection, last update.
- **Manual mode**: Motor ON / Motor OFF create a request (`commands`, `kind='pump'`, target `SS-01-PUMP`) recording the admin and time. The requested state is shown separately from the hardware-confirmed state. Status: Pending → Acknowledged/Failed (set by hardware later) or **Timed out** after 60 s.
- **Automatic mode**: reference height + ON and OFF thresholds (hysteresis enforced; ON must be higher than OFF), stored as **NOT CALIBRATED**.
- **Nothing reaches the pump yet.** The current `bridge.py` only processes target `SS-01`, so pump requests stay pending and then time out. No acknowledgement is ever faked.
- **Next stage (planned):** bridge.py reads `SS-01-PUMP` requests → Arduino → relay → pump; Arduino ACK → bridge writes `ack_status`, `hardware_state`, `acked_at`; AUTO thresholds are sent to the firmware.

## Hardware connection
Upload `firmware/drainx_node/drainx_node.ino` to the Uno (Hardware Guide). Close the Arduino Serial Monitor. Set `SERIAL_PORT` and run `python bridge.py`. Without hardware, use `python bridge.py --simulate`. Readings are then stored with `is_simulated = true` and shown as SIMULATED.

## Troubleshooting
| Problem | Fix |
|---|---|
| `Missing SUPABASE_URL` | create `scripts/.env` from `.env.example` |
| Dashboard says Supabase not configured | create `dashboard/.env`, restart `npm run dev` |
| "column … does not exist" / pages say run migration | run `database/002_aquagrid_upgrade.sql` |
| `Cannot open COM3` | wrong port or Serial Monitor open; or use `--simulate` |
| bridge: foreign key error | run `simulator.py` once to register SS-01 |
| Telegram silent | press START in the bot; only ONE `alerts.py` may run; check token |
| DrainX: model not found | put `best.pt` in `scripts/models/` or set `POTHOLE_MODEL` |
| Upload button disabled (admin DrainX page) | sign in as an admin |
| "has no admin role" | add the user to `admin_users` (see Admin account creation) |
| Public report: "image not uploaded" | run migration 003 (creates the private `submissions` bucket and its upload rule) |
| Assessment shows "model unavailable" | put `best.pt` in `scripts/models/` and restart `public_portal_worker.py` |
| Pump request "Timed out" | expected until the bridge/Arduino integration stage |
| Upload stays "queued" | start `python pothole_detect.py --worker` |
| Road risk says "no flood forecast" | start `brain.py` and run a forecast; risk is not silently set to 0 |
| `pyswmm` install fails | use 64-bit Python 3.11 |

## Tests
`python tests/run_tests.py` runs 35 offline tests (20 earlier + 15 for v3). `bash tests/sql_portal_tests.sh` runs 63 role-based security checks against a local PostgreSQL. The suite covers risk maths, GPS/EXIF parsing, detector helpers, dedupe, services against an in-memory database, and the twin optimiser against a fake SWMM engine. Results are recorded in `tests/*.json` and in the development report, including what was **not** tested.
