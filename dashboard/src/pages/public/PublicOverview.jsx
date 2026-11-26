import { Card, Kpi, Badge, Empty } from '../../components/ui'
import { RISK_COLOUR, SEV_COLOUR, ago } from '../../lib/format'

const BOT = import.meta.env.VITE_TELEGRAM_BOT || ''
const AFFECTED = ['Water rising', 'Waterlogging likely', 'Flooded']

export default function PublicOverview({ d, go }) {
  const dayAgo = Date.now() - 86400000
  const recent = d.alerts.filter((a) => new Date(a.created_at).getTime() > dayAgo)
  const affected = d.status.filter((n) => AFFECTED.includes(n.condition))
  const risky = d.roads.filter((r) => ['HIGH', 'CRITICAL'].includes(r.label))
  return (
    <>
      <section className="kpis">
        <Kpi label="Alerts in the last 24 h" value={recent.length} tone={recent.length ? 'warn' : ''} />
        <Kpi label="Drains with rising water" value={affected.length} tone={affected.length ? 'warn' : 'good'} />
        <Kpi label="High-risk roads" value={risky.length} tone={risky.length ? 'bad' : 'good'} />
        <Kpi label="Approved public reports" value={d.reports.length} />
      </section>
      <div className="grid">
        <Card title="Help keep roads safe" sub="no account needed">
          <p>Seen a pothole, a blocked drain or a flooded road? Send a photo. A city administrator reviews every report before it appears on the map.</p>
          <div className="btns">
            <button className="primary" onClick={() => go('report')}>📷 Report an issue</button>
            <button onClick={() => go('track')}>Track my report</button>
            <button onClick={() => go('alerts')}>Respond to an alert</button>
          </div>
          {BOT && <p className="muted small">Get alerts on Telegram: <a href={`https://t.me/${BOT}`} target="_blank" rel="noreferrer">t.me/{BOT}</a> — reply to any alert to tell us what you see.</p>}
        </Card>
        <Card title="Roads to avoid right now" actions={<button onClick={() => go('roads')}>All roads →</button>}>
          {affected.length || risky.length ? (
            <ul className="alerts">
              {affected.map((n) => <li key={n.id}><b>{n.name}</b> — {n.condition}{n.is_simulated && <span className="sim" style={{ marginLeft: 6 }}>SIMULATED</span>} <span className="muted">{ago(n.updated_at)}</span></li>)}
              {risky.map((r) => <li key={r.segment}><b>{r.name}</b> — <Badge colour={RISK_COLOUR[r.label]}>{r.label}</Badge> road damage risk</li>)}
            </ul>
          ) : <Empty>No affected roads reported right now.</Empty>}
        </Card>
        <Card wide title="Latest alerts" actions={<button onClick={() => go('alerts')}>Respond →</button>}>
          {d.alerts.length ? (
            <ul className="alerts">{d.alerts.slice(0, 6).map((a) => (
              <li key={a.id}><Badge colour={SEV_COLOUR[a.severity] || '#38bdf8'}>{a.severity || 'info'}</Badge>{' '}
                <span className="muted">{ago(a.created_at)}</span> {a.message}</li>
            ))}</ul>
          ) : <Empty>No alerts.</Empty>}
        </Card>
      </div>
    </>
  )
}
