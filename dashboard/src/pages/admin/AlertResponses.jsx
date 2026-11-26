import { useState } from 'react'
import { Card, Empty, Badge } from '../../components/ui'
import { time } from '../../lib/format'

const V = { Unverified: '#64748b', Corroborated: '#16a34a', Conflicting: '#f97316', 'Requires Admin Review': '#dc2626' }

export default function AlertResponses({ d }) {
  const [f, setF] = useState('ALL')
  const alerts = Object.fromEntries(d.alerts.map((a) => [a.id, a]))
  const list = d.responses.filter((r) => f === 'ALL' || r.verification_status === f)
  return (
    <Card wide title="Public alert responses" sub="verification runs in public_portal_worker.py"
      actions={<select value={f} onChange={(e) => setF(e.target.value)} aria-label="Verification status">
        <option value="ALL">All</option>{Object.keys(V).map((k) => <option key={k}>{k}</option>)}
      </select>}>
      <p className="muted small">Responses are never labelled fake. “Requires Admin Review” means the report contradicts a real sensor or looks like repeated submissions. Simulated sensor data is not used as evidence.</p>
      {list.length ? (
        <div className="tablewrap"><table>
          <thead><tr><th>Time</th><th>Alert</th><th>Response</th><th>Observation</th><th>Source</th><th>Verification</th><th>Why</th></tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.id}>
              <td>{time(r.created_at)}</td>
              <td className="small">#{r.alert_id} {alerts[r.alert_id]?.message?.slice(0, 60) || ''}</td>
              <td>{r.response_type}</td><td className="small">{r.observation || '—'}{r.lat != null && <div className="muted">{r.lat.toFixed(4)}, {r.lng.toFixed(4)}</div>}</td>
              <td>{r.source}</td>
              <td><Badge colour={V[r.verification_status]}>{r.verification_status}</Badge>{r.verification_score != null && <div className="muted small">score {r.verification_score}</div>}</td>
              <td className="small">{(r.verification_reasons || []).join('; ') || '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty>No responses yet.</Empty>}
    </Card>
  )
}
