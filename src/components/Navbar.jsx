import { useState, useRef, useEffect, useCallback } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'

const ADMIN_VISIT_KEY = 'cp-studios:admin-last-visit'

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function LogOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, logout, updateCurrentUser } = useApp()

  const [isOpen,          setIsOpen]          = useState(false)
  const [draftName,       setDraftName]       = useState('')
  const [draftAvatar,     setDraftAvatar]     = useState('')
  const [avatarFile,      setAvatarFile]      = useState(null)
  const [saved,           setSaved]           = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [hasNewRequests,  setHasNewRequests]  = useState(false)

  const panelRef   = useRef(null)
  const triggerRef = useRef(null)
  const fileRef    = useRef(null)

  // Sync draft state when panel opens
  useEffect(() => {
    if (isOpen && currentUser) {
      setDraftName(currentUser.name)
      setDraftAvatar(currentUser.avatar)
      setAvatarFile(null)
      setSaved(false)
    }
  }, [isOpen, currentUser])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => {
      if (
        panelRef.current  && !panelRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  // ── Admin notification dot ────────────────────────────────
  const checkPendingRequests = useCallback(async () => {
    if (!currentUser?.isAdmin) return
    // Only count requests that arrived after the admin's last visit to /admin
    const lastVisit = localStorage.getItem(ADMIN_VISIT_KEY) || new Date(0).toISOString()
    const { count } = await supabase
      .from('pending_users')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .gt('created_at', lastVisit)
    setHasNewRequests((count ?? 0) > 0)
  }, [currentUser?.isAdmin])

  // Initial fetch + realtime subscription
  useEffect(() => {
    checkPendingRequests()
    if (!currentUser?.isAdmin) return

    const channel = supabase
      .channel('navbar-pending')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pending_users' },
        () => checkPendingRequests())
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [currentUser?.isAdmin, checkPendingRequests])

  // Clear dot when admin lands on /admin; stamp localStorage so only newer
  // requests will trigger the dot again
  useEffect(() => {
    if (location.pathname !== '/admin' || !currentUser?.isAdmin) return
    localStorage.setItem(ADMIN_VISIT_KEY, new Date().toISOString())
    setHasNewRequests(false)
  }, [location.pathname, currentUser?.isAdmin])

  const handleAvatarFile = (e) => {
    const file = e.target.files[0]
    if (file) {
      setAvatarFile(file)
      setDraftAvatar(URL.createObjectURL(file))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      let avatar_url = draftAvatar

      // If a new file was picked, upload to Storage first
      if (avatarFile && currentUser) {
        const ext  = avatarFile.name.split('.').pop()
        const path = `avatars/${currentUser.id}/${Date.now()}.${ext}`
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('cp-studios')
          .upload(path, avatarFile, { upsert: true })

        if (!uploadErr) {
          const { data: { publicUrl } } = supabase.storage
            .from('cp-studios')
            .getPublicUrl(uploadData.path)
          avatar_url = publicUrl
        }
      }

      await updateCurrentUser({ name: draftName.trim() || 'You', avatar_url })
      setSaved(true)
      setTimeout(() => setIsOpen(false), 700)
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    setIsOpen(false)
    await logout()
    navigate('/login')
  }

  if (!currentUser) return null

  return (
    <header className="fixed top-0 inset-x-0 z-40 h-16 bg-cp-bg/95 border-b border-cp-border backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">

        {/* Wordmark */}
        <Link to="/" className="font-display text-xl tracking-tight select-none">
          <span className="italic text-cp-accent">CP</span>
          <span className="font-light text-cp-text/90"> Studios</span>
        </Link>

        {/* Nav + avatar */}
        <div className="flex items-center gap-7">
          <nav className="flex items-center gap-6">
            {[
              { to: '/',       label: 'Home'                              },
              { to: '/create', label: 'Upload'                            },
              ...(currentUser.isAdmin
                ? [{ to: '/admin', label: 'Admin', badge: hasNewRequests }]
                : []),
            ].map(({ to, label, badge }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `text-sm font-medium transition-colors duration-150 ${
                    isActive ? 'text-cp-text' : 'text-cp-muted hover:text-cp-text'
                  }`
                }
              >
                {badge !== undefined ? (
                  <span className="relative inline-flex">
                    {label}
                    {badge && (
                      <span className="absolute -top-1 -right-2.5 w-2 h-2 rounded-full bg-cp-accent ring-2 ring-cp-bg" />
                    )}
                  </span>
                ) : label}
              </NavLink>
            ))}
          </nav>

          {/* Avatar trigger */}
          <div className="relative">
            <button
              ref={triggerRef}
              onClick={() => setIsOpen(o => !o)}
              className={`w-8 h-8 rounded-full overflow-hidden border transition-colors duration-150 ${
                isOpen ? 'border-cp-accent/60' : 'border-cp-border hover:border-cp-border-soft'
              }`}
            >
              <img src={currentUser.avatar} alt={currentUser.name} className="w-full h-full object-cover" />
            </button>

            {/* Dropdown panel */}
            {isOpen && (
              <div
                ref={panelRef}
                className="absolute top-full right-0 mt-3 w-72 bg-cp-card border border-cp-border rounded-2xl overflow-hidden z-50 modal-in shadow-xl shadow-black/40"
              >
                {/* Avatar picker */}
                <div className="flex flex-col items-center gap-2 pt-6 pb-5 px-5 border-b border-cp-border">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="relative w-16 h-16 rounded-full overflow-hidden border-2 border-cp-border hover:border-cp-accent/50 transition-colors group"
                  >
                    <img src={draftAvatar || currentUser.avatar} alt="avatar" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <CameraIcon />
                    </div>
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
                  <span className="text-xs text-cp-muted">Click photo to change</span>
                </div>

                {/* Fields */}
                <div className="px-5 py-4 space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-cp-muted uppercase tracking-wider">Username</label>
                    <input
                      type="text"
                      value={draftName}
                      onChange={e => setDraftName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSave()}
                      className="w-full bg-cp-elevated border border-cp-border rounded-xl px-3 py-2.5 text-cp-text text-sm focus:border-cp-border-soft transition-colors"
                    />
                  </div>

                  <div className="space-y-1 text-xs text-cp-muted/60">
                    <p>{currentUser.email}</p>
                  </div>

                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                      saved
                        ? 'bg-cp-elevated text-cp-muted border border-cp-border'
                        : 'bg-cp-accent hover:bg-cp-accent-hover text-cp-bg'
                    } disabled:opacity-60`}
                  >
                    {saving && <span className="w-3.5 h-3.5 border-2 border-cp-bg/40 border-t-cp-bg rounded-full animate-spin" />}
                    {saved ? 'Saved' : 'Save changes'}
                  </button>
                </div>

                {/* Logout */}
                <div className="px-5 pb-4">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm hover:text-cp-text hover:border-cp-border-soft transition-all duration-150"
                  >
                    <LogOutIcon />
                    Log out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
