import { useEffect, useRef, useState } from 'react'
import { isConfigured, supabase } from './supabase'
import { useAquaGrid } from './lib/useAquaGrid'
import { usePublicData } from './lib/usePublicData'
import { useRole } from './lib/useRole'
import { Loading, Notice } from './components/ui'
import Overview from './pages/Overview'
import LiveMap from './pages/LiveMap'
import Flood from './pages/Flood'
import Twin from './pages/Twin'
import DrainX from './pages/DrainX'
import RoadRisk from './pages/RoadRisk'
import Repairs from './pages/Repairs'
import Alerts from './pages/Alerts'
import Control from './pages/Control'
import Health from './pages/Health'
import SubmissionReview from './pages/admin/SubmissionReview'
import AlertResponses from './pages/admin/AlertResponses'
import PumpControl from './pages/admin/PumpControl'
import AdminLogin from './pages/admin/AdminLogin'
import PublicOverview from './pages/public/PublicOverview'
import RoadConditions from './pages/public/RoadConditions'
import PublicAlerts from './pages/public/PublicAlerts'
import ReportIssue from './pages/public/ReportIssue'
import TrackReport from './pages/public/TrackReport'

// Admin portal: the existing ten sections, unchanged, plus three admin-only sections
export const PAGES = [
  ['overview', 'Overview', Overview],
  ['map', 'Live Map', LiveMap],
  ['flood', 'Flood Monitoring', Flood],
  ['twin', 'Digital Twin', Twin],
  ['drainx', 'DrainX · Potholes', DrainX],
  ['risk', 'Road Risk', RoadRisk],
  ['repairs', 'Repairs', Repairs],
  ['alerts', 'Alerts', Alerts],
  ['control', 'Control Room', Control],
  ['health', 'System Health', Health],
  ['submissions', 'Submission Review', SubmissionReview],
  ['responses', 'Alert Responses', AlertResponses],
  ['pump', 'Pump Control', PumpControl],
]

// Public portal: public-facing information only
export const PUBLIC_PAGES = [
  ['overview', 'Overview', PublicOverview],
  ['map', 'Live Map', LiveMap],
  ['roads', 'Road Conditions', RoadConditions],
  ['alerts', 'Alerts', PublicAlerts],
  ['report', 'Report an Issue', ReportIssue],
  ['track', 'Track My Report', TrackReport],
]

// #/map = public portal · #admin/map = admin portal
function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '')
  if (h === 'admin' || h.startsWith('admin/')) return { portal: 'admin', page: h.split('/')[1] || 'overview' }
  return { portal: 'public', page: h || 'overview' }
}

function useToast(alerts) {
  const [toast, setToast] = useState(null)
  const lastAlert = useRef(null)
  useEffect(() => {
    const newest = alerts[0]
    if (!newest) return
    if (lastAlert.current !== null && newest.id > lastAlert.current) {
      setToast(newest)
      try { navigator.vibrate?.([200, 100, 200]) } catch { /* not supported */ }
      const t = setTimeout(() => setToast(null), 8000)
      lastAlert.current = newest.id
      return () => clearTimeout(t)
    }
    lastAlert.current = Math.max(lastAlert.current ?? 0, newest.id)
  }, [alerts])
  return [toast, setToast]
}

function Shell({ realtime, right, nav, children, toast, onToast, problems, problemHint }) {
  return (
    <div className="app">
      {toast && (
        <div className={'toast ' + (toast.severity || 'info')} role="alert" onClick={onToast}>⚠️ {toast.message}</div>
      )}
      <header>
        <div>
          <h1>AquaGrid <span className="sub">with DrainX road intelligence</span></h1>
          <p className="sub">Stormwater, flood forecasting, groundwater recharge and pothole monitoring · Bengaluru</p>
        </div>
        <div className="header-right">
          <span className={realtime === 'live' ? 'pill on' : 'pill'}>{realtime === 'live' ? '● LIVE' : `○ ${realtime}`}</span>
          {right}
        </div>
      </header>
      {nav}
      {problems?.length > 0 && <Notice kind="warn">Some data could not be loaded ({problems.length}). {problemHint}</Notice>}
      <main>{children}</main>
      <footer className="muted small">Simulated nodes and the illustrative flood model are labelled as such. Coordinates of nodes and road segments are approximate.</footer>
    </div>
  )
}

function Nav({ pages, page, go }) {
  return (
    <nav aria-label="Sections">
      {pages.map(([k, label]) => (
        <button key={k} className={k === page ? 'active' : ''} aria-current={k === page ? 'page' : undefined} onClick={() => go(k)}>{label}</button>
      ))}
    </nav>
  )
}

function AdminApp({ page, go, session, goPublic }) {
  const d = useAquaGrid()
  const [toast, setToast] = useToast(d.alerts)
  const entry = PAGES.find(([k]) => k === page) || PAGES[0]
  const Page = entry[2]
  return (
    <Shell realtime={d.realtime} toast={toast} onToast={() => setToast(null)} problems={page !== 'health' ? d.problems : []}
      problemHint="See System Health. Have database migrations 002 and 003 been run?"
      right={<span className="admin-badge">ADMIN · {session.user.email}
        <button onClick={goPublic}>Public view</button><button onClick={() => supabase.auth.signOut()}>Sign out</button></span>}
      nav={<Nav pages={PAGES} page={entry[0]} go={go} />}>
      {d.loading ? <Loading /> : <Page d={{ ...d, isAdmin: true }} go={go} />}
    </Shell>
  )
}

function PublicApp({ page, go, isAdmin, goAdmin }) {
  const p = usePublicData()
  const [toast, setToast] = useToast(p.alerts)
  const entry = PUBLIC_PAGES.find(([k]) => k === page) || PUBLIC_PAGES[0]
  const Page = entry[2]
  // the existing map component, fed with public-safe data only
  const mapData = { publicMode: true, nodes: p.status, latest: {}, potholes: p.potholes, roads: p.roads, reports: p.reports, repairs: [] }
  return (
    <Shell realtime={p.realtime} toast={toast} onToast={() => setToast(null)} problems={p.problems}
      problemHint="Please try again in a moment."
      right={<button className="admin-link" onClick={goAdmin}>{isAdmin ? 'Admin portal →' : 'Admin login'}</button>}
      nav={<Nav pages={PUBLIC_PAGES} page={entry[0]} go={go} />}>
      {p.loading ? <Loading /> : <Page d={entry[0] === 'map' ? mapData : p} go={go} />}
    </Shell>
  )
}

export default function App() {
  const [route, setRoute] = useState(parseHash)
  const role = useRole()

  useEffect(() => {
    const f = () => setRoute(parseHash())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  const goPublic = () => { window.location.hash = '/overview' }
  const goAdmin = () => { window.location.hash = 'admin' }

  if (!isConfigured) {
    return (
      <div className="app">
        <h1>AquaGrid</h1>
        <Notice kind="error">
          Supabase is not configured. Copy <code>dashboard/.env.example</code> to <code>dashboard/.env</code>, paste the
          Project URL and the <b>anon</b> key, then restart <code>npm run dev</code>.
        </Notice>
      </div>
    )
  }

  if (route.portal === 'admin') {
    if (role.session && role.isAdmin && !role.checking) {
      return <AdminApp page={route.page} session={role.session} goPublic={goPublic}
        go={(k) => { window.location.hash = `admin/${k}` }} />
    }
    return (
      <Shell realtime="admin" nav={null}>
        <AdminLogin session={role.session} isAdmin={role.isAdmin} checking={role.checking} goPublic={goPublic} />
      </Shell>
    )
  }
  return <PublicApp page={route.page} isAdmin={role.isAdmin} goAdmin={goAdmin} go={(k) => { window.location.hash = `/${k}` }} />
}
