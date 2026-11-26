import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { Card, Empty, Badge, Notice } from '../../components/ui'
import { time } from '../../lib/format'
import { myReports } from '../../lib/session'

const STATUS = { 'Pending Review': '#eab308', Approved: '#16a34a', Rejected: '#dc2626' }

export default function TrackReport() {
  const [id, setId] = useState('')
  const [result, setResult] = useState(null)
  const [err, setErr] = useState(null)
  const [mine, setMine] = useState([])

  async function lookup(tracking) {
    const { data, error } = await supabase.rpc('track_submission', { p_tracking_id: tracking })
    if (error) throw new Error(error.message)
    return data?.[0] || null
  }

  useEffect(() => {
    const ids = myReports()
    if (!ids.length || !supabase) return
    Promise.all(ids.map((t) => lookup(t).catch(() => null))).then((rows) => setMine(rows.filter(Boolean)))
  }, [])

  async function search(e) {
    e.preventDefault()
    setErr(null); setResult(null)
    try {
      const r = await lookup(id)
      if (!r) setErr('No report found with that tracking ID. Check the letters and numbers.')
      else setResult(r)
    } catch (x) { setErr(x.message) }
  }

  const Row = ({ r }) => (
    <tr><td className="mono">{r.tracking_id}</td><td>{r.category}</td><td><Badge colour={STATUS[r.status]}>{r.status}</Badge></td>
      <td>{time(r.submitted_at)}</td><td>{r.reviewed_at ? time(r.reviewed_at) : '—'}</td><td className="small">{r.public_message || '—'}</td></tr>
  )
  return (
    <div className="grid">
      <Card wide title="Track a report">
        <form className="row" onSubmit={search}>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="AQ-XXXX-XXXX-XXXX" aria-label="Tracking ID" required />
          <button className="primary">Check status</button>
        </form>
        {err && <Notice kind="error">{err}</Notice>}
        {result && <table><thead><tr><th>Tracking ID</th><th>Type</th><th>Status</th><th>Submitted</th><th>Reviewed</th><th>Message</th></tr></thead>
          <tbody><Row r={result} /></tbody></table>}
      </Card>
      <Card wide title="Reports from this device">
        {mine.length ? (
          <table><thead><tr><th>Tracking ID</th><th>Type</th><th>Status</th><th>Submitted</th><th>Reviewed</th><th>Message</th></tr></thead>
            <tbody>{mine.map((r) => <Row key={r.tracking_id} r={r} />)}</tbody></table>
        ) : <Empty>No reports sent from this device yet.</Empty>}
      </Card>
    </div>
  )
}
