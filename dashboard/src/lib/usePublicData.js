import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'

// Public portal data: only safe views and public tables. Polls every 20 s; alerts are also live.
export function usePublicData() {
  const [data, setData] = useState({ status: [], roads: [], alerts: [], reports: [], potholes: [], runs: [] })
  const [loading, setLoading] = useState(true)
  const [problems, setProblems] = useState([])
  const [realtime, setRealtime] = useState('connecting')

  const load = useCallback(async () => {
    if (!supabase) return
    const p = []
    const get = async (promise, label) => {
      const { data: d, error } = await promise
      if (error) { p.push(`${label}: ${error.message}`); return [] }
      return d || []
    }
    const [status, roads, alerts, reports, potholes, runs] = await Promise.all([
      get(supabase.from('public_node_status').select('*'), 'node status (run migration 003)'),
      get(supabase.from('road_risk').select('segment,name,lat,lng,risk,label,flood_available,updated_at'), 'road risk'),
      get(supabase.from('alerts').select('id,kind,message,severity,segment,lat,lng,created_at').order('id', { ascending: false }).limit(60), 'alerts'),
      get(supabase.from('public_reports').select('*').order('approved_at', { ascending: false }).limit(300), 'public reports'),
      get(supabase.from('public_potholes').select('*').limit(300), 'confirmed potholes'),
      get(supabase.from('runs').select('id,scenario,created_at,details').order('id', { ascending: false }).limit(1), 'forecast'),
    ])
    setData({ status, roads, alerts, reports, potholes, runs })
    setProblems(p)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    load()
    const t = setInterval(load, 20000)
    const ch = supabase.channel('aquagrid-public')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' },
        ({ new: a }) => a && setData((d) => ({ ...d, alerts: [a, ...d.alerts].slice(0, 60) })))
      .subscribe((s) => setRealtime(s === 'SUBSCRIBED' ? 'live' : s.toLowerCase()))
    return () => { clearInterval(t); supabase.removeChannel(ch) }
  }, [load])

  return { ...data, loading, problems, realtime, reload: load }
}
