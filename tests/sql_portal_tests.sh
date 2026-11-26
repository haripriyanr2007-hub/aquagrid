#!/usr/bin/env bash
# Role-based security tests for migration 003 on a local PostgreSQL with tests/supabase_scaffold.sql
# usage: P="psql -h HOST -p PORT -U postgres -d DB" bash tests/sql_portal_tests.sh
P=${P:-"psql -h /tmp/pgsock -p 5433 -U postgres -d t"}
ADMIN='{"sub":"11111111-1111-1111-1111-111111111111","email":"admin@aquagrid.test"}'
USER='{"sub":"22222222-2222-2222-2222-222222222222","email":"citizen@example.com"}'
pass=0; fail=0
run() { # role claims sql
  local out
  out=$($P -X -q -At -v ON_ERROR_STOP=1 -c "set role $1" -c "select set_config('request.jwt.claims', '$2', false)" -c "$3" 2>&1)
  if [[ "$out" == *ERROR:* ]]; then echo "$out" | grep -m1 'ERROR:'; else echo "$out" | tail -1; fi
}
expect_ok()  { local out; out=$(run "$2" "$3" "$4"); if [[ "$out" != *ERROR* ]]; then echo "PASS  $1  -> ${out:-ok}"; pass=$((pass+1)); else echo "FAIL  $1  -> $out"; fail=$((fail+1)); fi; }
expect_err() { local out; out=$(run "$2" "$3" "$4"); if [[ "$out" == *ERROR* ]]; then echo "PASS  $1  -> blocked: ${out#*ERROR:  }"; pass=$((pass+1)); else echo "FAIL  $1  -> was allowed: $out"; fail=$((fail+1)); fi; }
expect_val() { local out; out=$(run "$2" "$3" "$4"); if [[ "$out" == "$5" ]]; then echo "PASS  $1  -> $out"; pass=$((pass+1)); else echo "FAIL  $1  -> got '$out' expected '$5'"; fail=$((fail+1)); fi; }

# ---- setup (as postgres = service role) ----
$P -X -q <<SQL
insert into auth.users values ('11111111-1111-1111-1111-111111111111','admin@aquagrid.test'),
                              ('22222222-2222-2222-2222-222222222222','citizen@example.com') on conflict do nothing;
insert into admin_users(user_id,email) values ('11111111-1111-1111-1111-111111111111','admin@aquagrid.test') on conflict do nothing;
insert into nodes(id,name,lat,lng,kind) values ('SS-01','Silk Board',12.91,77.62,'real'),('SV-01','HSR',12.91,77.64,'virtual') on conflict do nothing;
insert into readings(node_id, level_pct, is_simulated) values ('SS-01', 72, false), ('SV-01', 90, true);
insert into pump_settings(node_id) values ('SS-01') on conflict do nothing;
insert into alerts(kind,message,severity,segment) values ('flood_forecast','Flood predicted at Silk Board','warning','J2');
insert into storage.objects(bucket_id,name) values ('submissions','incoming/test-1.jpg'),('submissions','incoming/test-2.jpg');
SQL

echo "== role checks"
expect_val "anon is not admin"                      anon          '{}'       "select public.is_admin();" "f"
expect_val "signed-in citizen is not admin"         authenticated "$USER"    "select public.is_admin();" "f"
expect_val "admin user is admin"                    authenticated "$ADMIN"   "select public.is_admin();" "t"

echo "== public portal data"
expect_val "anon reads public node status (no raw numbers)" anon '{}' "select condition from public_node_status where id='SS-01';" "Waterlogging likely"
expect_val "anon cannot read raw readings (0 rows)" anon '{}' "select count(*) from readings;" "0"
expect_val "citizen cannot read raw readings"       authenticated "$USER" "select count(*) from readings;" "0"
expect_val "admin reads raw readings"               authenticated "$ADMIN" "select count(*) from readings;" "2"
expect_val "anon still reads alerts"                anon '{}' "select count(*) from alerts;" "1"
expect_val "anon reads road_risk (unchanged)"       anon '{}' "select count(*) >= 0 from road_risk;" "t"

echo "== submissions"
TRACK=$(run anon '{}' "select public.create_submission('incoming/test-1.jpg','pothole','Big hole near bus stop',12.9177,77.6238,'gps_browser','J2','session-abcdefghijklmnop');")
echo "      tracking id: $TRACK"
expect_err "anon cannot submit an image that was not uploaded" anon '{}' "select public.create_submission('incoming/missing.jpg','pothole','',null,null,'none','J2','session-abcdefghijklmnop');"
expect_err "anon cannot point at another bucket path"          anon '{}' "select public.create_submission('../detections/x.jpg','pothole','',null,null,'none','J2','session-abcdefghijklmnop');"
expect_err "same image cannot be submitted twice"              anon '{}' "select public.create_submission('incoming/test-1.jpg','pothole','',null,null,'none','J2','session-abcdefghijklmnop');"
expect_val "new submission is Pending Review"       anon '{}' "select status from public.track_submission('$TRACK');" "Pending Review"
expect_val "tracking works case-insensitively"      anon '{}' "select count(*) from public.track_submission(lower('$TRACK'));" "1"
expect_val "unknown tracking id returns nothing"    anon '{}' "select count(*) from public.track_submission('AQ-0000-0000-0000');" "0"
expect_val "anon cannot list submissions table"     anon '{}' "select count(*) from public_submissions;" "0"
expect_val "citizen cannot list submissions table"  authenticated "$USER" "select count(*) from public_submissions;" "0"
expect_val "pending report NOT in public_reports"   anon '{}' "select count(*) from public_reports;" "0"
expect_val "admin sees pending submission"          authenticated "$ADMIN" "select count(*) from public_submissions where status='Pending Review';" "1"
expect_val "anon cannot read private image files"   anon '{}' "select count(*) from storage.objects where bucket_id='submissions';" "0"
expect_val "admin can read private image files"     authenticated "$ADMIN" "select count(*) from storage.objects where bucket_id='submissions';" "2"
expect_ok  "anon may upload into submissions/incoming" anon '{}' "insert into storage.objects(bucket_id,name) values ('submissions','incoming/new.jpg');"
expect_err "anon may NOT upload outside incoming/"  anon '{}' "insert into storage.objects(bucket_id,name) values ('submissions','assessed/x.jpg');"
expect_err "anon may NOT upload to detections bucket" anon '{}' "insert into storage.objects(bucket_id,name) values ('detections','x.jpg');"
expect_err "citizen cannot approve"                 authenticated "$USER"  "select public.review_submission((select id from public_submissions limit 1),'approve','ok');"
SID=$($P -X -At -c "select id from public_submissions where tracking_id='$TRACK';")
run authenticated "$USER" "update public_submissions set status='Approved' where id='$SID';" >/dev/null
expect_val "citizen direct UPDATE changes nothing (RLS)" authenticated "$ADMIN" "select status from public_submissions where id='$SID';" "Pending Review"
expect_val "admin approves with note"               authenticated "$ADMIN" "select public.review_submission('$SID','approve','Verified on site');" "Approved"
expect_val "approved report now public (no tracking id column)" anon '{}' "select category||' '||coalesce(lat::text,'nolat') from public_reports;" "pothole 12.9177"
expect_val "public view has no tracking_id/review_note columns" anon '{}' "select count(*) from information_schema.columns where table_name='public_reports' and column_name in ('tracking_id','review_note','image_path','description');" "0"
expect_val "tracking shows Approved"                anon '{}' "select status from public.track_submission('$TRACK');" "Approved"
expect_val "review history recorded with admin email" authenticated "$ADMIN" "select action||':'||old_status||'->'||new_status||':'||admin_email from submission_reviews;" "approve:Pending Review->Approved:admin@aquagrid.test"
TRACK2=$(run anon '{}' "select public.create_submission('incoming/test-2.jpg','drainage','Blocked drain',null,null,'none','J1','session-abcdefghijklmnop');")
SID2=$($P -X -At -c "select id from public_submissions where tracking_id='$TRACK2';")
expect_val "admin rejects second report"            authenticated "$ADMIN" "select public.review_submission('$SID2','reject','Not a public road');" "Rejected"
expect_val "rejected report stays hidden"           anon '{}' "select count(*) from public_reports;" "1"
expect_val "rejected record kept for audit"         authenticated "$ADMIN" "select status from public_submissions where id='$SID2';" "Rejected"
expect_val "report without location has no coordinates" authenticated "$ADMIN" "select coalesce(lat::text,'null') from public_submissions where id='$SID2';" "null"

echo "== alert responses"
AID=$($P -X -At -c "select id from alerts limit 1;")
expect_ok  "anon responds to an alert"              anon '{}' "select public.respond_to_alert($AID,'flooding','knee-deep water',12.917,77.623,'session-abcdefghijklmnop');"
expect_err "invalid response type rejected"         anon '{}' "select public.respond_to_alert($AID,'aliens','',null,null,'session-abcdefghijklmnop');"
expect_err "response to unknown alert rejected"     anon '{}' "select public.respond_to_alert(999999,'flooding','',null,null,'session-abcdefghijklmnop');"
run anon '{}' "select public.respond_to_alert($AID,'flooding','',null,null,'session-abcdefghijklmnop');" >/dev/null
run anon '{}' "select public.respond_to_alert($AID,'flooding','',null,null,'session-abcdefghijklmnop');" >/dev/null
expect_err "4th response from same session blocked" anon '{}' "select public.respond_to_alert($AID,'flooding','',null,null,'session-abcdefghijklmnop');"
expect_val "anon cannot read responses"             anon '{}' "select count(*) from alert_responses;" "0"
expect_val "admin reads responses, status Unverified" authenticated "$ADMIN" "select count(*)||' '||min(verification_status) from alert_responses;" "3 Unverified"
expect_val "respondent stored as hash only"         authenticated "$ADMIN" "select (respondent_key ~ '^[0-9a-f]{32}\$')::text from alert_responses limit 1;" "true"

echo "== commands and pump"
expect_err "anon cannot send any command"           anon '{}' "insert into commands(node_id,command) values ('SS-01','R:ON');"
expect_err "citizen cannot send any command"        authenticated "$USER" "insert into commands(node_id,command) values ('SS-01','R:ON');"
expect_ok  "admin can send existing control-room command" authenticated "$ADMIN" "insert into commands(node_id,command) values ('SIM','STORM');"
expect_err "admin cannot fake a pump command by direct insert" authenticated "$ADMIN" "insert into commands(node_id,command,kind,ack_status) values ('SS-01-PUMP','PUMP:ON','pump','acknowledged');"
expect_err "citizen cannot request pump"            authenticated "$USER" "select public.request_pump_command('SS-01','ON');"
expect_ok  "admin requests pump ON (manual mode)"   authenticated "$ADMIN" "select public.request_pump_command('SS-01','ON');"
expect_val "pump request is pending, not acknowledged" authenticated "$ADMIN" "select ack_status||' by '||requested_by_email||' target '||node_id from commands where kind='pump';" "pending by admin@aquagrid.test target SS-01-PUMP"
expect_err "AUTO without thresholds rejected"       authenticated "$ADMIN" "select public.set_pump_settings('SS-01','AUTO',null,null,null);"
expect_err "thresholds without hysteresis rejected" authenticated "$ADMIN" "select public.set_pump_settings('SS-01','AUTO',30,10,12);"
expect_ok  "admin saves AUTO with ON 20 / OFF 8 cm" authenticated "$ADMIN" "select public.set_pump_settings('SS-01','AUTO',30,20,8);"
expect_val "settings stored as NOT calibrated"      authenticated "$ADMIN" "select mode||' calibrated='||calibrated from pump_settings;" "AUTO calibrated=false"
expect_err "manual command refused while in AUTO"   authenticated "$ADMIN" "select public.request_pump_command('SS-01','OFF');"
expect_err "citizen cannot change pump settings"    authenticated "$USER" "select public.set_pump_settings('SS-01','MANUAL',null,null,null);"
expect_val "anon cannot read pump settings"         anon '{}' "select count(*) from pump_settings;" "0"
$P -X -q -c "update commands set created_at = now() - interval '2 minutes' where kind='pump';"
run authenticated "$ADMIN" "select public.set_pump_settings('SS-01','MANUAL',30,20,8);" >/dev/null
run authenticated "$ADMIN" "select public.request_pump_command('SS-01','OFF');" >/dev/null
expect_val "old unanswered request marked timed_out (not success)" authenticated "$ADMIN" "select string_agg(desired_state||'='||ack_status, ',' order by id) from commands where kind='pump';" "ON=timed_out,OFF=pending"

echo "== existing features unaffected"
$P -X -q -c "insert into repair_tickets(segment,name) values ('J2','Silk Board') on conflict do nothing;"
expect_ok  "admin can still update repair status (existing workflow)" authenticated "$ADMIN" "update repair_tickets set status='Under Review' where segment='J2';"
expect_val "repair status change logged with admin email" authenticated "$ADMIN" "select new_status||' by '||changed_by from repair_status_log order by id desc limit 1;" "Under Review by admin@aquagrid.test"
expect_err "admin still cannot change repair scores (column grant)" authenticated "$ADMIN" "update repair_tickets set priority_score=1 where segment='J2';"
expect_val "citizen cannot read repair tickets"     authenticated "$USER" "select count(*) from repair_tickets;" "0"
expect_val "anon cannot read service health"        anon '{}' "select count(*) from service_status;" "0"
expect_val "anon still reads digital-twin runs"     anon '{}' "select count(*) >= 0 from runs;" "t"
echo
echo "$pass passed, $fail failed"
