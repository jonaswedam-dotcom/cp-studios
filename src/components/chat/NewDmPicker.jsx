import { useState, useEffect } from 'react'
import { listRecipients } from '../../lib/dm'
import { fallbackAvatar } from './chatHelpers'

export default function NewDmPicker({ onPick, onClose }) {
  const [recipients, setRecipients] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [query,      setQuery]      = useState('')

  useEffect(() => {
    listRecipients()
      .then(setRecipients)
      .catch(err => { console.error('DM recipients load failed:', err) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const filtered = query.trim()
    ? recipients.filter(r => r.full_name.toLowerCase().includes(query.trim().toLowerCase()))
    : recipients

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-in"
      onClick={onClose}
    >
      <div
        className="bg-cp-card border border-cp-border rounded-2xl w-full max-w-sm modal-in flex flex-col overflow-hidden"
        style={{ maxHeight: '28rem' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cp-border flex-none">
          <h2 className="text-sm font-medium text-cp-text">New message</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-cp-muted hover:text-cp-text hover:bg-cp-elevated transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="flex-none px-3 py-2 border-b border-cp-border">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name…"
            autoFocus
            className="w-full bg-cp-elevated border border-cp-border rounded-lg px-3 py-1.5 text-[13px] text-cp-text placeholder-cp-muted/40 outline-none focus:border-cp-accent transition-colors"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-4 h-4 border-2 border-cp-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <p className="text-cp-muted text-xs">
                {query ? 'No matching members.' : 'No members to message.'}
              </p>
            </div>
          ) : (
            filtered.map(r => (
              <button
                key={r.user_id}
                onClick={() => onPick(r.user_id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-cp-elevated transition-colors"
              >
                <img
                  src={r.avatar_url || fallbackAvatar(r.full_name)}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover flex-none"
                />
                <span className="text-[13px] text-cp-text truncate">{r.full_name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
