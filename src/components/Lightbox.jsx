import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function ChevronIcon({ direction }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      {direction === 'left'
        ? <polyline points="15 18 9 12 15 6" />
        : <polyline points="9 18 15 12 9 6" />}
    </svg>
  )
}

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

export default function Lightbox({ photos, initialIndex, onToggleLike, onAddComment, onClose }) {
  const { currentUser } = useApp()

  const [idx,         setIdx]         = useState(initialIndex)
  const [isAnimating, setIsAnimating] = useState(false)
  const [comment,     setComment]     = useState('')

  const commentsEndRef  = useRef(null)
  const commentInputRef = useRef(null)

  const photo = photos[idx]

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape')     onClose()
      if (e.key === 'ArrowRight') setIdx(i => Math.min(i + 1, photos.length - 1))
      if (e.key === 'ArrowLeft')  setIdx(i => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photos.length, onClose])

  // Reset per-photo state when switching
  useEffect(() => {
    setIsAnimating(false)
    setComment('')
  }, [idx])

  // Scroll comments to bottom on new comment
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [photo?.comments?.length])

  const handleLike = () => {
    if (!photo) return
    onToggleLike?.(photo.id)
    setIsAnimating(true)
    setTimeout(() => setIsAnimating(false), 450)
  }

  const handleCommentSubmit = () => {
    const trimmed = comment.trim()
    if (!trimmed || !photo) return
    onAddComment?.(photo.id, trimmed)
    setComment('')
    commentInputRef.current?.focus()
  }

  const handleCommentKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCommentSubmit()
    }
  }

  if (!photo) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 backdrop-in"
      style={{ background: 'rgba(0,0,0,0.88)' }}
      onClick={onClose}
    >
      {/* Modal card */}
      <div
        className="relative flex flex-col md:flex-row w-full max-w-5xl bg-cp-card border border-cp-border rounded-2xl overflow-hidden modal-in"
        style={{ maxHeight: 'calc(100vh - 3rem)' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── LEFT: photo area ── */}
        <div className="relative flex-1 bg-[#080808] flex items-center justify-center min-h-[45vw] md:min-h-0">
          <img
            key={photo.id}
            src={photo.src}
            alt={photo.caption || 'Photo'}
            className="max-h-[55vh] md:max-h-[88vh] max-w-full object-contain modal-in"
          />

          {idx > 0 && (
            <button
              onClick={() => setIdx(i => i - 1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-xl bg-black/60 text-white/60 hover:text-white hover:bg-black/90 transition-all duration-150"
            >
              <ChevronIcon direction="left" />
            </button>
          )}

          {idx < photos.length - 1 && (
            <button
              onClick={() => setIdx(i => i + 1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-xl bg-black/60 text-white/60 hover:text-white hover:bg-black/90 transition-all duration-150"
            >
              <ChevronIcon direction="right" />
            </button>
          )}
        </div>

        {/* ── RIGHT: sidebar ── */}
        <div className="w-full md:w-[17rem] flex flex-col border-t md:border-t-0 md:border-l border-cp-border bg-cp-card flex-shrink-0">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-cp-border flex-shrink-0">
            <span className="text-xs text-cp-muted tabular-nums">
              {idx + 1} / {photos.length}
            </span>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl text-cp-muted hover:text-cp-text hover:bg-cp-elevated transition-all duration-150"
            >
              <XIcon />
            </button>
          </div>

          {/* Caption + like */}
          <div className="px-4 py-4 border-b border-cp-border flex-shrink-0 space-y-3">
            {photo.caption && (
              <p className="text-cp-text text-sm leading-relaxed">{photo.caption}</p>
            )}
            <button
              onClick={handleLike}
              className={`flex items-center gap-1.5 transition-colors duration-150 ${
                photo.liked ? 'text-cp-accent' : 'text-cp-muted hover:text-cp-text'
              }`}
            >
              <span className={isAnimating ? 'heart-pop inline-flex' : 'inline-flex'}>
                <HeartIcon filled={photo.liked} />
              </span>
              <span className="text-sm font-medium tabular-nums">{photo.likes}</span>
            </button>
          </div>

          {/* Comments list */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {photo.comments.length === 0 && (
              <p className="text-cp-muted/40 text-xs text-center pt-4">No comments yet.</p>
            )}
            {photo.comments.map((c) => (
              <div key={c.id} className="comment-in">
                <span className="text-xs text-cp-accent font-medium">{c.author}</span>
                <p className="text-xs text-cp-text/80 mt-0.5 leading-relaxed">{c.text}</p>
              </div>
            ))}
            <div ref={commentsEndRef} />
          </div>

          {/* Comment input */}
          <div className="px-4 py-3 border-t border-cp-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <input
                ref={commentInputRef}
                type="text"
                value={comment}
                onChange={e => setComment(e.target.value)}
                onKeyDown={handleCommentKey}
                placeholder="Add a comment..."
                className="flex-1 bg-cp-elevated border border-cp-border rounded-xl px-3 py-2 text-xs text-cp-text placeholder-cp-muted/40 focus:border-cp-border-soft transition-colors duration-150 min-w-0"
              />
              <button
                onClick={handleCommentSubmit}
                disabled={!comment.trim()}
                className="text-cp-accent disabled:text-cp-muted/25 transition-colors hover:text-cp-accent-hover flex-shrink-0"
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
