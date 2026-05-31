import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'
import ConversationThread, { formatDateLabel, isSameDay } from './chat/ConversationThread'
import { BubbleIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from './chat/chatIcons'

// ── localStorage key ───────────────────────────────────────
const chatVisitKey = (uid) => `cp-studios:chat-last-visit:${uid}`

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

  const [activeTab, setActiveTab] = useState('group')

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

        {/* Tab bar */}
        <div className="flex-none flex border-b border-cp-border">
          {['group', 'direct'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                activeTab === tab
                  ? 'text-cp-text border-b-2 border-cp-accent'
                  : 'text-cp-muted hover:text-cp-text'
              }`}
            >
              {tab === 'group' ? 'Group' : 'Direct'}
            </button>
          ))}
        </div>

        {/* Chat body */}
        <div className={activeTab === 'group' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
          <ConversationThread {...panelBodyProps} scrollRef={desktopScrollRef} />
        </div>
        {activeTab === 'direct' && (
          <div className="flex-1 flex items-center justify-center text-cp-muted text-xs">
            Direct messages — coming up
          </div>
        )}
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

          {/* Tab bar */}
          <div className="flex-none flex border-b border-cp-border">
            {['group', 'direct'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? 'text-cp-text border-b-2 border-cp-accent'
                    : 'text-cp-muted hover:text-cp-text'
                }`}
              >
                {tab === 'group' ? 'Group' : 'Direct'}
              </button>
            ))}
          </div>

          <div className={activeTab === 'group' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
            <ConversationThread {...panelBodyProps} scrollRef={mobileScrollRef} />
          </div>
          {activeTab === 'direct' && (
            <div className="flex-1 flex items-center justify-center text-cp-muted text-xs">
              Direct messages — coming up
            </div>
          )}
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
