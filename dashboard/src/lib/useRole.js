import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

// Who is using the app: nobody / signed-in user / verified admin (checked by the database, not the UI)
export function useRole() {
  const [session, setSession] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!supabase) { setChecking(false); return }
    const check = async (s) => {
      setSession(s)
      if (!s) { setIsAdmin(false); setChecking(false); return }
      setChecking(true)
      const { data, error } = await supabase.rpc('is_admin')
      setIsAdmin(!error && data === true)
      setChecking(false)
    }
    supabase.auth.getSession().then(({ data }) => check(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { check(s) })
    return () => sub?.subscription?.unsubscribe()
  }, [])

  return { session, isAdmin, checking }
}
