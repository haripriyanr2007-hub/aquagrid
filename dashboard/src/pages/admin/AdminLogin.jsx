import { useState } from 'react'
import { supabase } from '../../supabase'
import { Card, Notice } from '../../components/ui'

// Email + password sign-in. Entering the admin portal additionally requires a row in admin_users,
// checked by the database function is_admin(); there is no public registration.
export default function AdminLogin({ session, isAdmin, checking, goPublic }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  async function signIn(e) {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setErr(error.message)
  }

  if (session && checking) return <Card title="Admin portal"><p>Checking admin role…</p></Card>
  if (session && !isAdmin) {
    return (
      <Card title="Admin portal">
        <Notice kind="error">The account <b>{session.user.email}</b> is signed in but has no admin role. Ask the project owner to add it to <code>admin_users</code>.</Notice>
        <div className="btns"><button onClick={() => supabase.auth.signOut()}>Sign out</button><button onClick={goPublic}>Back to public portal</button></div>
      </Card>
    )
  }
  return (
    <div className="login-wrap">
      <Card title="Admin login" sub="authorised staff only">
        <form className="form" onSubmit={signIn}>
          <label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {err && <Notice kind="error">{err}</Notice>}
        </form>
        <p className="muted small">Admin accounts are created in Supabase by the project owner. There is no sign-up.</p>
        <button onClick={goPublic}>← Public portal</button>
      </Card>
    </div>
  )
}
