import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabase'

// Loads the province graph (once) + live game state (regions/players/movements).
export function useWarData(userId) {
  const [graph, setGraph]         = useState(null)              // provinces.json
  const [regions, setRegions]     = useState({})               // region_id -> row
  const [players, setPlayers]     = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading]     = useState(true)
  const graphLoaded = useRef(false)

  // Province graph (static asset)
  useEffect(() => {
    if (graphLoaded.current) return
    graphLoaded.current = true
    fetch('/war/provinces.json').then(r => r.json()).then(setGraph).catch(e => console.error('graph load', e))
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const [rRes, pRes, mRes] = await Promise.all([
        supabase.from('war_regions').select('*'),
        supabase.from('war_players').select('*'),
        supabase.from('war_movements').select('*').eq('status', 'moving'),
      ])
      if (rRes.data) {
        const m = {}
        rRes.data.forEach(row => { m[row.region_id] = row })
        setRegions(m)
      }
      if (pRes.data) setPlayers(pRes.data)
      if (mRes.data) setMovements(mRes.data)
    } catch (e) {
      console.error('[useWarData] loadAll error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (userId) loadAll() }, [userId, loadAll])

  // Realtime
  useEffect(() => {
    if (!userId) return
    const ch = supabase.channel('war-rt-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_regions' }, payload => {
        const row = payload.new || payload.old
        if (!row) return
        setRegions(prev => {
          const next = { ...prev }
          if (payload.eventType === 'DELETE') delete next[row.region_id]
          else next[payload.new.region_id] = payload.new
          return next
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_players' }, payload => {
        setPlayers(prev => {
          const id = (payload.new || payload.old)?.user_id
          const filtered = prev.filter(p => p.user_id !== id)
          return payload.eventType === 'DELETE' ? filtered : [...filtered, payload.new]
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_movements' }, payload => {
        const m = payload.new || payload.old
        setMovements(prev => {
          const filtered = prev.filter(x => x.id !== m?.id)
          return payload.new?.status === 'moving' ? [...filtered, payload.new] : filtered
        })
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [userId])

  return { graph, regions, players, movements, loading, setRegions, loadAll }
}
