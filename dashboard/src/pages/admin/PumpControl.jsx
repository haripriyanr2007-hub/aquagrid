import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { Card, Empty, Badge, Notice, SimTag, RealTag } from '../../components/ui'
import { REAL, ago, serviceAlive, time } from '../../lib/format'

const ACK = { pending: '#eab308', acknowledged: '#16a34a', failed: '#dc2626', timed_out: '#64748b' }

// a request nobody acknowledged within 60 s is shown as timed out - never as success
function ackOf(c) {
  if (c.ack_status === 'pending' && Date.now() - new Date(c.created_at).getTime() > 60000) return 'timed_out'
  return c.ack_status || 'pending'
}

function Reading({ r, settings }) {
  if (!r) return <Empty>No reading from {REAL} yet — is bridge.py running?</Empty>
  const noEcho = r.sensor_status && r.sensor_status !== 'ok'
  const ref = settings?.reference_height_cm
  const level = !noEcho && r.distance_cm != null && ref ? Math.max(0, ref - r.distance_cm) : null
  return (
    <table><tbody>
      <tr><td>Data source</td><td>{r.is_simulated ? <><SimTag /> bridge --simulate (not a real measurement)</> : <RealTag />}</td></tr>
      <tr><td>Ultrasonic distance</td><td>{noEcho ? <Badge colour="#dc2626">{(r.sensor_status || '').toUpperCase().replace('_', ' ')} — invalid reading</Badge>
        : r.distance_cm != null ? `${r.distance_cm} cm` : <span className="muted">not reported by the current firmware</span>}</td></tr>
      <tr><td>Water level</td><td>{level != null ? `${level.toFixed(1)} cm above sump floor`
        : ref ? <span className="muted">needs a valid distance reading</span>
        : <span className="muted">reference height not configured — no level calculated</span>}</td></tr>
      <tr><td>Firmware level estimate</td><td>{noEcho || r.level_pct == null ? '—' : `${r.level_pct}%`} <span className="muted small">(firmware's own CAL calibration, not verified by the app)</span></td></tr>
      <tr><td>Turbidity (raw)</td><td>{r.turbidity ?? '—'}</td></tr>
      <tr><td>Pump / gate reported by hardware</td><td>{r.gate_open == null ? 'unknown' : r.gate_open ? <Badge colour="#0ea5e9">ON</Badge> : <Badge colour="#64748b">OFF</Badge>} <span className="muted small">({r.reason || '—'})</span></td></tr>
      <tr><td>Last sensor update</td><td>{time(r.created_at)} ({ago(r.created_at)})</td></tr>
    </tbody></table>
  )
}

export default function PumpControl({ d }) {
  const settings = d.pumpSettings.find((s) => s.node_id === REAL)
  const reading = d.latest[REAL]
  const bridge = d.services.bridge
  const pumpCmds = d.commands.filter((c) => c.kind === 'pump')
  const lastReq = pumpCmds[0]
  const [mode, setMode] = useState(settings?.mode || 'MANUAL')
  const [form, setForm] = useState({ ref: '', high: '', low: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    setMode(settings?.mode || 'MANUAL')
    setForm({ ref: settings?.reference_height_cm ?? '', high: settings?.high_threshold_cm ?? '', low: settings?.low_threshold_cm ?? '' })
  }, [settings?.mode, settings?.reference_height_cm, settings?.high_threshold_cm, settings?.low_threshold_cm])
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 5000); return () => clearInterval(t) }, [])

  const num = (v) => (v === '' || v == null ? null : Number(v))
  async function save(newMode) {
    const ref = num(form.ref), high = num(form.high), low = num(form.low)
    if (newMode === 'AUTO' && (high == null || low == null)) return setMsg({ kind: 'error', text: 'Automatic mode needs an ON (high) and an OFF (low) threshold.' })
    if (high != null && low != null && high <= low) return setMsg({ kind: 'error', text: 'The ON threshold must be higher than the OFF threshold (hysteresis).' })
    if (ref != null && high != null && high > ref) return setMsg({ kind: 'error', text: 'The ON threshold cannot be above the reference height.' })
    setBusy(true)
    const { error } = await supabase.rpc('set_pump_settings', { p_node: REAL, p_mode: newMode, p_reference_cm: ref, p_high_cm: high, p_low_cm: low })
    setBusy(false)
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'info', text: `Saved: ${newMode} mode (not calibrated, not yet applied to hardware).` })
  }
  async function motor(state) {
    setBusy(true)
    const { data, error } = await supabase.rpc('request_pump_command', { p_node: REAL, p_state: state })
    setBusy(false)
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'info', text: `Request #${data} (Motor ${state}) recorded — waiting for hardware acknowledgement.` })
  }

  return (
    <div className="grid">
      <Card wide title="Pump control" sub={REAL}>
        <Notice kind="warn"><b>Awaiting bridge / Arduino integration.</b> Requests are stored for target <code>{REAL}-PUMP</code>. The current
          bridge.py does not process them yet, so <b>no physical pump action happens</b>. A request only shows “acknowledged” once the hardware confirms it (next development stage).</Notice>
      </Card>

      <Card title="Live hardware information">
        <p>Hardware connection: {bridge ? <Badge colour={serviceAlive(bridge, 60) && bridge.status === 'ok' ? '#16a34a' : '#dc2626'}>{bridge.detail?.hardware || bridge.status}</Badge> : <Badge colour="#64748b">bridge not running</Badge>}
          {bridge && <span className="muted small"> · bridge seen {ago(bridge.last_seen)}</span>}</p>
        <Reading r={reading} settings={settings} />
      </Card>

      <Card title="Operating mode">
        <div className="btns" role="radiogroup" aria-label="Operating mode">
          <button className={mode === 'MANUAL' ? 'primary' : ''} aria-pressed={mode === 'MANUAL'} disabled={busy} onClick={() => { setMode('MANUAL'); save('MANUAL') }}>Manual</button>
          <button className={mode === 'AUTO' ? 'primary' : ''} aria-pressed={mode === 'AUTO'} disabled={busy} onClick={() => setMode('AUTO')}>Automatic</button>
        </div>
        <p className="small">Saved mode: <b>{settings?.mode || 'MANUAL (default)'}</b>{settings?.updated_at && <> · by {settings.updated_by_email} {ago(settings.updated_at)}</>}</p>

        {mode === 'MANUAL' && (
          <>
            <h3>Manual control</h3>
            <div className="btns">
              <button className="primary" disabled={busy || settings?.mode === 'AUTO'} onClick={() => motor('ON')}>Motor ON</button>
              <button className="danger" disabled={busy || settings?.mode === 'AUTO'} onClick={() => motor('OFF')}>Motor OFF</button>
            </div>
            <table><tbody>
              <tr><td>Requested state</td><td>{lastReq ? <><b>{lastReq.desired_state}</b> <span className="muted small">by {lastReq.requested_by_email} {ago(lastReq.created_at)}</span></> : '—'}</td></tr>
              <tr><td>Request status</td><td>{lastReq ? <Badge colour={ACK[ackOf(lastReq)]}>{ackOf(lastReq).replace('_', ' ')}</Badge> : '—'}</td></tr>
              <tr><td>Hardware-confirmed state</td><td>{lastReq?.hardware_state || <span className="muted">not confirmed (no acknowledgement)</span>}</td></tr>
            </tbody></table>
          </>
        )}

        {mode === 'AUTO' && (
          <>
            <h3>Automatic thresholds (hysteresis)</h3>
            <Notice kind="warn"><b>NOT CALIBRATED.</b> These values are placeholders until the physical sump is measured. They are stored only and are not applied to the hardware in this stage.</Notice>
            <div className="form">
              <label>Reference height: sensor to sump floor (cm)<input type="number" min="1" step="0.1" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} /></label>
              <label>Pump ON when water level reaches (cm)<input type="number" min="0" step="0.1" value={form.high} onChange={(e) => setForm({ ...form, high: e.target.value })} /></label>
              <label>Pump OFF when water level falls to (cm)<input type="number" min="0" step="0.1" value={form.low} onChange={(e) => setForm({ ...form, low: e.target.value })} /></label>
              <button className="primary" disabled={busy} onClick={() => save('AUTO')}>Save automatic settings</button>
            </div>
          </>
        )}
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </Card>

      <Card wide title="Pump command history">
        {pumpCmds.length ? (
          <table>
            <thead><tr><th>#</th><th>Requested</th><th>By</th><th>When</th><th>Status</th><th>Hardware state</th><th>Acknowledged</th></tr></thead>
            <tbody>{pumpCmds.map((c) => (
              <tr key={c.id}><td>{c.id}</td><td>Motor {c.desired_state}</td><td>{c.requested_by_email}</td><td>{time(c.created_at)}</td>
                <td><Badge colour={ACK[ackOf(c)]}>{ackOf(c).replace('_', ' ')}</Badge></td><td>{c.hardware_state || '—'}</td><td>{c.acked_at ? time(c.acked_at) : '—'}</td></tr>
            ))}</tbody>
          </table>
        ) : <Empty>No pump requests yet.</Empty>}
      </Card>
    </div>
  )
}
