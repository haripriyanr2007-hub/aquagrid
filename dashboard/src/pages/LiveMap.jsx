import { useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, Tooltip as MapTip } from 'react-leaflet'
import { Card } from '../components/ui'
import {
  CENTER, LOCATION_TEXT, REASON_TEXT, RISK_COLOUR, SEV_COLOUR, ago, hasRealLocation, isSimulated, levelColour, pct, time,
} from '../lib/format'

const LAYERS = [
  ['real', 'Real node'], ['sim', 'Simulated nodes'], ['potholes', 'Potholes'], ['risk', 'Road risk'], ['repairs', 'Repair priority'],
  ['reports', 'Approved public reports'],
]
// public portal: road conditions only, no raw sensor numbers
const CONDITION_COLOUR = { Normal: '#22c55e', 'Water rising': '#eab308', 'Waterlogging likely': '#f97316', Flooded: '#dc2626', 'Sensor unavailable': '#64748b', 'No recent data': '#64748b' }
const REPORT_COLOUR = { Critical: '#dc2626', High: '#f97316', Medium: '#eab308', Low: '#22c55e' }

export default function LiveMap({ d }) {
  const pub = Boolean(d.publicMode)
  const layers = pub ? LAYERS.filter(([k]) => k !== 'repairs') : LAYERS
  const reports = (d.publicMode ? d.reports : d.publicReports || []).filter((r) => r.lat != null && r.lng != null)
  const [show, setShow] = useState({ real: true, sim: true, potholes: true, risk: true, repairs: false, reports: true })
  const [minSev, setMinSev] = useState('ALL')
  const located = pub ? d.potholes : d.potholes.filter(hasRealLocation)
  const sevOk = (p) => minSev === 'ALL' || (minSev === 'HIGH' ? p.severity === 'HIGH' : ['HIGH', 'MEDIUM'].includes(p.severity))
  const unlocated = d.potholes.length - located.length

  return (
    <Card wide title="Live map" sub={`${d.nodes.length} nodes · ${located.length} located potholes${reports.length ? ` · ${reports.length} public reports` : ''}`}>
      <div className="filters" role="group" aria-label="Map layers">
        {layers.map(([k, l]) => (
          <label key={k}><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {l}</label>
        ))}
        <label>Pothole severity:{' '}
          <select value={minSev} onChange={(e) => setMinSev(e.target.value)}>
            <option value="ALL">all</option><option value="MEDIUM">medium+</option><option value="HIGH">high only</option>
          </select>
        </label>
      </div>
      <div className="mapwrap">
        <MapContainer center={CENTER} zoom={12} style={{ height: 540, borderRadius: 12 }} scrollWheelZoom>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          {show.risk && d.roads.map((r) => (
            <Circle key={'r' + r.segment} center={[r.lat, r.lng]} radius={450}
              pathOptions={{ color: RISK_COLOUR[r.label], fillColor: RISK_COLOUR[r.label], fillOpacity: 0.14, weight: 2 }}>
              <Popup><b>{r.name}</b><br />Risk {(r.risk ?? 0).toFixed(2)} — {r.label}<br />
                Flood {r.flood_available === false ? 'no forecast' : pct(r.flood_score)} · Potholes {r.pothole_count}<br />
                <small>Approximate segment centre</small></Popup>
            </Circle>
          ))}

          {!pub && show.repairs && d.repairs.map((t) => (
            <CircleMarker key={'t' + t.segment} center={[t.lat, t.lng]} radius={18}
              pathOptions={{ color: '#a78bfa', weight: 2, fillOpacity: 0 }}>
              <MapTip permanent direction="top">#{t.priority_rank} {t.urgency}</MapTip>
            </CircleMarker>
          ))}

          {pub && d.nodes.map((n) => {
            const sim = n.is_simulated
            if ((sim && !show.sim) || (!sim && !show.real)) return null
            const col = CONDITION_COLOUR[n.condition] || '#64748b'
            return (
              <CircleMarker key={n.id} center={[n.lat, n.lng]} radius={sim ? 8 : 14}
                pathOptions={{ color: sim ? col : '#ffffff', fillColor: col, fillOpacity: sim ? 0.55 : 0.95, weight: sim ? 1.5 : 4, dashArray: sim ? '3 3' : null }}>
                <MapTip>{n.name}{sim ? ' (simulated)' : ''}</MapTip>
                <Popup><b>{n.name}</b> {sim ? <i>(SIMULATED – not a real installation)</i> : <i>(monitored drain)</i>}<br />
                  Road condition: <b>{n.condition}</b><br />Updated {ago(n.updated_at)}<br /><small>Location approximate</small></Popup>
              </CircleMarker>
            )
          })}

          {!pub && d.nodes.map((n) => {
            const r = d.latest[n.id]
            const sim = isSimulated(n, r)
            if ((sim && !show.sim) || (!sim && !show.real)) return null
            return (
              <CircleMarker key={n.id} center={[n.lat, n.lng]} radius={sim ? 8 : 14}
                pathOptions={{ color: sim ? levelColour(r) : '#ffffff', fillColor: levelColour(r), fillOpacity: sim ? 0.55 : 0.95,
                  weight: sim ? 1.5 : 4, dashArray: sim ? '3 3' : null }}>
                <MapTip>{n.name}{sim ? ' (simulated)' : ''}</MapTip>
                <Popup>
                  <b>{n.name}</b> {sim ? <i>(SIMULATED – not a real installation)</i> : <i>(real hardware)</i>}<br />
                  Water level: {r?.level_pct ?? '—'}% · Pit: {r?.pit_pct ?? '—'}%<br />
                  Gate: {r?.gate_open ? 'OPEN' : 'closed'} — {REASON_TEXT[r?.reason] || r?.reason || '—'}<br />
                  Last reading: {ago(r?.created_at)}<br />
                  <small>Coordinates approximate</small>
                </Popup>
              </CircleMarker>
            )
          })}

          {show.reports && reports.map((r) => (
            <CircleMarker key={'rep' + r.id} center={[r.lat, r.lng]} radius={7}
              pathOptions={{ color: '#ffffff', fillColor: REPORT_COLOUR[r.ai_severity] || '#a78bfa', fillOpacity: 0.95, weight: 2 }}>
              <Popup><b>Public report</b> · {r.category}<br />Approved {time(r.approved_at)}<br />
                {r.ai_severity ? `AI-assessed severity: ${r.ai_severity}` : 'No AI severity'}<br />
                <small>Reviewed and approved by an administrator</small></Popup>
            </CircleMarker>
          ))}

          {show.potholes && located.filter(sevOk).map((p) => (
            <CircleMarker key={'p' + p.id} center={[p.lat, p.lng]} radius={5}
              pathOptions={{ color: '#000', fillColor: SEV_COLOUR[p.severity] || '#111', fillOpacity: 1, weight: 1 }}>
              <Popup>
                <b>Pothole</b> · {p.severity || 'severity n/a'} · {Math.round((p.confidence || 0) * 100)}% confidence<br />
                {time(p.created_at)}<br />{pub ? 'Confirmed by the team' : <>Location: {LOCATION_TEXT[p.location_source]}<br />
                Status: {p.verification || 'unverified'}</>}
                {p.image_url && <><br /><a href={p.image_url} target="_blank" rel="noreferrer">View image</a></>}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
        <div className="legend" aria-label="Legend">
          <b>Legend</b>
          <div><span className="dot real" /> Real node (white ring)</div>
          <div><span className="dot sim" /> Simulated node (dashed)</div>
          <div><span className="sw" style={{ background: '#22c55e' }} /> &lt;35% <span className="sw" style={{ background: '#eab308' }} /> 35–60%
            <span className="sw" style={{ background: '#f97316' }} /> 60–85% <span className="sw" style={{ background: '#dc2626' }} /> &gt;85%</div>
          <div><span className="sw" style={{ background: '#a16207' }} /> Polluted water rejected</div>
          <div><span className="dot pot" /> Pothole (fill = severity)</div>
          <div><span className="dot rep" /> Approved public report</div>
          <div>Large circle = road-risk zone</div>
        </div>
      </div>
      {unlocated > 0 && (
        <p className="muted small">{unlocated} detection(s) have no verified location and are not plotted (see DrainX page). Positions are never invented.</p>
      )}
    </Card>
  )
}
