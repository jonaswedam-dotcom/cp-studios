import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'

// ── localStorage key ───────────────────────────────────────
const chatVisitKey = (uid) => `cp-studios:chat-last-visit:${uid}`

// ── Helpers ────────────────────────────────────────────────
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDateLabel(ts) {
  const d   = new Date(ts)
  const now = new Date()
  const diffDays = Math.floor((now.setHours(0,0,0,0) - d.setHours(0,0,0,0)) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

function isSameDay(a, b) {
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() === db.getFullYear() &&
         da.getMonth()    === db.getMonth()    &&
         da.getDate()     === db.getDate()
}

// ── Icons ──────────────────────────────────────────────────
function BubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4.5 h-4.5">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  )
}

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3 h-3">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
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
    <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-cp-muted/70">
      <span className="flex gap-0.5 items-end h-3">
        {[0,1,2].map(i => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-cp-muted/50 animate-bounce"
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
    <div className="flex items-center gap-2 my-3">
      <div className="flex-1 h-px bg-cp-border" />
      <span className="text-[10px] text-cp-muted/50 whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-cp-border" />
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────
function MessageBubble({ msg, isOwn, showName, onImageLoad }) {
  return (
    <div className={`flex flex-col gap-0.5 max-w-[80%] ${isOwn ? 'items-end self-end' : 'items-start self-start'}`}>
      {showName && !isOwn && (
        <span className="text-[10px] text-cp-muted px-1 font-medium">{msg.sender_name}</span>
      )}
      {msg.image_url && (
        <div className={`overflow-hidden rounded-xl border border-cp-border ${isOwn ? 'rounded-br-sm' : 'rounded-bl-sm'}`}>
          <img
            src={msg.image_url}
            alt="shared"
            onLoad={onImageLoad}
            className="max-w-[220px] max-h-48 object-cover block"
          />
        </div>
      )}
      {msg.content && (
        <div className={`
          px-3 py-2 rounded-xl text-[13px] leading-relaxed
          ${isOwn
            ? 'bg-cp-accent text-cp-bg rounded-br-sm'
            : 'bg-cp-elevated border border-cp-border text-cp-text rounded-bl-sm'
          }
        `}>
          {msg.content}
        </div>
      )}
      <span className="text-[9px] text-cp-muted/40 px-1">{formatTime(msg.created_at)}</span>
    </div>
  )
}

// ── Chat panel body (shared between desktop sidebar and mobile popup) ──────────
function ChatPanelBody({
  messages, hasLoaded, typingNames, imagePreview,
  text, sending,
  onTextChange, onKeyDown, onSend, onImageFile, onClearImage, onMediaLoad,
  scrollRef, textareaRef, fileRef,
  userId,
}) {
  return (
    <>
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1 scroll-smooth"
      >
        {!hasLoaded ? (
          <div className="flex items-center justify-center flex-1">
            <div className="w-4 h-4 border-2 border-cp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center py-8">
            <div className="w-10 h-10 rounded-full bg-cp-elevated border border-cp-border flex items-center justify-center">
              <BubbleIcon />
            </div>
            <p className="text-cp-muted text-xs mt-1">No messages yet.</p>
            <p className="text-cp-muted/50 text-[11px]">Be the first to say hello!</p>
          </div>
        ) : (
          messages.map((item, i) =>
            item.type === 'date' ? (
              <DateSeparator key={item.id} label={item.label} />
            ) : (
              <MessageBubble
                key={item.msg.id}
                msg={item.msg}
                isOwn={item.msg.user_id === userId}
                showName={item.showName}
                onImageLoad={onMediaLoad}
              />
            )
          )
        )}
      </div>

      <TypingIndicator names={typingNames} />

      {/* Image preview */}
      {imagePreview && (
        <div className="flex-none px-3 pb-1">
          <div className="relative inline-block">
            <img src={imagePreview} alt="preview" className="h-14 w-14 object-cover rounded-lg border border-cp-border" />
            <button
              onClick={onClearImage}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-cp-card border border-cp-border flex items-center justify-center text-cp-muted hover:text-red-400 transition-colors"
            >
              <RemoveIcon />
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="flex-none border-t border-cp-border bg-cp-bg/40 px-3 py-2.5">
        <div className="flex items-end gap-1.5 bg-cp-elevated border border-cp-border rounded-xl px-2.5 py-1.5">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex-none w-7 h-7 flex items-center justify-center text-cp-muted hover:text-cp-accent transition-colors mb-0.5"
          >
            <ImageIcon />
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImageFile} />

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={onTextChange}
            onKeyDown={onKeyDown}
            placeholder="Message everyone…"
            className="flex-1 bg-transparent text-cp-text text-[13px] placeholder-cp-muted/40 resize-none outline-none leading-relaxed py-1 min-h-[1.75rem] max-h-[6rem]"
          />

          <button
            onClick={onSend}
            disabled={sending || (!text.trim() && !imagePreview)}
            className="flex-none w-7 h-7 rounded-lg bg-cp-accent hover:bg-cp-accent-hover flex items-center justify-center text-cp-bg transition-colors mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending
              ? <span className="w-3 h-3 border-2 border-cp-bg/40 border-t-cp-bg rounded-full animate-spin" />
              : <SendIcon />
            }
          </button>
        </div>
        <p className="text-[9px] text-cp-muted/30 text-center mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </>
  )
}

// ── Main ChatBubble ────────────────────────────────────────
export default function ChatBubble() {
  const { currentUser, session, chatOpen, setChatOpen } = useApp()
  const userId = session?.user?.id

  const [messages,     setMessages]     = useState([])
  const [hasChatDot,   setHasChatDot]   = useState(false)
  const [text,         setText]         = useState('')
  const [imageFile,    setImageFile]    = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [sending,      setSending]      = useState(false)
  const [typingUsers,  setTypingUsers]  = useState({})

  const desktopScrollRef = useRef(null)
  const mobileScrollRef  = useRef(null)
  const textareaRef   = useRef(null)
  const fileRef       = useRef(null)
  const chatOpenRef   = useRef(chatOpen)
  const hasLoadedRef  = useRef(false)

  useEffect(() => { chatOpenRef.current = chatOpen }, [chatOpen])

  // ── Scroll helpers ─────────────────────────────────────────
  // The desktop sidebar and mobile popup are both always mounted; only one is
  // visible per breakpoint. Scroll whichever is laid out — the hidden one
  // reports scrollHeight 0, so scrolling it is a harmless no-op.
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    for (const el of [desktopScrollRef.current, mobileScrollRef.current]) {
      if (el && el.scrollHeight) el.scrollTo({ top: el.scrollHeight, behavior })
    }
  }, [])

  // ── Initial dot check ──────────────────────────────────────
  useEffect(() => {
    if (!userId) return
    const lastVisit = localStorage.getItem(chatVisitKey(userId)) || new Date(0).toISOString()
    supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .neq('user_id', userId)
      .gt('created_at', lastVisit)
      .then(({ count }) => setHasChatDot((count ?? 0) > 0))
  }, [userId])

  // ── Realtime: messages + typing broadcast ──────────────────
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('chat-bubble', { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMsg = payload.new
        setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
        if (!chatOpenRef.current && newMsg.user_id !== userId) setHasChatDot(true)
        if (chatOpenRef.current) requestAnimationFrame(() => scrollToBottom('smooth'))
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.userId === userId) return
        setTypingUsers(prev => ({ ...prev, [payload.userId]: { name: payload.name, ts: Date.now() } }))
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [userId, scrollToBottom])

  // ── Expire stale typing indicators ────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setTypingUsers(prev => {
        const now = Date.now()
        const next = { ...prev }
        let changed = false
        Object.keys(next).forEach(uid => {
          if (now - next[uid].ts > 3000) { delete next[uid]; changed = true }
        })
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // ── Open: fetch messages + mark read ──────────────────────
  useEffect(() => {
    if (!chatOpen || !userId) return
    localStorage.setItem(chatVisitKey(userId), new Date().toISOString())
    setHasChatDot(false)
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: true })
        .then(({ data }) => setMessages(data || []))
    }
  }, [chatOpen, userId])

  // ── Pin the view to the newest messages ───────────────────
  // Runs after the DOM commits, so scrollHeight already reflects the
  // rendered messages — fixes opening to an older scroll position.
  useLayoutEffect(() => {
    if (chatOpen) scrollToBottom('instant')
  }, [messages, chatOpen, scrollToBottom])

  // Images load after layout, growing the list and pushing the bottom
  // down; re-pin as each one finishes so we stay on the newest message.
  const handleMediaLoad = useCallback(() => {
    if (chatOpenRef.current) scrollToBottom('instant')
  }, [scrollToBottom])

  // ── Typing broadcast ───────────────────────────────────────
  const broadcastTyping = useCallback(() => {
    if (!currentUser || !userId) return
    const ch = supabase.channel('chat-bubble', { config: { broadcast: { self: false } } })
    ch.send({ type: 'broadcast', event: 'typing', payload: { userId, name: currentUser.name } })
  }, [userId, currentUser])

  const handleTextChange = (e) => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 100) + 'px'
    broadcastTyping()
  }

  // ── Image picker ───────────────────────────────────────────
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

  // ── Send ───────────────────────────────────────────────────
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
      const { data: newMsg, error } = await supabase
        .from('messages')
        .insert({
          user_id:     userId,
          sender_name: currentUser?.name || 'Unknown',
          ...(trimmed   && { content:   trimmed }),
          ...(image_url && { image_url: image_url }),
        })
        .select()
        .single()
      if (!error && newMsg) {
        setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
        requestAnimationFrame(() => scrollToBottom('smooth'))
        localStorage.setItem(chatVisitKey(userId), new Date().toISOString())
      }
      setText('')
      clearImage()
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } catch (err) {
      console.error('Send failed:', err)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // ── Build list items ───────────────────────────────────────
  const listItems = []
  messages.forEach((msg, i) => {
    const prev = messages[i - 1]
    if (!prev || !isSameDay(prev.created_at, msg.created_at)) {
      listItems.push({ type: 'date', id: `date-${msg.id}`, label: formatDateLabel(msg.created_at) })
    }
    const gap      = !prev || (new Date(msg.created_at) - new Date(prev.created_at)) > 5 * 60 * 1000
    const showName = !prev || prev.user_id !== msg.user_id || gap
    listItems.push({ type: 'message', msg, showName })
  })

  const typingNames = Object.values(typingUsers).map(u => u.name)

  if (!currentUser) return null

  const panelBodyProps = {
    messages: listItems,
    hasLoaded: hasLoadedRef.current,
    typingNames,
    imagePreview,
    text,
    sending,
    onTextChange: handleTextChange,
    onKeyDown:    handleKeyDown,
    onSend:       handleSend,
    onImageFile:  handleImageFile,
    onClearImage: clearImage,
    onMediaLoad:  handleMediaLoad,
    textareaRef,
    fileRef,
    userId,
  }

  return (
    <>
      {/* ════════════════════════════════════════════════════════════
          Desktop sidebar (lg+) — fixed right panel
          Slides in/out; collapse tab sticks out from left edge.
          When closed, translate-x-full pushes panel off-screen
          but the tab (-left-8) sits right at the viewport edge.
      ════════════════════════════════════════════════════════════ */}
      <div
        className={`
          hidden lg:flex
          fixed top-16 right-0 bottom-0 z-40
          w-[300px] flex-col
          bg-cp-card border-l border-cp-border
          transition-transform duration-300 ease-in-out
          ${chatOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Collapse / expand tab on the left edge */}
        <button
          onClick={() => setChatOpen(o => !o)}
          aria-label={chatOpen ? 'Close chat' : 'Open chat'}
          className="absolute -left-8 top-1/2 -translate-y-1/2 w-8 h-14
            bg-cp-card border border-r-0 border-cp-border rounded-l-xl
            flex flex-col items-center justify-center gap-1
            text-cp-muted hover:text-cp-text transition-colors z-50"
        >
          {chatOpen ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          {!chatOpen && hasChatDot && (
            <span className="w-2 h-2 rounded-full bg-red-500" />
          )}
        </button>

        {/* Panel header */}
        <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-cp-border bg-cp-bg/60">
          <div>
            <h2 className="font-display text-sm text-cp-text font-normal leading-tight">Group Chat</h2>
            <p className="text-[10px] text-cp-muted/60 mt-0.5">Everyone in CP Studios</p>
          </div>
          <button
            onClick={() => setChatOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-cp-muted hover:text-cp-text hover:bg-cp-elevated transition-colors"
          >
            <XIcon />
          </button>
        </div>

        {/* Chat body */}
        <ChatPanelBody {...panelBodyProps} scrollRef={desktopScrollRef} />
      </div>

      {/* ════════════════════════════════════════════════════════════
          Mobile floating bubble (< lg)
      ════════════════════════════════════════════════════════════ */}
      <div className="lg:hidden fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 pointer-events-none">

        {/* Popup */}
        <div
          className={`
            w-[350px] max-w-[calc(100vw-3rem)] h-[480px]
            bg-cp-card border border-cp-border rounded-2xl
            shadow-2xl shadow-black/60
            flex flex-col overflow-hidden
            transition-all duration-200 ease-out origin-bottom-right
            ${chatOpen
              ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
              : 'opacity-0 translate-y-3 scale-95 pointer-events-none'
            }
          `}
        >
          {/* Header */}
          <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-cp-border bg-cp-bg/60">
            <div>
              <h2 className="font-display text-sm text-cp-text font-normal leading-tight">Group Chat</h2>
              <p className="text-[10px] text-cp-muted/60 mt-0.5">Everyone in CP Studios</p>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-cp-muted hover:text-cp-text hover:bg-cp-elevated transition-colors"
            >
              <XIcon />
            </button>
          </div>

          <ChatPanelBody {...panelBodyProps} scrollRef={mobileScrollRef} />
        </div>

        {/* Floating button */}
        <button
          onClick={() => setChatOpen(o => !o)}
          className={`
            relative w-14 h-14 rounded-full
            flex items-center justify-center
            shadow-lg shadow-black/40
            transition-all duration-200
            pointer-events-auto
            ${chatOpen
              ? 'bg-cp-accent-hover text-cp-bg scale-95'
              : 'bg-cp-accent hover:bg-cp-accent-hover text-cp-bg hover:scale-105'
            }
          `}
          aria-label="Toggle chat"
        >
          <BubbleIcon />
          {hasChatDot && !chatOpen && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 ring-2 ring-cp-bg" />
          )}
        </button>
      </div>
    </>
  )
}
