import { fallbackAvatar } from './chatHelpers'

function previewOf(t) {
  if (t.last_image_url && !t.last_content) return '📷 Photo'
  return t.last_content || 'No messages yet'
}

// ── Group Chat row icon ────────────────────────────────────
function GroupIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

// ── Compose icon ───────────────────────────────────────────
function ComposeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

// ── ConversationList ───────────────────────────────────────
// showGroupRow / groupHasUnread / onSelectGroup are used by the fullscreen two-pane rail (upcoming task).
export default function ConversationList({
  threads,
  activeThreadId,
  onSelect,
  onCompose,
  unreadFor,
  showGroupRow   = false,
  groupHasUnread = false,
  onSelectGroup,
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {/* Compose row */}
      <button
        onClick={onCompose}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-cp-elevated transition-colors border-b border-cp-border/50"
      >
        <span className="w-7 h-7 rounded-full bg-cp-elevated border border-cp-border flex items-center justify-center text-cp-accent flex-none">
          <ComposeIcon />
        </span>
        <span className="text-[13px] text-cp-accent font-medium">New message</span>
      </button>

      {/* Optional pinned Group Chat row */}
      {showGroupRow && (
        <button
          onClick={onSelectGroup}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-cp-elevated transition-colors border-b border-cp-border/50"
        >
          <span className="w-9 h-9 rounded-full bg-cp-elevated border border-cp-border flex items-center justify-center text-cp-muted flex-none">
            <GroupIcon />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-cp-text font-medium truncate">Group Chat</div>
            <div className="text-[11px] text-cp-muted truncate">Everyone in CP Studios</div>
          </div>
          {groupHasUnread && <span className="w-2 h-2 rounded-full bg-red-500 flex-none" />}
        </button>
      )}

      {/* Thread rows */}
      {threads.length === 0 && !showGroupRow ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 py-10 text-center px-4">
          <p className="text-cp-muted text-xs">No conversations yet.</p>
          <p className="text-cp-muted/50 text-[11px]">Hit "New message" to start a DM.</p>
        </div>
      ) : (
        threads.map(t => (
          <button
            key={t.thread_id}
            onClick={() => onSelect(t.thread_id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-cp-elevated transition-colors ${
              activeThreadId === t.thread_id ? 'bg-cp-elevated' : ''
            }`}
          >
            <img
              src={t.other_avatar || fallbackAvatar(t.other_name)}
              alt=""
              className="w-9 h-9 rounded-full object-cover flex-none"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-cp-text font-medium truncate">{t.other_name}</div>
              <div className="text-[11px] text-cp-muted truncate">{previewOf(t)}</div>
            </div>
            {unreadFor(t.thread_id) && <span className="w-2 h-2 rounded-full bg-red-500 flex-none" />}
          </button>
        ))
      )}
    </div>
  )
}
