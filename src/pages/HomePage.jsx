import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'
import { getStoragePath } from '../lib/storage'

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

function ConfirmModal({ profileName, onConfirm, onCancel, loading }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-in"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onCancel() }}
    >
      <div className="bg-cp-card border border-cp-border rounded-2xl p-6 w-full max-w-sm modal-in">
        <h3 className="font-display text-lg text-cp-text mb-2">Delete profile?</h3>
        <p className="text-cp-muted text-sm mb-6 leading-relaxed">
          Are you sure you want to delete{' '}
          <span className="text-cp-text font-medium">{profileName}</span>{' '}
          and all their photos? This cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text hover:border-cp-border-soft transition-all duration-150 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors duration-150 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && (
              <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function ProfileCard({ profile, isAdmin, hasUnread, onDeleteClick }) {
  return (
    <div className="relative group">
      <Link
        to={`/profile/${profile.id}`}
        className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-cp-border hover:border-cp-border-soft hover:bg-cp-card transition-all duration-200"
      >
        {/* Avatar with unread dot */}
        <div className="relative">
          <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-cp-border group-hover:border-cp-accent/40 transition-colors duration-200">
            <img
              src={profile.avatar}
              alt={profile.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
          {/* Unread indicator — bottom-right of avatar so it never conflicts with delete btn */}
          {hasUnread && (
            <span className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full bg-cp-accent ring-2 ring-cp-bg" />
          )}
        </div>

        <span className="font-display text-cp-text text-sm font-medium text-center leading-tight">
          {profile.name}
        </span>
      </Link>

      {/* Admin-only delete button — top-right of card, appears on hover */}
      {isAdmin && (
        <button
          onClick={(e) => { e.preventDefault(); onDeleteClick(profile) }}
          className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-lg bg-cp-elevated border border-cp-border text-cp-muted hover:text-red-400 hover:border-red-400/30 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all duration-150 z-10"
          title="Delete profile"
        >
          <TrashIcon />
        </button>
      )}
    </div>
  )
}

export default function HomePage() {
  const { profiles, currentUser, session, loadProfiles } = useApp()

  const [confirmTarget,   setConfirmTarget]   = useState(null)
  const [deleting,        setDeleting]        = useState(false)
  const [removingIds,     setRemovingIds]     = useState(new Set())
  // profileId -> latest photo timestamp (ms)
  const [latestByProfile, setLatestByProfile] = useState({})

  const isAdmin  = currentUser?.isAdmin
  const userId   = session?.user?.id

  // ── Fetch latest photo timestamp per profile ───────────────
  const fetchLatestPhotos = useCallback(async () => {
    const { data } = await supabase
      .from('photos')
      .select('profile_id, created_at')

    if (!data) return

    const map = {}
    data.forEach(p => {
      const t = new Date(p.created_at).getTime()
      if (!map[p.profile_id] || t > map[p.profile_id]) {
        map[p.profile_id] = t
      }
    })
    setLatestByProfile(map)
  }, [])

  useEffect(() => {
    if (!session) return
    fetchLatestPhotos()
  }, [session, fetchLatestPhotos])

  // ── Unread check ───────────────────────────────────────────
  const isUnread = (profileId) => {
    if (!userId) return false
    const latest = latestByProfile[profileId]
    if (!latest) return false
    const key       = `cp-studios:visited:${userId}:${profileId}`
    const lastVisit = localStorage.getItem(key)
    const lastMs    = lastVisit ? new Date(lastVisit).getTime() : 0
    return latest > lastMs
  }

  // ── Admin delete profile ───────────────────────────────────
  const handleDeleteConfirmed = async () => {
    if (!confirmTarget) return
    setDeleting(true)

    try {
      const { data: photos } = await supabase
        .from('photos')
        .select('image_url')
        .eq('profile_id', confirmTarget.id)

      if (photos?.length > 0) {
        const paths = photos.map(p => getStoragePath(p.image_url)).filter(Boolean)
        if (paths.length > 0) await supabase.storage.from('cp-studios').remove(paths)
      }

      const avatarPath = getStoragePath(confirmTarget.avatar)
      if (avatarPath) await supabase.storage.from('cp-studios').remove([avatarPath])

      await supabase.from('profiles').delete().eq('id', confirmTarget.id)

      setRemovingIds(prev => new Set([...prev, confirmTarget.id]))
      setTimeout(() => {
        loadProfiles()
        setRemovingIds(prev => { const s = new Set(prev); s.delete(confirmTarget.id); return s })
      }, 320)
    } catch (err) {
      console.error('Delete profile failed:', err)
    } finally {
      setDeleting(false)
      setConfirmTarget(null)
    }
  }

  return (
    <div className="page-in max-w-7xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="font-display text-3xl text-cp-text font-normal">View and Upload Photos</h1>
        <p className="text-cp-muted text-sm mt-1.5">Browse a profile to view or upload photos.</p>
      </div>

      {/* Profile grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {profiles.map((profile) => {
          const isRemoving = removingIds.has(profile.id)
          return (
            <div
              key={profile.id}
              className={`transition-all duration-300 ${
                isRemoving ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'
              }`}
            >
              <ProfileCard
                profile={profile}
                isAdmin={isAdmin}
                hasUnread={isUnread(profile.id)}
                onDeleteClick={setConfirmTarget}
              />
            </div>
          )
        })}

        {/* Add profile card */}
        <Link
          to="/create"
          className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-dashed border-cp-border hover:border-cp-border-soft hover:bg-cp-card transition-all duration-200 group"
        >
          <div className="w-20 h-20 rounded-full border-2 border-dashed border-cp-border group-hover:border-cp-accent/30 flex items-center justify-center transition-colors duration-200">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-6 h-6 text-cp-muted group-hover:text-cp-accent transition-colors duration-200">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <span className="text-cp-muted group-hover:text-cp-text text-sm text-center transition-colors duration-200">
            Add profile
          </span>
        </Link>
      </div>

      {/* Confirmation modal */}
      {confirmTarget && (
        <ConfirmModal
          profileName={confirmTarget.name}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => !deleting && setConfirmTarget(null)}
          loading={deleting}
        />
      )}
    </div>
  )
}
