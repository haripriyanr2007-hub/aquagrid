-- =====================================================================
-- AquaGrid migration 003 - Public & Admin portals, submissions, alert responses,
--                          pump-control structure
-- Run AFTER 001 and 002, once, in Supabase > SQL Editor. Safe to re-run.
-- No table or row is dropped. Some existing PUBLIC read policies are replaced by
-- ADMIN-only policies (tightening only); public data is served by safe views/RPCs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Admin roles
-- ---------------------------------------------------------------------
create table if not exists admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table admin_users enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid() and active)
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "admins read admins" on admin_users;
create policy "admins read admins" on admin_users for select using (public.is_admin());
-- no insert/update/delete policy: admins are added only from the SQL editor (see README)

-- ---------------------------------------------------------------------
-- 2. New columns on existing tables (additive)
-- ---------------------------------------------------------------------
-- readings: room for the future bridge to send the raw ultrasonic value and its validity
alter table readings add column if not exists distance_cm   real;
alter table readings add column if not exists sensor_status text;   -- ok | no_echo | error

-- commands: pump requests with acknowledgement tracking (existing rows keep kind = 'legacy')
alter table commands add column if not exists kind               text default 'legacy';
alter table commands add column if not exists desired_state      text;          -- ON | OFF
alter table commands add column if not exists requested_by       uuid;
alter table commands add column if not exists requested_by_email text;
alter table commands add column if not exists ack_status         text;          -- pending | acknowledged | failed | timed_out
alter table commands add column if not exists acked_at           timestamptz;
alter table commands add column if not exists hardware_state     text;          -- state reported back by hardware
alter table commands add column if not exists ack_detail         text;
create index if not exists commands_kind_time on commands (kind, id desc);

-- ---------------------------------------------------------------------
-- 3. Public submissions (pothole / drainage reports)
-- ---------------------------------------------------------------------
create table if not exists public_submissions (
  id                  uuid primary key default gen_random_uuid(),
  tracking_id         text not null unique,
  category            text not null check (category in ('pothole','drainage','waterlogging','other')),
  description         text check (char_length(description) <= 1000),
  image_path          text not null,                       -- private bucket 'submissions'
  lat                 double precision,
  lng                 double precision,
  location_source     text not null default 'none'
                      check (location_source in ('gps_browser','gps_exif','manual','none')),
  segment             text,
  submitter_id        uuid,                                -- auth.uid() when signed in
  session_hash        text,                                -- md5 of an anonymous browser session id
  status              text not null default 'Pending Review'
                      check (status in ('Pending Review','Approved','Rejected')),
  assessment_status   text not null default 'queued'
                      check (assessment_status in ('queued','processing','done','model_unavailable','failed')),
  image_hash          text,                                -- perceptual hash (duplicate detection)
  possible_duplicate_of uuid references public_submissions (id),
  duplicate_score     real,
  duplicate_reasons   jsonb,
  review_note         text,                                -- admin only
  public_message      text,                                -- short message shown when tracking
  reviewed_by         uuid,
  reviewed_by_email   text,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now(),
  constraint coords_pair check ((lat is null) = (lng is null)),
  constraint coords_range check (lat is null or (abs(lat) <= 90 and abs(lng) <= 180))
);
create index if not exists public_submissions_status on public_submissions (status, created_at desc);
create index if not exists public_submissions_assess on public_submissions (assessment_status);

create table if not exists submission_assessments (
  id                bigint generated always as identity primary key,
  submission_id     uuid not null references public_submissions (id) on delete cascade,
  status            text not null check (status in ('completed','model_unavailable','failed')),
  detected_issue    text,              -- e.g. 'pothole', 'no pothole detected'
  pothole_condition text,              -- plain-language condition
  severity          text check (severity in ('Low','Medium','High','Critical')),
  confidence        real,              -- highest box confidence, null if no model
  boxes             int,
  box_area_pct      real,
  model_version     text,
  annotated_path    text,              -- private bucket path
  error             text,
  generated_by      text not null default 'AI (DrainX YOLOv8) - not an administrative decision',
  created_at        timestamptz not null default now()
);
create index if not exists submission_assessments_sub on submission_assessments (submission_id, id desc);

create table if not exists submission_reviews (
  id            bigint generated always as identity primary key,
  submission_id uuid not null references public_submissions (id) on delete cascade,
  action        text not null check (action in ('approve','reject','note')),
  old_status    text,
  new_status    text,
  note          text,
  admin_id      uuid,
  admin_email   text,
  created_at    timestamptz not null default now()
);
create index if not exists submission_reviews_sub on submission_reviews (submission_id, id);

-- ---------------------------------------------------------------------
-- 4. Public alert responses + verification results
-- ---------------------------------------------------------------------
create table if not exists alert_responses (
  id                   bigint generated always as identity primary key,
  alert_id             bigint not null references alerts (id) on delete cascade,
  response_type        text not null check (response_type in ('flooding','waterlogging','no_flooding','road_blocked','pothole','other')),
  observation          text check (char_length(observation) <= 500),
  lat                  double precision,
  lng                  double precision,
  source               text not null default 'web' check (source in ('web','telegram')),
  respondent_key       text not null,          -- hash, never the raw user id / chat id
  verification_status  text not null default 'Unverified'
                       check (verification_status in ('Unverified','Corroborated','Conflicting','Requires Admin Review')),
  verification_score   real,
  verification_reasons jsonb,
  verified_at          timestamptz,
  created_at           timestamptz not null default now(),
  constraint resp_coords_pair check ((lat is null) = (lng is null))
);
create index if not exists alert_responses_alert on alert_responses (alert_id, created_at);

-- Telegram: which message carried which alert (so replies can be linked)
create table if not exists telegram_deliveries (
  chat_id    bigint not null,
  message_id bigint not null,
  alert_id   bigint references alerts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

-- ---------------------------------------------------------------------
-- 5. Pump settings (software side; hardware integration is a later stage)
-- ---------------------------------------------------------------------
create table if not exists pump_settings (
  node_id              text primary key references nodes (id),
  mode                 text not null default 'MANUAL' check (mode in ('MANUAL','AUTO')),
  reference_height_cm  real check (reference_height_cm is null or reference_height_cm > 0),
  high_threshold_cm    real,      -- AUTO: pump ON when water level >= this (cm above sump floor)
  low_threshold_cm     real,      -- AUTO: pump OFF when water level <= this
  calibrated           boolean not null default false,
  updated_by_email     text,
  updated_at           timestamptz default now(),
  constraint hysteresis check (high_threshold_cm is null or low_threshold_cm is null or high_threshold_cm > low_threshold_cm),
  constraint within_reference check (reference_height_cm is null or high_threshold_cm is null or high_threshold_cm <= reference_height_cm)
);
create table if not exists pump_settings_history (
  id         bigint generated always as identity primary key,
  node_id    text,
  settings   jsonb,
  changed_by text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. Row Level Security: new tables (admin only - public access goes through RPCs/views)
-- ---------------------------------------------------------------------
alter table public_submissions      enable row level security;
alter table submission_assessments  enable row level security;
alter table submission_reviews      enable row level security;
alter table alert_responses         enable row level security;
alter table telegram_deliveries     enable row level security;
alter table pump_settings           enable row level security;
alter table pump_settings_history   enable row level security;

drop policy if exists "admins read submissions" on public_submissions;
create policy "admins read submissions" on public_submissions for select using (public.is_admin());
drop policy if exists "admins read assessments" on submission_assessments;
create policy "admins read assessments" on submission_assessments for select using (public.is_admin());
drop policy if exists "admins read reviews" on submission_reviews;
create policy "admins read reviews" on submission_reviews for select using (public.is_admin());
drop policy if exists "admins read responses" on alert_responses;
create policy "admins read responses" on alert_responses for select using (public.is_admin());
drop policy if exists "admins read pump settings" on pump_settings;
create policy "admins read pump settings" on pump_settings for select using (public.is_admin());
drop policy if exists "admins read pump history" on pump_settings_history;
create policy "admins read pump history" on pump_settings_history for select using (public.is_admin());
-- telegram_deliveries: no policy at all = service role only

-- ---------------------------------------------------------------------
-- 7. Row Level Security: tighten existing internal tables to admins
--    (Python services use the service-role key and are not affected)
-- ---------------------------------------------------------------------
drop policy if exists "public read readings" on readings;
drop policy if exists "admins read readings" on readings;
create policy "admins read readings" on readings for select using (public.is_admin());

drop policy if exists "public read commands" on commands;
drop policy if exists "dashboard sends commands" on commands;
drop policy if exists "admins read commands" on commands;
drop policy if exists "admins send commands" on commands;
create policy "admins read commands" on commands for select using (public.is_admin());
-- admins may queue the EXISTING simulation/node commands; pump requests must use request_pump_command()
create policy "admins send commands" on commands for insert
  with check (public.is_admin() and coalesce(kind, 'legacy') = 'legacy');

drop policy if exists "public read repairs" on repair_tickets;
drop policy if exists "team updates repairs" on repair_tickets;
drop policy if exists "admins read repairs" on repair_tickets;
drop policy if exists "admins update repairs" on repair_tickets;
create policy "admins read repairs"   on repair_tickets for select using (public.is_admin());
create policy "admins update repairs" on repair_tickets for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read repair log" on repair_status_log;
drop policy if exists "admins read repair log" on repair_status_log;
create policy "admins read repair log" on repair_status_log for select using (public.is_admin());

drop policy if exists "public read jobs" on detection_jobs;
drop policy if exists "team queues detections" on detection_jobs;
drop policy if exists "admins read jobs" on detection_jobs;
drop policy if exists "admins queue detections" on detection_jobs;
create policy "admins read jobs"        on detection_jobs for select using (public.is_admin());
create policy "admins queue detections" on detection_jobs for insert with check (public.is_admin());

drop policy if exists "public read service status" on service_status;
drop policy if exists "admins read service status" on service_status;
create policy "admins read service status" on service_status for select using (public.is_admin());

drop policy if exists "public read potholes" on potholes;
drop policy if exists "team verifies potholes" on potholes;
drop policy if exists "admins read potholes" on potholes;
drop policy if exists "admins verify potholes" on potholes;
create policy "admins read potholes"   on potholes for select using (public.is_admin());
create policy "admins verify potholes" on potholes for update using (public.is_admin()) with check (public.is_admin());
-- column grants from 002 still limit updates to potholes.verification and repair status fields

-- unchanged and still public: nodes, runs, alerts, road_risk, road_risk_history

-- ---------------------------------------------------------------------
-- 8. Public views (only safe columns; owner rights so RLS above is not exposed)
-- ---------------------------------------------------------------------
create or replace view public_node_status with (security_invoker = false) as
select n.id, n.name, n.lat, n.lng, n.kind,
       coalesce(r.is_simulated, n.kind <> 'real') as is_simulated,
       case
         when r.id is null or r.created_at < now() - interval '3 minutes' then 'No recent data'
         when r.sensor_status is not null and r.sensor_status <> 'ok'   then 'Sensor unavailable'
         when r.level_pct is null                                       then 'Sensor unavailable'
         when r.level_pct >= 85 then 'Flooded'
         when r.level_pct >= 60 then 'Waterlogging likely'
         when r.level_pct >= 35 then 'Water rising'
         else 'Normal'
       end as condition,
       r.created_at as updated_at
from nodes n
left join lateral (select * from readings x where x.node_id = n.id order by x.id desc limit 1) r on true;

create or replace view public_reports with (security_invoker = false) as
select s.id, s.category, s.segment, s.created_at as submitted_at, s.reviewed_at as approved_at,
       case when s.location_source in ('gps_browser','gps_exif','manual') then s.lat end as lat,
       case when s.location_source in ('gps_browser','gps_exif','manual') then s.lng end as lng,
       s.location_source,
       (select a.severity from submission_assessments a where a.submission_id = s.id and a.status = 'completed'
        order by a.id desc limit 1) as ai_severity,
       s.public_message
from public_submissions s
where s.status = 'Approved';

create or replace view public_potholes with (security_invoker = false) as
select id, lat, lng, severity, road_segment, created_at
from potholes
where verification = 'confirmed' and lat is not null
  and location_source in ('gps_exif','gps_device','gps_browser','manual');

grant select on public_node_status, public_reports, public_potholes to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. RPC functions (the only write paths for the public)
-- ---------------------------------------------------------------------
create or replace function public.create_submission(
  p_image_path text, p_category text, p_description text,
  p_lat double precision, p_lng double precision, p_location_source text,
  p_segment text, p_session text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_tracking text;
  v_hash text := md5(coalesce(p_session, ''));
  v_recent int;
begin
  if p_image_path is null or p_image_path not like 'incoming/%' or p_image_path like '%..%' then
    raise exception 'invalid image path';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'submissions' and o.name = p_image_path) then
    raise exception 'image not uploaded';
  end if;
  if exists (select 1 from public_submissions where image_path = p_image_path) then
    raise exception 'image already submitted';
  end if;
  if coalesce(p_location_source, 'none') = 'none' then
    p_lat := null; p_lng := null;
  end if;
  if p_session is null or char_length(p_session) < 16 then
    raise exception 'missing session';
  end if;
  select count(*) into v_recent from public_submissions
   where session_hash = v_hash and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'too many reports from this device in the last hour - please try later';
  end if;
  v_tracking := 'AQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-'
                      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)) || '-'
                      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
  insert into public_submissions (tracking_id, category, description, image_path, lat, lng,
                                  location_source, segment, submitter_id, session_hash)
  values (v_tracking, p_category, nullif(trim(p_description), ''), p_image_path, p_lat, p_lng,
          coalesce(p_location_source, 'none'), nullif(p_segment, ''), auth.uid(), v_hash);
  return v_tracking;
end $$;

create or replace function public.track_submission(p_tracking_id text)
returns table (tracking_id text, category text, status text, submitted_at timestamptz,
               reviewed_at timestamptz, public_message text)
language sql stable security definer set search_path = public as $$
  select s.tracking_id, s.category, s.status, s.created_at, s.reviewed_at, s.public_message
  from public_submissions s
  where s.tracking_id = upper(trim(p_tracking_id))
$$;

create or replace function public.review_submission(p_id uuid, p_action text, p_note text,
                                                     p_public_message text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_new text;
  v_email text := coalesce(auth.jwt() ->> 'email', 'admin');
begin
  if not public.is_admin() then
    raise exception 'admin role required';
  end if;
  if p_action not in ('approve','reject','note') then
    raise exception 'invalid action';
  end if;
  select status into v_old from public_submissions where id = p_id for update;
  if v_old is null then
    raise exception 'submission not found';
  end if;
  v_new := case p_action when 'approve' then 'Approved' when 'reject' then 'Rejected' else v_old end;
  update public_submissions
     set status = v_new,
         review_note = coalesce(nullif(trim(p_note), ''), review_note),
         public_message = case when p_action = 'note' then public_message
                               else coalesce(nullif(trim(p_public_message), ''),
                                    case v_new when 'Approved' then 'Approved and published on the public map.'
                                               else 'Reviewed - not published.' end) end,
         reviewed_by = case when p_action = 'note' then reviewed_by else auth.uid() end,
         reviewed_by_email = case when p_action = 'note' then reviewed_by_email else v_email end,
         reviewed_at = case when p_action = 'note' then reviewed_at else now() end
   where id = p_id;
  insert into submission_reviews (submission_id, action, old_status, new_status, note, admin_id, admin_email)
  values (p_id, p_action, v_old, v_new, nullif(trim(p_note), ''), auth.uid(), v_email);
  return v_new;
end $$;

create or replace function public.respond_to_alert(p_alert_id bigint, p_response_type text,
    p_observation text, p_lat double precision, p_lng double precision, p_session text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_count int;
  v_id bigint;
begin
  if not exists (select 1 from alerts where id = p_alert_id) then
    raise exception 'alert not found';
  end if;
  if p_session is null or char_length(p_session) < 16 then
    raise exception 'missing session';
  end if;
  v_key := md5(coalesce(auth.uid()::text, 'anon:' || p_session));
  select count(*) into v_count from alert_responses where alert_id = p_alert_id and respondent_key = v_key;
  if v_count >= 3 then
    raise exception 'you have already responded to this alert';
  end if;
  insert into alert_responses (alert_id, response_type, observation, lat, lng, source, respondent_key)
  values (p_alert_id, p_response_type, nullif(trim(p_observation), ''), p_lat, p_lng, 'web', v_key)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.request_pump_command(p_node text, p_state text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_mode text;
  v_id bigint;
begin
  if not public.is_admin() then
    raise exception 'admin role required';
  end if;
  if p_state not in ('ON','OFF') then
    raise exception 'state must be ON or OFF';
  end if;
  select mode into v_mode from pump_settings where node_id = p_node;
  if coalesce(v_mode, 'MANUAL') <> 'MANUAL' then
    raise exception 'switch to Manual mode first';
  end if;
  -- requests nobody acknowledged within 60 s are recorded as timed out (never as success)
  update commands set ack_status = 'timed_out', status = 'timed_out'
   where kind = 'pump' and node_id = p_node || '-PUMP' and ack_status = 'pending'
     and created_at < now() - interval '60 seconds';
  insert into commands (node_id, command, status, kind, desired_state, requested_by, requested_by_email, ack_status)
  values (p_node || '-PUMP', 'PUMP:' || p_state, 'pending', 'pump', p_state, auth.uid(),
          coalesce(auth.jwt() ->> 'email', 'admin'), 'pending')
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_pump_settings(p_node text, p_mode text, p_reference_cm real,
                                                    p_high_cm real, p_low_cm real)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin role required';
  end if;
  if p_mode not in ('MANUAL','AUTO') then
    raise exception 'mode must be MANUAL or AUTO';
  end if;
  if p_mode = 'AUTO' and (p_high_cm is null or p_low_cm is null) then
    raise exception 'Automatic mode needs both thresholds';
  end if;
  insert into pump_settings (node_id, mode, reference_height_cm, high_threshold_cm, low_threshold_cm,
                             calibrated, updated_by_email, updated_at)
  values (p_node, p_mode, p_reference_cm, p_high_cm, p_low_cm, false,
          coalesce(auth.jwt() ->> 'email', 'admin'), now())
  on conflict (node_id) do update set mode = excluded.mode, reference_height_cm = excluded.reference_height_cm,
       high_threshold_cm = excluded.high_threshold_cm, low_threshold_cm = excluded.low_threshold_cm,
       calibrated = false, updated_by_email = excluded.updated_by_email, updated_at = now();
  insert into pump_settings_history (node_id, settings, changed_by)
  values (p_node, jsonb_build_object('mode', p_mode, 'reference_height_cm', p_reference_cm,
          'high_threshold_cm', p_high_cm, 'low_threshold_cm', p_low_cm),
          coalesce(auth.jwt() ->> 'email', 'admin'));
end $$;

revoke all on function public.create_submission(text,text,text,double precision,double precision,text,text,text) from public;
revoke all on function public.track_submission(text) from public;
revoke all on function public.review_submission(uuid,text,text,text) from public;
revoke all on function public.respond_to_alert(bigint,text,text,double precision,double precision,text) from public;
revoke all on function public.request_pump_command(text,text) from public;
revoke all on function public.set_pump_settings(text,text,real,real,real) from public;
grant execute on function public.create_submission(text,text,text,double precision,double precision,text,text,text) to anon, authenticated;
grant execute on function public.track_submission(text) to anon, authenticated;
grant execute on function public.respond_to_alert(bigint,text,text,double precision,double precision,text) to anon, authenticated;
grant execute on function public.review_submission(uuid,text,text,text) to authenticated;
grant execute on function public.request_pump_command(text,text) to authenticated;
grant execute on function public.set_pump_settings(text,text,real,real,real) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Storage: private bucket for public uploads
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('submissions', 'submissions', false)
on conflict (id) do update set public = false;
do $$ begin
  update storage.buckets set file_size_limit = 10485760,
         allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
   where id = 'submissions';
exception when undefined_column then null; end $$;

drop policy if exists "public uploads submissions" on storage.objects;
create policy "public uploads submissions" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'submissions' and name like 'incoming/%');
drop policy if exists "admins read submissions files" on storage.objects;
create policy "admins read submissions files" on storage.objects for select
  using (bucket_id = 'submissions' and public.is_admin());

-- the existing DrainX bucket: uploads now need the admin role (was: any signed-in user)
drop policy if exists "team uploads detections" on storage.objects;
drop policy if exists "admins upload detections" on storage.objects;
create policy "admins upload detections" on storage.objects for insert
  with check (bucket_id = 'detections' and public.is_admin());

-- ---------------------------------------------------------------------
-- 11. Realtime for the admin portal (RLS still applies to every subscriber)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['public_submissions','submission_assessments','submission_reviews',
                           'alert_responses','pump_settings'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 12. Default pump settings row for the real node (uncalibrated, no thresholds)
-- ---------------------------------------------------------------------
insert into pump_settings (node_id, mode) select 'SS-01', 'MANUAL'
where exists (select 1 from nodes where id = 'SS-01')
on conflict (node_id) do nothing;
