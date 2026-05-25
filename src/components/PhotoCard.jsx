import { useState, useRef } from 'react'

function HeartIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[14px] h-[14px]">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  )
}

// onDelete is only passed for admin users — non-admins never see the button
export default function PhotoCard({ photo, onToggleLike, onAddComment, onPhotoClick, onDelete }) {
  const [comment,     setComment]     = useState('')
  const [isAnimating, setIsAnimating] = useState(false)
  const inputRef = useRef(null)

  const handleLike = () => {
    onToggleLike?.(photo.id)
    setIsAnimating(true)
    setTimeout(() => setIsAnimating(false), 450)
  }

  const handleSubmit = () => {
    const trimmed = comment.trim()
    if (!trimmed) return
    onAddComment?.(photo.id, trimmed)
    setComment('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="bg-cp-card border border-cp-border rounded-2xl overflow-hidden hover:border-cp-border-soft transition-colors duration-200">
      {/* Photo */}
      <div
        className="relative aspect-[4/3] overflow-hidden bg-cp-elevated cursor-zoom-in group/photo"
        onClick={() => onPhotoClick?.()}
      >
        <img
          src={photo.src}
          alt={photo.caption || 'Photo'}
          className="w-full h-full object-cover hover:scale-[1.02] transition-transform duration-500"
          loading="lazy"
        />

        {/* Admin delete button — only rendered when onDelete is provided */}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(photo.id, photo.src) }}
            className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-lg bg-black/60 text-white/70 hover:text-red-400 hover:bg-black/85 opacity-0 group-hover/photo:opacity-100 transition-all duration-150"
            title="Delete photo"
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {photo.caption && (
          <p className="text-cp-text text-sm leading-relaxed">{photo.caption}</p>
        )}

        {/* Like */}
        <button
          onClick={handleLike}
          className={`flex items-center gap-1.5 transition-colors duration-150 ${
            photo.liked ? 'text-cp-accent' : 'text-cp-muted hover:text-cp-text'
          }`}
        >
          <span className={isAnimating ? 'heart-pop inline-flex' : 'inline-flex'}>
            <HeartIcon filled={photo.liked} />
          </span>
          <span className="text-xs font-medium tabular-nums">{photo.likes}</span>
        </button>

        {/* Comments */}
        <div className="space-y-2">
          {photo.comments.length > 0 && (
            <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
              {photo.comments.map((c) => (
                <div key={c.id} className="text-xs comment-in">
                  <span className="text-cp-accent font-medium">{c.author}</span>
                  <span className="text-cp-border-soft mx-1">·</span>
                  <span className="text-cp-text/80">{c.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Comment input */}
          <div className="flex items-center gap-2 pt-2 border-t border-cp-border">
            <input
              ref={inputRef}
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment..."
              className="flex-1 bg-transparent text-xs text-cp-text placeholder-cp-muted/40 py-0.5 focus:outline-none"
            />
            <button
              onClick={handleSubmit}
              disabled={!comment.trim()}
              className="text-cp-accent disabled:text-cp-muted/25 transition-colors hover:text-cp-accent-hover"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
