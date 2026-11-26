// Anonymous browser session (no personal data) + the tracking IDs this device submitted.
const SESSION_KEY = 'aquagrid.session'
const REPORTS_KEY = 'aquagrid.myReports'

function randomId() {
  try { return crypto.randomUUID() } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` }
}

let memorySession = null
export function sessionId() {
  try {
    let s = localStorage.getItem(SESSION_KEY)
    if (!s) { s = randomId(); localStorage.setItem(SESSION_KEY, s) }
    return s
  } catch {
    memorySession = memorySession || randomId()   // storage blocked: keep it for this tab only
    return memorySession
  }
}

export function myReports() {
  try { return JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]') } catch { return [] }
}

export function rememberReport(trackingId) {
  try {
    const list = [trackingId, ...myReports().filter((t) => t !== trackingId)].slice(0, 20)
    localStorage.setItem(REPORTS_KEY, JSON.stringify(list))
  } catch { /* storage blocked - the user still sees the tracking ID on screen */ }
}
