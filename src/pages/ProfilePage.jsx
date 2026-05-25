import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'
import PhotoCard from '../components/PhotoCard'
import UploadModal from '../components/UploadModal'
import Lightbox from '../components/Lightbox'

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

// Normalise raw DB rows into the shape components expect
function buildPhotos(photoRows, likes, comments, currentUserId) {
  return photoRows.map(row => ({
    id:       row.id,
    src:      row.image_url,
    caption:  row.caption || '',
    liked:    likes.some(l => l.photo_id === row.id && l.user_id === currentUserId),
    likes:    likes.filter(l => l.photo_id === row.id).length,
    comments: comments
      .filter(c => c.photo_id === row.id)
      .map(c => ({ id: c.id, author: c.author_name || 'Unknown', text: c.content })),
  }))
}

export default function ProfilePage() {
  const { id }     = useParams()           // profile UUID
  const navigate   = useNavigate()
  const { profiles, session, currentUser } = useApp()

  const [photos,        setPhotos]        = useState([])
  const [photosLoading, setPhotosLoading] = useState(true)
  const [isUploadOpen,  setIsUploadOpen]  = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(null)

  const profile = profiles.find(p => p.id === id)

  // ── Fetch all photos + likes + comments for this profile ───
  const fetchPhotos = useCallback(async () => {
    if (!id || !session) return

    const { data: photoRows } = await supabase
      .from('photos')
      .select('*')
      .eq('profile_id', id)
      .order('created_at', { ascending: false })

    if (!photoRows || photoRows.length === 0) {
      setPhotos([])
      setPhotosLoading(false)
      return
    }

    const photoIds = photoRows.map(r => r.id)

    const [{ data: likes }, { data: comments }] = await Promise.all([
      supabase.from('likes').select('photo_id, user_id').in('photo_id', photoIds),
      supabase.from('comments_with_author').select('*').in('photo_id', photoIds).order('created_at', { ascending: true }),
    ])

    setPhotos(buildPhotos(photoRows, likes || [], comments || [], session.user.id))
    setPhotosLoading(false)
  }, [id, session])

  useEffect(() => {
    setPhotosLoading(true)
    fetchPhotos()
  }, [fetchPhotos])

  // ── Realtime subscriptions for likes & comments ────────────
  useEffect(() => {
    if (!id) return

    const channel = supabase
      .channel(`profile-rt-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'likes' },    () => fetchPhotos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => fetchPhotos())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [id, fetchPhotos])

  // ── Like / unlike (optimistic) ─────────────────────────────
  const toggleLike = async (photoId) => {
    const photo = photos.find(p => p.id === photoId)
    if (!photo) return

    // Optimistic update
    setPhotos(prev => prev.map(p => p.id !== photoId ? p : {
      ...p,
      liked: !p.liked,
      likes: p.liked ? p.likes - 1 : p.likes + 1,
    }))

    if (photo.liked) {
      await supabase.from('likes').delete()
        .eq('photo_id', photoId)
        .eq('user_id', session.user.id)
    } else {
      await supabase.from('likes').insert({ photo_id: photoId, user_id: session.user.id })
    }
  }

  // ── Add comment (optimistic) ───────────────────────────────
  const addComment = async (photoId, text) => {
    const tempId = `temp-${Date.now()}`
    setPhotos(prev => prev.map(p => p.id !== photoId ? p : {
      ...p,
      comments: [...p.comments, { id: tempId, author: currentUser?.name || 'You', text }],
    }))

    await supabase.from('comments').insert({
      photo_id: photoId,
      user_id:  session.user.id,
      content:  text,
    })
    // Realtime will fire and replace temp comment with real one
  }

  // ── Upload callback ────────────────────────────────────────
  const onPhotoUploaded = () => {
    setIsUploadOpen(false)
    fetchPhotos()
  }

  if (profiles.length > 0 && !profile) {
    return (
      <div className="page-in flex flex-col items-center justify-center h-96 gap-4">
        <p className="text-cp-muted">Profile not found.</p>
        <button onClick={() => navigate('/')} className="text-cp-accent text-sm hover:underline">
          Go home
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="page-in max-w-5xl mx-auto px-6 py-10">
        {/* Back */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-cp-muted hover:text-cp-text text-sm mb-10 transition-colors duration-150"
        >
          <ChevronLeftIcon />
          All profiles
        </button>

        {/* Profile header */}
        {profile && (
          <div className="flex flex-col items-center text-center mb-12 relative">
            <div className="w-28 h-28 rounded-full overflow-hidden border-2 border-cp-border mb-4">
              <img src={profile.avatar} alt={profile.name} className="w-full h-full object-cover" />
            </div>
            <h1 className="font-display text-3xl text-cp-text font-normal">{profile.name}</h1>
            {profile.bio && (
              <p className="text-cp-muted text-sm mt-2 max-w-xs leading-relaxed">{profile.bio}</p>
            )}
            <p className="text-cp-muted/50 text-xs mt-3">
              {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
            </p>

            {/* Upload button */}
            <button
              onClick={() => setIsUploadOpen(true)}
              className="absolute right-0 top-0 flex items-center gap-2 bg-cp-elevated border border-cp-border hover:border-cp-border-soft text-cp-text text-sm px-4 py-2.5 rounded-xl transition-all duration-150 hover:bg-cp-card"
            >
              <PlusIcon />
              Upload Photo
            </button>
          </div>
        )}

        {/* Photo grid */}
        {photosLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-cp-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 border border-dashed border-cp-border rounded-3xl">
            <p className="text-cp-muted text-sm">No photos yet.</p>
            <button onClick={() => setIsUploadOpen(true)} className="text-cp-accent text-sm hover:underline">
              Upload the first one
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {photos.map((photo, index) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                onToggleLike={toggleLike}
                onAddComment={addComment}
                onPhotoClick={() => setLightboxIndex(index)}
              />
            ))}
          </div>
        )}
      </div>

      {isUploadOpen && (
        <UploadModal
          profileId={id}
          onClose={() => setIsUploadOpen(false)}
          onUploaded={onPhotoUploaded}
        />
      )}

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          initialIndex={lightboxIndex}
          onToggleLike={toggleLike}
          onAddComment={addComment}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  )
}
