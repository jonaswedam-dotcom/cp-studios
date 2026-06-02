import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabase'

// Loads the province graph (once) + live game state (regions/players/movements).
export function useWarData(userId) {
  const [graph, setGraph]         = useState(null)              // provinces.json
  const [regions, setRegions]     = useState({})               // region_id -> row
  const [players, setPlayers]     = useState([])
  const [movements, setMovements] = useState([])
  const [buildings, setBuildings] = useState([])
  const [events, setEvents]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [graphError, setGraphError] = useState(null)
  const graphLoaded = useRef(false)

  // Province graph (static asset)
  useEffect(() => {
    if (graphLoaded.current) return
    graphLoaded.current = true
    fetch('/war/provinces.json')
      .then(r => { if (!r.ok) throw new Error(`provinces.json ${r.status}`); return r.json() })
      .then(setGraph)
      .catch(e => { console.error('graph load', e); setGraphError(e) })
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const [rRes, pRes, mRes, bRes] = await Promise.all([
        supabase.from('war_regions').select('*'),
        supabase.from('war_players').select('*'),
        supabase.from('war_movements').select('*').eq('status', 'moving'),
        supabase.from('war_buildings').select('*'),
      ])
      if (rRes.data) {
        const m = {}
        rRes.data.forEach(row => { m[row.region_id] = row })
        setRegions(m)
      }
      if (pRes.data) setPlayers(pRes.data)
      if (mRes.data) setMovements(mRes.data)
      if (bRes.data) setBuildings(bRes.data)
      supabase.from('war_events').select('*').eq('player_id', userId)
        .order('created_at', { ascending: false }).limit(50)
        .then(({ data }) => { if (data) setEvents(data) })
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
    // On DELETE, payload.new is {} and payload.old carries the PK — so always read the
    // affected row from payload.old for deletes (otherwise tick-deleted rows, e.g. a
    // captured level-1 building, would linger in local state until the next full reload).
    const ch = supabase.channel('war-rt-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_regions' }, payload => {
        const isDelete = payload.eventType === 'DELETE'
        const row = isDelete ? payload.old : payload.new
        if (!row?.region_id) return
        setRegions(prev => {
          const next = { ...prev }
          if (isDelete) delete next[row.region_id]
          else next[row.region_id] = row
          return next
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_players' }, payload => {
        const isDelete = payload.eventType === 'DELETE'
        const row = isDelete ? payload.old : payload.new
        const id = row?.user_id
        if (!id) return
        setPlayers(prev => {
          const filtered = prev.filter(p => p.user_id !== id)
          return isDelete ? filtered : [...filtered, row]
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_movements' }, payload => {
        const isDelete = payload.eventType === 'DELETE'
        const row = isDelete ? payload.old : payload.new
        const id = row?.id
        if (!id) return
        setMovements(prev => {
          const filtered = prev.filter(x => x.id !== id)
          return (!isDelete && row.status === 'moving') ? [...filtered, row] : filtered
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'war_buildings' }, payload => {
        const isDelete = payload.eventType === 'DELETE'
        const row = isDelete ? payload.old : payload.new
        const id = row?.id
        if (!id) return
        setBuildings(prev => {
          const filtered = prev.filter(x => x.id !== id)
          return isDelete ? filtered : [...filtered, row]
        })
      })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'war_events', filter: `player_id=eq.${userId}` },
        ({ new: row }) => setEvents((prev) => [row, ...prev].slice(0, 50)))
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [userId])

  return { graph, regions, players, movements, buildings, events, loading, graphError, setRegions, loadAll }
}
