import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function XSmallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3.5 h-3.5">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export default function AdminPage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()

  const [pendingUsers, setPendingUsers] = useState([])
  const [removingIds,  setRemovingIds]  = useState(new Set())
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')

  const fetchPending = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('pending_users')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) {
      setError('Could not load pending users.')
    } else {
      setPendingUsers(data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchPending() }, [fetchPending])

  const handleAction = async (user, action) => {
    const newStatus = action === 'approve' ? 'approved' : 'rejected'

    // Animate out
    setRemovingIds(prev => new Set([...prev, user.id]))

    setTimeout(async () => {
      const { error } = await supabase
        .from('pending_users')
        .update({ status: newStatus })
        .eq('id', user.id)

      if (error) {
        setError(`Failed to ${action} user.`)
        setRemovingIds(prev => { const s = new Set(prev); s.delete(user.id); return s })
        return
      }

      setPendingUsers(prev => prev.filter(u => u.id !== user.id))
      setRemovingIds(prev => { const s = new Set(prev); s.delete(user.id); return s })
    }, 320)
  }

  return (
    <div className="page-in max-w-3xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="font-display text-3xl text-cp-text font-normal">Pending Approvals</h1>
          <p className="text-cp-muted text-sm mt-1.5">Review signup requests from new members.</p>
        </div>
        {pendingUsers.length > 0 && (
          <span className="text-xs text-cp-muted bg-cp-elevated px-3 py-1.5 rounded-full border border-cp-border">
            {pendingUsers.length} pending
          </span>
        )}
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-28">
          <div className="w-6 h-6 border-2 border-cp-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : pendingUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-28 gap-3 border border-dashed border-cp-border rounded-3xl">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-cp-muted/50">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="text-cp-muted text-sm">All caught up, no pending requests.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {pendingUsers.map((user) => {
            const isRemoving = removingIds.has(user.id)
            return (
              <div
                key={user.id}
                className={`transition-all duration-300 ease-in-out ${
                  isRemoving ? 'opacity-0 translate-x-6 pointer-events-none' : 'opacity-100 translate-x-0'
                }`}
              >
                <div className="bg-cp-card border border-cp-border rounded-2xl p-4 flex items-center gap-4 hover:border-cp-border-soft transition-colors duration-150">
                  {/* Avatar initial */}
                  <div className="w-10 h-10 rounded-full bg-cp-elevated border border-cp-border flex items-center justify-center flex-shrink-0">
                    <span className="font-display text-cp-muted text-sm">
                      {(user.username || user.email || '?')[0].toUpperCase()}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-cp-text text-sm font-medium truncate">{user.username || '—'}</p>
                    <p className="text-cp-muted text-xs truncate">{user.email}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleAction(user, 'approve')}
                      className="flex items-center gap-1.5 text-xs font-medium text-cp-accent border border-cp-accent/25 hover:bg-cp-accent/10 hover:border-cp-accent/40 px-3 py-1.5 rounded-lg transition-all duration-150"
                    >
                      <CheckIcon />
                      Approve
                    </button>
                    <button
                      onClick={() => handleAction(user, 'reject')}
                      className="flex items-center gap-1.5 text-xs font-medium text-cp-muted border border-cp-border hover:border-cp-border-soft hover:text-cp-text px-3 py-1.5 rounded-lg transition-all duration-150"
                    >
                      <XSmallIcon />
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {pendingUsers.length > 0 && !loading && (
        <p className="text-xs text-cp-muted/50 text-center mt-8">
          Approved members will receive access. Rejected requests are removed.
        </p>
      )}
    </div>
  )
}
