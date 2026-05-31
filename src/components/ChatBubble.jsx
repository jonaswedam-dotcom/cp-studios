import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'
import ConversationThread, { formatDateLabel, isSameDay, buildListItems } from './chat/ConversationThread'
import ConversationList from './chat/ConversationList'
import NewDmPicker from './chat/NewDmPicker'
import { BubbleIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from './chat/chatIcons'
import {
  listThreads,
  getOrCreateThread,
  fetchThreadMessages,
  sendDirectMessage,
  uploadDmImage,
} from '../lib/dm'

// ── localStorage key ───────────────────────────────────────
const chatVisitKey = (uid) => `cp-studios:chat-last-visit:${uid}`

// ── Main ChatBubble ────────────────────────────────────────
export default function ChatBubble() {
  const { currentUser, session, chatOpen, setChatOpen } = useApp()
  const userId = session?.user?.id

  // ── Group chat state ───────────────────────────────────────
  const [messages,     setMessages]     = useState([])
  const [hasChatDot,   setHasChatDot]   = useState(false)
  const [text,         setText]         = useState('')
  const [imageFile,    setImageFile]    = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [sending,      setSending]      = useState(false)
  const [typingUsers,  setTypingUsers]  = useState({})

  // ── Tab + DM state ─────────────────────────────────────────
  const [activeTab,      setActiveTab]      = useState('group')
  const [threads,        setThreads]        = useState([])
  const [activeThreadId, setActiveThreadId] = useState(null)
  const [threadMessages, setThreadMessages] = useState({}) // { threadId: rawMessage[] }
  const [pickerOpen,     setPickerOpen]     = useState(false)

  const desktopScrollRef  = useRef(null)
  const mobileScrollRef   = useRef(null)
  const textareaRef       = useRef(null)
  const fileRef           = useRef(null)
  const chatOpenRef       = useRef(chatOpen)
  const hasLoadedRef      = useRef(false)
  const loadedThreadsRef  = useRef(new Set())

  useEffect(() => { chatOpenRef.current = chatOpen }, [chatOpen])

  // ── Scroll helpers ─────────────────────────────────────────
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

  // ── Load DM threads when panel opens or Direct tab is entered ──
  useEffect(() => {
    if (!chatOpen || !userId || activeTab !== 'direct') return
    listThreads().then(setThreads).catch(() => {})
  }, [chatOpen, activeTab, userId])

  // ── Pin group view to newest messages ──────────────────────
  useLayoutEffect(() => {
    if (chatOpen && activeTab === 'group') scrollToBottom('instant')
  }, [messages, chatOpen, activeTab, scrollToBottom])

  // ── Pin active DM thread to bottom ────────────────────────
  useLayoutEffect(() => {
    if (chatOpen && activeTab === 'direct' && activeThreadId) {
      scrollToBottom('instant')
    }
  }, [chatOpen, activeTab, activeThreadId, threadMessages, scrollToBottom])

  // Images load after layout — re-pin as each finishes
  const handleMediaLoad = useCallback(() => {
    if (chatOpenRef.current) scrollToBottom('instant')
  }, [scrollToBottom])

  // ── Typing broadcast (group only) ──────────────────────────
  const broadcastTyping = useCallback(() => {
    if (!currentUser || !userId) return
    const ch = supabase.channel('chat-bubble', { config: { broadcast: { self: false } } })
    ch.send({ type: 'broadcast', event: 'typing', payload: { userId, name: currentUser.name } })
  }, [userId, currentUser])

  // ── Shared input handlers ──────────────────────────────────
  const resizeTextarea = (el) => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 100) + 'px'
  }

  const handleTextChange = (e) => {
    setText(e.target.value)
    resizeTextarea(e.target)
    broadcastTyping()
  }

  // DM-specific text handler: resize but DON'T broadcast group typing
  const handleDmTextChange = (e) => {
    setText(e.target.value)
    resizeTextarea(e.target)
  }

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

  // ── Group send ─────────────────────────────────────────────
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

  // ── DM: open thread ────────────────────────────────────────
  const openThread = useCallback((threadId) => {
    setActiveThreadId(threadId)
    if (loadedThreadsRef.current.has(threadId)) return
    loadedThreadsRef.current.add(threadId)
    fetchThreadMessages(threadId)
      .then(msgs => setThreadMessages(p => ({ ...p, [threadId]: msgs })))
      .catch(err => { loadedThreadsRef.current.delete(threadId); console.error('fetchThreadMessages failed:', err) })
  }, [])

  // ── Tab switch: clear draft so group/DM drafts can't cross ──
  const switchTab = (tab) => {
    setActiveTab(tab)
    setText('')
    clearImage()
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  // ── DM: compose (open picker) ──────────────────────────────
  const handleCompose = () => setPickerOpen(true)

  const handlePickUser = async (pickedUserId) => {
    try {
      const threadId = await getOrCreateThread(pickedUserId)
      const fresh = await listThreads()
      setThreads(fresh)
      openThread(threadId)
    } catch (err) {
      console.error('getOrCreateThread failed:', err)
    }
    setPickerOpen(false)
  }

  // ── DM send ────────────────────────────────────────────────
  const dmSend = async () => {
    const trimmed = text.trim()
    if ((!trimmed && !imageFile) || sending) return
    setSending(true)
    try {
      let imageUrl = null
      if (imageFile) imageUrl = await uploadDmImage({ threadId: activeThreadId, file: imageFile })
      const row = await sendDirectMessage({
        threadId:   activeThreadId,
        senderId:   userId,
        senderName: currentUser?.name || 'Unknown',
        content:    trimmed || null,
        imageUrl,
      })
      setThreadMessages(prev => ({
        ...prev,
        [activeThreadId]: [
          ...(prev[activeThreadId] || []).filter(m => m.id !== row.id),
          row,
        ],
      }))
      setText('')
      clearImage()
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      listThreads().then(setThreads).catch(() => {})
    } catch (e) {
      console.error('DM send failed:', e)
    } finally {
      setSending(false)
    }
  }

  const dmHandleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dmSend() }
  }

  // ── Build list items ───────────────────────────────────────
  const listItems = buildListItems(messages)

  const typingNames = Object.values(typingUsers).map(u => u.name)

  // ── Active thread's other-person name ──────────────────────
  const activeThread = threads.find(t => t.thread_id === activeThreadId)
  const otherName    = activeThread?.other_name || 'them'

  if (!currentUser) return null

  const groupPanelBodyProps = {
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

  const dmPanelBodyProps = {
    messages:     buildListItems(threadMessages[activeThreadId] || []),
    hasLoaded:    !!threadMessages[activeThreadId],
    typingNames:  [],
    imagePreview,
    text,
    sending,
    onTextChange: handleDmTextChange,
    onKeyDown:    dmHandleKeyDown,
    onSend:       dmSend,
    onImageFile:  handleImageFile,
    onClearImage: clearImage,
    onMediaLoad:  handleMediaLoad,
    textareaRef,
    fileRef,
    userId,
    placeholder:  `Message ${otherName}…`,
  }

  // ── Direct tab body (shared between desktop & mobile) ─────
  // Render the back-header + thread or the conversation list.
  const renderDirectTab = (scrollRef) => {
    if (activeThreadId) {
      return (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Sub-header */}
          <div className="flex-none flex items-center gap-2 px-3 py-2 border-b border-cp-border">
            <button
              onClick={() => {
                setActiveThreadId(null)
                setText('')
                clearImage()
                if (textareaRef.current) textareaRef.current.style.height = 'auto'
              }}
              className="flex items-center gap-1 text-cp-muted hover:text-cp-text transition-colors text-[12px]"
              aria-label="Back to conversations"
            >
              <ChevronLeftIcon />
            </button>
            <span className="text-[13px] text-cp-text font-medium truncate">{otherName}</span>
          </div>
          <ConversationThread {...dmPanelBodyProps} scrollRef={scrollRef} />
        </div>
      )
    }

    return (
      <ConversationList
        threads={threads}
        activeThreadId={activeThreadId}
        onSelect={openThread}
        onCompose={handleCompose}
        unreadFor={() => false}
      />
    )
  }

  return (
    <>
      {/* ════════════════════════════════════════════════════════════
          Desktop sidebar (lg+) — fixed right panel
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
              onClick={() => switchTab(tab)}
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
          <ConversationThread {...groupPanelBodyProps} scrollRef={desktopScrollRef} />
        </div>
        {activeTab === 'direct' && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {renderDirectTab(desktopScrollRef)}
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
                onClick={() => switchTab(tab)}
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
            <ConversationThread {...groupPanelBodyProps} scrollRef={mobileScrollRef} />
          </div>
          {activeTab === 'direct' && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              {renderDirectTab(mobileScrollRef)}
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

      {/* DM picker modal */}
      {pickerOpen && (
        <NewDmPicker
          onPick={handlePickUser}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}
