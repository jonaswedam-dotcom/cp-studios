import { BubbleIcon, ImageIcon, SendIcon, RemoveIcon } from './chatIcons'

// ── Helpers ────────────────────────────────────────────────
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDateLabel(ts) {
  const d   = new Date(ts)
  const now = new Date()
  const diffDays = Math.floor((now.setHours(0,0,0,0) - d.setHours(0,0,0,0)) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

export function isSameDay(a, b) {
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() === db.getFullYear() &&
         da.getMonth()    === db.getMonth()    &&
         da.getDate()     === db.getDate()
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

// ── ConversationThread (formerly ChatPanelBody) ────────────
export default function ConversationThread({
  messages, hasLoaded, typingNames, imagePreview,
  text, sending,
  onTextChange, onKeyDown, onSend, onImageFile, onClearImage, onMediaLoad,
  scrollRef, textareaRef, fileRef,
  userId,
  placeholder = 'Message everyone…',
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
            placeholder={placeholder}
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
