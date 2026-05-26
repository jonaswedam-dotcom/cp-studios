import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'

// ── Helpers ────────────────────────────────────────────────
function formatMsgTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDateLabel(ts) {
  const d    = new Date(ts)
  const now  = new Date()
  const diff = now.setHours(0,0,0,0) - d.setHours(0,0,0,0)
  if (diff === 0)               return 'Today'
  if (diff === 86400000)        return 'Yesterday'
  return new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

function isSameDay(a, b) {
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() === db.getFullYear() &&
         da.getMonth()    === db.getMonth()    &&
         da.getDate()     === db.getDate()
}

// ── Icons ──────────────────────────────────────────────────
function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

// ── Typing indicator ───────────────────────────────────────
function TypingIndicator({ names }) {
  if (!names.length) return null
  const label = names.length === 1
    ? `${names[0]} is typing`
    : names.length === 2
    ? `${names[0]} and ${names[1]} are typing`
    : 'Several people are typing'
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-cp-muted">
      <span className="flex gap-0.5 items-end h-3">
        {[0,1,2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-cp-muted/50 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s`, animationDuration: '1s' }}
          />
        ))}
      </span>
      <span>{label}…</span>
    </div>
  )
}

// ── Date separator ─────────────────────────────────────────
function DateSeparator({ label }) {
  return (
    <div className="flex items-center gap-3 my-4 px-4">
      <div className="flex-1 h-px bg-cp-border" />
      <span className="text-xs text-cp-muted/60 whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-cp-border" />
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────
function MessageBubble({ msg, isOwn, showName }) {
  return (
    <div className={`flex flex-col gap-0.5 max-w-[75%] ${isOwn ? 'items-end self-end' : 'items-start self-start'}`}>
      {showName && !isOwn && (
        <span className="text-xs text-cp-muted px-1">{msg.sender_name}</span>
      )}
      {msg.image_url && (
        <div className={`overflow-hidden rounded-2xl border border-cp-border ${isOwn ? 'rounded-br-sm' : 'rounded-bl-sm'}`}>
          <img
            src={msg.image_url}
            alt="shared"
            className="max-w-xs max-h-64 object-cover block"
          />
        </div>
      )}
      {msg.content && (
        <div className={`
          px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed
          ${isOwn
            ? 'bg-cp-accent text-cp-bg rounded-br-sm'
            : 'bg-cp-elevated border border-cp-border text-cp-text rounded-bl-sm'
          }
        `}>
          {msg.content}
        </div>
      )}
      <span className="text-[10px] text-cp-muted/50 px-1">{formatMsgTime(msg.created_at)}</span>
    </div>
  )
}

// ── Main ChatPage ──────────────────────────────────────────
export default function ChatPage() {
  const { session, currentUser } = useApp()
  const userId = session?.user?.id

  const [messages,     setMessages]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [text,         setText]         = useState('')
  const [imageFile,    setImageFile]    = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [sending,      setSending]      = useState(false)
  const [typingUsers,  setTypingUsers]  = useState({})   // { userId: { name, ts } }

  const scrollRef    = useRef(null)
  const textareaRef  = useRef(null)
  const fileRef      = useRef(null)
  const typingTimer  = useRef(null)
  const isNearBottom = useRef(true)

  // ── Scroll helpers ────────────────────────────────────────
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottom.current = distFromBottom < 120
  }

  // ── Fetch initial messages ────────────────────────────────
  useEffect(() => {
    if (!session) return

    supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessages(data || [])
        setLoading(false)
        requestAnimationFrame(() => scrollToBottom('instant'))
      })
  }, [session, scrollToBottom])

  // ── Realtime: new messages + typing broadcast ─────────────
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel('chat-room', { config: { broadcast: { self: false } } })
      // New message rows
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        setMessages(prev => {
          // Deduplicate by id
          if (prev.some(m => m.id === payload.new.id)) return prev
          return [...prev, payload.new]
        })
        if (isNearBottom.current) {
          requestAnimationFrame(() => scrollToBottom('smooth'))
        }
      })
      // Typing indicator via broadcast
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.userId === userId) return
        setTypingUsers(prev => ({ ...prev, [payload.userId]: { name: payload.name, ts: Date.now() } }))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId, scrollToBottom])

  // ── Expire stale typing indicators ───────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setTypingUsers(prev => {
        const next = { ...prev }
        let changed = false
        Object.keys(next).forEach(uid => {
          if (now - next[uid].ts > 3000) { delete next[uid]; changed = true }
        })
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const typingNames = Object.values(typingUsers).map(u => u.name)

  // ── Broadcast typing ──────────────────────────────────────
  const broadcastTyping = useCallback(() => {
    if (!currentUser) return
    const channel = supabase.channel('chat-room', { config: { broadcast: { self: false } } })
    channel.send({ type: 'broadcast', event: 'typing', payload: { userId, name: currentUser.name } })
  }, [userId, currentUser])

  const handleTextChange = (e) => {
    setText(e.target.value)
    // Auto-resize textarea
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
    // Broadcast typing (debounced)
    broadcastTyping()
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {}, 2500)
  }

  // ── Image picker ──────────────────────────────────────────
  const handleImageFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    e.target.value = ''
  }

  const clearImage = () => {
    setImageFile(null)
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview(null)
  }

  // ── Send ──────────────────────────────────────────────────
  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed && !imageFile) return
    if (sending) return
    setSending(true)

    try {
      let image_url = null

      if (imageFile) {
        const ext  = imageFile.name.split('.').pop()
        const path = `chat/${userId}/${Date.now()}.${ext}`
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('cp-studios')
          .upload(path, imageFile, { upsert: false })

        if (!uploadErr) {
          const { data: { publicUrl } } = supabase.storage
            .from('cp-studios')
            .getPublicUrl(uploadData.path)
          image_url = publicUrl
        }
      }

      const payload = {
        user_id:     userId,
        sender_name: currentUser?.name || 'Unknown',
        ...(trimmed   && { content:   trimmed }),
        ...(image_url && { image_url: image_url }),
      }

      const { data: newMsg, error } = await supabase
        .from('messages')
        .insert(payload)
        .select()
        .single()

      if (!error && newMsg) {
        // Optimistically add own message (realtime won't echo back self: false)
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev
          return [...prev, newMsg]
        })
        requestAnimationFrame(() => scrollToBottom('smooth'))
      }

      setText('')
      clearImage()
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } catch (err) {
      console.error('Send failed:', err)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Build grouped message list ────────────────────────────
  // Returns items with type 'date' | 'message' and grouping flags
  const listItems = []
  messages.forEach((msg, i) => {
    const prev = messages[i - 1]
    const next = messages[i + 1]

    // Date separator
    if (!prev || !isSameDay(prev.created_at, msg.created_at)) {
      listItems.push({ type: 'date', id: `date-${msg.id}`, label: formatDateLabel(msg.created_at) })
    }

    const gap      = !prev || (new Date(msg.created_at) - new Date(prev.created_at)) > 5 * 60 * 1000
    const showName = !prev || prev.user_id !== msg.user_id || gap

    listItems.push({ type: 'message', msg, showName })
  })

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">

      {/* Header */}
      <div className="flex-none px-6 py-4 border-b border-cp-border bg-cp-bg/95 backdrop-blur-sm">
        <h1 className="font-display text-xl text-cp-text font-normal">Group Chat</h1>
        <p className="text-xs text-cp-muted mt-0.5">Everyone in CP Studios</p>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-1"
      >
        {loading ? (
          <div className="flex items-center justify-center flex-1">
            <div className="w-5 h-5 border-2 border-cp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center">
            <div className="w-12 h-12 rounded-full bg-cp-elevated border border-cp-border flex items-center justify-center mb-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-cp-muted">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <p className="text-cp-muted text-sm">No messages yet.</p>
            <p className="text-cp-muted/60 text-xs">Be the first to say hello!</p>
          </div>
        ) : (
          listItems.map((item) =>
            item.type === 'date' ? (
              <DateSeparator key={item.id} label={item.label} />
            ) : (
              <MessageBubble
                key={item.msg.id}
                msg={item.msg}
                isOwn={item.msg.user_id === userId}
                showName={item.showName}
              />
            )
          )
        )}
      </div>

      {/* Typing indicator */}
      <TypingIndicator names={typingNames} />

      {/* Image preview */}
      {imagePreview && (
        <div className="flex-none px-4 pb-2">
          <div className="relative inline-block">
            <img src={imagePreview} alt="preview" className="h-20 w-20 object-cover rounded-xl border border-cp-border" />
            <button
              onClick={clearImage}
              className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-cp-card border border-cp-border flex items-center justify-center text-cp-muted hover:text-red-400 transition-colors"
            >
              <XIcon />
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="flex-none border-t border-cp-border bg-cp-bg px-4 py-3">
        <div className="flex items-end gap-2 bg-cp-elevated border border-cp-border rounded-2xl px-3 py-2">
          {/* Image picker */}
          <button
            onClick={() => fileRef.current?.click()}
            className="flex-none w-8 h-8 flex items-center justify-center text-cp-muted hover:text-cp-accent transition-colors mb-0.5"
          >
            <ImageIcon />
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder="Message everyone…"
            className="flex-1 bg-transparent text-cp-text text-sm placeholder-cp-muted/40 resize-none outline-none leading-relaxed py-1 min-h-[2rem] max-h-[7.5rem]"
          />

          {/* Send */}
          <button
            onClick={handleSend}
            disabled={sending || (!text.trim() && !imageFile)}
            className="flex-none w-8 h-8 rounded-xl bg-cp-accent hover:bg-cp-accent-hover flex items-center justify-center text-cp-bg transition-colors mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending
              ? <span className="w-3.5 h-3.5 border-2 border-cp-bg/40 border-t-cp-bg rounded-full animate-spin" />
              : <SendIcon />
            }
          </button>
        </div>
        <p className="text-[10px] text-cp-muted/40 text-center mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
