import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabase'
import { Card, Empty, Badge, Notice } from '../../components/ui'
import { time } from '../../lib/format'

const STATUS = { 'Pending Review': '#eab308', Approved: '#16a34a', Rejected: '#dc2626' }
const SEV = { Critical: '#dc2626', High: '#f97316', Medium: '#eab308', Low: '#22c55e' }
const LOC = { gps_browser: 'Phone GPS', gps_exif: 'Photo GPS (EXIF)', manual: 'Entered manually', none: 'Not provided' }

function PrivateImage({ path, alt }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let live = true
    if (!path) return
    supabase.storage.from('submissions').createSignedUrl(path, 600).then(({ data, error }) => {
      if (!live) return
      if (error) setErr(error.message); else setUrl(data.signedUrl)
    })
    return () => { live = false }
  }, [path])
  if (!path) return null
  if (err) return <span className="err small">Image unavailable: {err}</span>
  return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={alt} className="review-img" /></a> : <span className="muted small">loading image…</span>
}

function Submission({ s, assessment, history, duplicateOf }) {
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function act(action) {
    if (action === 'reject' && !note.trim()) return setErr('Add a review note explaining the rejection.')
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('review_submission', { p_id: s.id, p_action: action, p_note: note, p_public_message: msg || null })
    setBusy(false)
    if (error) setErr(error.message); else { setNote(''); setMsg('') }
  }

  return (
    <div className="ticket">
      <div className="ticket-head">
        <b className="mono">{s.tracking_id}</b>
        <Badge colour={STATUS[s.status]}>{s.status}</Badge>
        <span className="muted small">{s.category} · submitted {time(s.created_at)}</span>
        {s.possible_duplicate_of && <Badge colour="#a78bfa" outline>possible duplicate</Badge>}
      </div>
      <div className="review-grid">
        <div>
          <h3>Original image</h3>
          <PrivateImage path={s.image_path} alt={`Submission ${s.tracking_id}`} />
          {s.description && <p className="small">“{s.description}”</p>}
          <p className="small">Location: {s.lat != null ? `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}` : 'not available'} <span className="muted">({LOC[s.location_source] || s.location_source})</span>
            {s.lat != null && <> · <a href={`https://maps.google.com/?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">map</a></>}<br />
            Road segment: {s.segment || '—'}</p>
        </div>
        <div>
          <h3>Pothole Condition Assessment <span className="aitag">AI-generated</span></h3>
          {!assessment && <p className="muted small">{s.assessment_status === 'queued' || s.assessment_status === 'processing' ? 'Waiting for the assessment worker…' : 'No assessment.'}</p>}
          {assessment?.status === 'model_unavailable' && <Notice kind="warn">AI model unavailable — no assessment was generated. {assessment.error}</Notice>}
          {assessment?.status === 'failed' && <Notice kind="error">Assessment failed: {assessment.error}</Notice>}
          {assessment?.status === 'completed' && (
            <table><tbody>
              <tr><td>Detected issue</td><td>{assessment.detected_issue}</td></tr>
              <tr><td>Condition</td><td>{assessment.pothole_condition}</td></tr>
              <tr><td>Severity</td><td>{assessment.severity ? <Badge colour={SEV[assessment.severity]}>{assessment.severity}</Badge> : '—'}</td></tr>
              <tr><td>AI confidence</td><td>{assessment.confidence != null ? `${Math.round(assessment.confidence * 100)}%` : '—'}</td></tr>
              <tr><td>Potholes found</td><td>{assessment.boxes ?? 0}{assessment.box_area_pct != null && ` · largest covers ${assessment.box_area_pct}% of photo`}</td></tr>
              <tr><td>Model</td><td className="small">{assessment.model_version || '—'} · {time(assessment.created_at)}</td></tr>
            </tbody></table>
          )}
          {assessment?.annotated_path && <PrivateImage path={assessment.annotated_path} alt="AI annotated" />}
          <p className="muted small">AI output is advisory. Only the admin decision below publishes a report.</p>
          {duplicateOf && (
            <Notice kind="info">Possible duplicate of <b className="mono">{duplicateOf.tracking_id}</b> ({duplicateOf.status}) — score {s.duplicate_score}: {(s.duplicate_reasons || []).join('; ')}. Nothing was deleted.</Notice>
          )}
        </div>
      </div>
      <div className="row">
        <input style={{ flex: 2 }} placeholder="Review note (internal, required to reject)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Review note" />
        <input style={{ flex: 2 }} placeholder="Message shown to the reporter (optional)" value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Public message" />
      </div>
      <div className="btns">
        <button className="primary" disabled={busy || s.status === 'Approved'} onClick={() => act('approve')}>✓ Approve</button>
        <button className="danger" disabled={busy || s.status === 'Rejected'} onClick={() => act('reject')}>✕ Reject</button>
        <button disabled={busy || !note.trim()} onClick={() => act('note')}>Add note only</button>
      </div>
      {err && <Notice kind="error">{err}</Notice>}
      {history.length > 0 && (
        <details><summary className="small">Review history ({history.length})</summary>
          <ul className="small">{history.map((h) => <li key={h.id}>{time(h.created_at)} — {h.action} {h.old_status !== h.new_status && `${h.old_status} → ${h.new_status}`} by {h.admin_email}{h.note && `: “${h.note}”`}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

export default function SubmissionReview({ d }) {
  const [filter, setFilter] = useState('Pending Review')
  const latestAssessment = useMemo(() => {
    const m = {}
    ;[...d.assessments].sort((a, b) => a.id - b.id).forEach((a) => { m[a.submission_id] = a })
    return m
  }, [d.assessments])
  const byId = useMemo(() => Object.fromEntries(d.submissions.map((s) => [s.id, s])), [d.submissions])
  const list = d.submissions.filter((s) => filter === 'ALL' || s.status === filter)
  const counts = ['Pending Review', 'Approved', 'Rejected'].map((k) => `${k}: ${d.submissions.filter((s) => s.status === k).length}`).join(' · ')

  return (
    <Card wide title="Submission Review" sub={counts}
      actions={<select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status">
        <option>Pending Review</option><option>Approved</option><option>Rejected</option><option value="ALL">All</option>
      </select>}>
      {list.length ? list.map((s) => (
        <Submission key={s.id} s={s} assessment={latestAssessment[s.id]}
          history={d.reviews.filter((r) => r.submission_id === s.id).sort((a, b) => a.id - b.id)}
          duplicateOf={s.possible_duplicate_of ? byId[s.possible_duplicate_of] : null} />
      )) : <Empty>No submissions with status “{filter}”.</Empty>}
    </Card>
  )
}
