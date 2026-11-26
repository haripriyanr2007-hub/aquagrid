import { useState } from 'react'
import { supabase } from '../../supabase'
import { Card, Notice } from '../../components/ui'
import { rememberReport, sessionId } from '../../lib/session'

const SEGMENTS = { '': 'Not sure', J1: 'HSR Layout 27th Main', J2: 'Silk Board Junction', J3: 'BTM Layout 2nd Stage', J4: 'Madiwala' }
const MAX_MB = 10

export default function ReportIssue({ go }) {
  const [file, setFile] = useState(null)
  const [category, setCategory] = useState('pothole')
  const [description, setDescription] = useState('')
  const [segment, setSegment] = useState('')
  const [loc, setLoc] = useState('gps')
  const [manual, setManual] = useState({ lat: '', lng: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)

  function pick(e) {
    const f = e.target.files?.[0]
    setErr(null)
    if (!f) return
    if (!f.type.startsWith('image/')) return setErr('Please choose a photo (JPG, PNG, WEBP or HEIC).')
    if (f.size > MAX_MB * 1024 * 1024) return setErr(`The photo is larger than ${MAX_MB} MB.`)
    setFile(f)
  }

  async function submit(e) {
    e.preventDefault()
    if (!file) return setErr('Add a photo first - take one with the camera or choose one from your gallery.')
    setBusy(true); setErr(null)
    let lat = null, lng = null, source = 'none'
    if (loc === 'gps') {
      const pos = await new Promise((res) => navigator.geolocation
        ? navigator.geolocation.getCurrentPosition((p) => res(p), () => res(null), { enableHighAccuracy: true, timeout: 10000 })
        : res(null))
      if (pos) { lat = pos.coords.latitude; lng = pos.coords.longitude; source = 'gps_browser' }
    } else if (loc === 'manual') {
      lat = parseFloat(manual.lat); lng = parseFloat(manual.lng)
      if (Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        setBusy(false); return setErr('Enter a valid latitude and longitude, or choose another location option.')
      }
      source = 'manual'
    }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const id = (() => { try { return crypto.randomUUID() } catch { return `${Date.now()}${Math.random().toString(36).slice(2)}` } })()
    const path = `incoming/${id}.${ext}`
    const up = await supabase.storage.from('submissions').upload(path, file, { contentType: file.type, upsert: false })
    if (up.error) { setBusy(false); return setErr(`Upload failed: ${up.error.message}`) }
    const { data, error } = await supabase.rpc('create_submission', {
      p_image_path: path, p_category: category, p_description: description, p_lat: lat, p_lng: lng,
      p_location_source: source, p_segment: segment, p_session: sessionId(),
    })
    setBusy(false)
    if (error) return setErr(error.message)
    rememberReport(data)
    setDone({ tracking: data, locationMissing: source === 'none' && loc === 'gps' })
  }

  if (done) {
    return (
      <Card wide title="Report received">
        <p className="headline">Your tracking ID: <b className="mono">{done.tracking}</b></p>
        <p>Status: <b>Pending Review</b>. An administrator checks every report before it is published on the map.</p>
        {done.locationMissing && <Notice kind="warn">We could not read your location. If your photo has GPS information it will still be used; otherwise the report is stored without coordinates.</Notice>}
        <p className="muted small">Save the tracking ID. It is also remembered on this device under “Track my report”.</p>
        <div className="btns"><button onClick={() => go('track')}>Track my report</button>
          <button onClick={() => { setDone(null); setFile(null); setDescription('') }}>Report another issue</button></div>
      </Card>
    )
  }

  return (
    <Card wide title="Report a pothole or drainage problem" sub="no account needed">
      <form className="form" onSubmit={submit}>
        <div className="photo-pick">
          <label className="pickbtn">📷 Take a photo
            <input type="file" accept="image/*" capture="environment" onChange={pick} />
          </label>
          <label className="pickbtn">🖼️ Choose from gallery
            <input type="file" accept="image/*" onChange={pick} />
          </label>
          {file && <span className="muted small">Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</span>}
        </div>
        <label>What is the problem?
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="pothole">Pothole / road damage</option><option value="drainage">Blocked or broken drain</option>
            <option value="waterlogging">Waterlogging / flooding</option><option value="other">Other</option>
          </select>
        </label>
        <label>Road (if you know it)
          <select value={segment} onChange={(e) => setSegment(e.target.value)}>
            {Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Description (optional)
          <textarea maxLength={1000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Where exactly, how big, since when…" />
        </label>
        <fieldset>
          <legend>Location</legend>
          <label><input type="radio" name="loc" checked={loc === 'gps'} onChange={() => setLoc('gps')} /> Use my current location (I am at the spot)</label>
          <label><input type="radio" name="loc" checked={loc === 'manual'} onChange={() => setLoc('manual')} /> Enter coordinates</label>
          <label><input type="radio" name="loc" checked={loc === 'none'} onChange={() => setLoc('none')} /> No location (photo GPS is used if present)</label>
          {loc === 'manual' && <div className="row">
            <input placeholder="latitude" value={manual.lat} onChange={(e) => setManual({ ...manual, lat: e.target.value })} aria-label="Latitude" />
            <input placeholder="longitude" value={manual.lng} onChange={(e) => setManual({ ...manual, lng: e.target.value })} aria-label="Longitude" />
          </div>}
        </fieldset>
        <button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Submit report'}</button>
        {err && <Notice kind="error">{err}</Notice>}
        <p className="muted small">Your photo is private until an administrator approves the report. No name or phone number is collected.</p>
      </form>
    </Card>
  )
}
