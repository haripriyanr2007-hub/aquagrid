import { Card, Empty, Badge, SimTag } from '../../components/ui'
import { RISK_COLOUR, ago } from '../../lib/format'

const COND = { Normal: '#22c55e', 'Water rising': '#eab308', 'Waterlogging likely': '#f97316', Flooded: '#dc2626', 'Sensor unavailable': '#64748b', 'No recent data': '#64748b' }
const ORDER = ['Flooded', 'Waterlogging likely', 'Water rising', 'Normal', 'Sensor unavailable', 'No recent data']

export default function RoadConditions({ d }) {
  const nodes = [...d.status].sort((a, b) => ORDER.indexOf(a.condition) - ORDER.indexOf(b.condition))
  const roads = [...d.roads].sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0))
  const risk = d.runs[0]?.details?.risk || {}
  const forecast = Object.values(risk).filter((r) => r.floods_in_min != null)
  return (
    <div className="grid">
      <Card wide title="Waterlogging by location" sub="from drain sensors · updated every few seconds">
        {nodes.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th>Location</th><th>Condition</th><th>Source</th><th>Updated</th></tr></thead>
            <tbody>{nodes.map((n) => (
              <tr key={n.id}><td>{n.name}</td><td><Badge colour={COND[n.condition] || '#64748b'}>{n.condition}</Badge></td>
                <td>{n.is_simulated ? <SimTag /> : 'drain sensor'}</td><td>{ago(n.updated_at)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No monitoring data available.</Empty>}
        <p className="muted small">SIMULATED locations demonstrate the city-wide view and are not real installations.</p>
      </Card>
      <Card title="Flood forecast" sub="computer model, illustrative">
        {forecast.length ? (
          <ul className="alerts">{forecast.map((r) => <li key={r.name}><b>{r.name}</b> may flood in about {r.floods_in_min} min</li>)}</ul>
        ) : <Empty>No flooding predicted in the latest forecast.</Empty>}
      </Card>
      <Card title="Road damage risk" sub="flooding + potholes">
        {roads.length ? (
          <table><tbody>{roads.map((r) => (
            <tr key={r.segment}><td>{r.name}</td><td><Badge colour={RISK_COLOUR[r.label]}>{r.label}</Badge></td></tr>
          ))}</tbody></table>
        ) : <Empty>No road-risk data yet.</Empty>}
      </Card>
    </div>
  )
}
