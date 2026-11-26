import { useState } from 'react'
import { supabase } from '../../supabase'
import { Card, Empty, Badge, Notice } from '../../components/ui'
import { SEV_COLOUR, time } from '../../lib/format'
import { sessionId } from '../../lib/session'

const PUBLIC_KINDS = ['flood_forecast', 'road_risk', 'pothole', 'quality']
const OPTIONS = [
  ['flooding', 'Flooding on the road'], ['waterlogging', 'Water collecting / waterlogging'], ['no_flooding', 'No flooding here'],
  ['road_blocked', 'Road blocked'], ['pothole', 'Pothole / road damage'], ['other', 'Something else'],
]

function Respond({ alert }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('flooding')
  const [text, setText] = useState('')
  const [share, setShare] = useState(false)
  const [state, setState] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setState({ busy: true })
    let lat = null, lng = null
    if (share && navigator.geolocation) {
      const pos = await new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res(p), () => res(null), { timeout: 8000 }))
      if (pos) { lat = pos.coords.latitude; lng = pos.coords.longitude }
    }
    const { data, error } = await supabase.rpc('respond_to_alert', {
      p_alert_id: alert.id, p_response_type: type, p_observation: text, p_lat: lat, p_lng: lng, p_session: sessionId(),
    })
    setState(error ? { error: error.message } : { ok: `Thank you — recorded at ${new Date().toLocaleTimeString('en-IN')} (reference #${data}).` })
  }

  if (!open) return <button onClick={() => setOpen(true)}>Tell us what you see</button>
  if (state?.ok) return <Notice kind="info">{state.ok}</Notice>
  return (
    <form className="form respond" onSubmit={submit}>
      <fieldset>
        <legend>What do you see near this location?</legend>
        {OPTIONS.map(([k, l]) => <label key={k}><input type="radio" name={`r${alert.id}`} checked={type === k} onChange={() => setType(k)} /> {l}</label>)}
      </fieldset>
      <label>Details (optional)
        <textarea maxLength={500} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. water up to the ankle near the bus stop" />
      </label>
      <label className="inline"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share my current location with this response</label>
      <button className="primary" disabled={state?.busy}>{state?.busy ? 'Sending…' : 'Send response'}</button>
      {state?.error && <Notice kind="error">{state.error}</Notice>}
      <p className="muted small">No name or phone number is stored. Responses are compared with other reports and sensors.</p>
    </form>
  )
}

export default function PublicAlerts({ d }) {
  const list = d.alerts.filter((a) => PUBLIC_KINDS.includes(a.kind))
  return (
    <Card wide title="Alerts" sub="open an alert to report what you see">
      {list.length ? (
        <ul className="alerts">{list.map((a) => (
          <li key={a.id}>
            <Badge colour={SEV_COLOUR[a.severity] || '#38bdf8'}>{a.severity || 'info'}</Badge>{' '}
            <span className="muted">{time(a.created_at)}</span>
            <div className="pre">{a.message}</div>
            <Respond alert={a} />
          </li>
        ))}</ul>
      ) : <Empty>No alerts right now.</Empty>}
    </Card>
  )
}
