import { useState, useRef, useEffect, useCallback } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'

const ADMIN_VISIT_KEY  = 'cp-studios:admin-last-visit'
const USERNAME_LIMIT   = 3

// ── Icons ──────────────────────────────────────────────────
function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
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

function DiceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <rect x="2" y="2" width="20" height="20" rx="3" ry="3"/>
      <circle cx="8"  cy="8"  r="1.2" fill="currentColor" stroke="none"/>
      <circle cx="16" cy="8"  r="1.2" fill="currentColor" stroke="none"/>
      <circle cx="8"  cy="16" r="1.2" fill="currentColor" stroke="none"/>
      <circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none"/>
    </svg>
  )
}

function SwordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>
      <line x1="13" y1="19" x2="19" y2="13"/>
      <line x1="16" y1="16" x2="20" y2="20"/>
      <line x1="19" y1="21" x2="21" y2="19"/>
    </svg>
  )
}

function CheckSmallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

// ── Helpers ────────────────────────────────────────────────
function since24h() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
}

// ── Component ──────────────────────────────────────────────
export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, logout, updateCurrentUser, chatOpen, setChatOpen } = useApp()

  // ── Panel open state ──────────────────────────────────────
  const [isOpen,  setIsOpen]  = useState(false)

  // ── Avatar ────────────────────────────────────────────────
  const [draftAvatar,  setDraftAvatar]  = useState('')
  const [avatarFile,   setAvatarFile]   = useState(null)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [avatarSaved,  setAvatarSaved]  = useState(false)

  // ── Username ──────────────────────────────────────────────
  const [editingName,    setEditingName]    = useState(false)
  const [nameDraft,      setNameDraft]      = useState('')
  const [nameSaving,     setNameSaving]     = useState(false)
  const [nameError,      setNameError]      = useState('')
  const [nameSaved,      setNameSaved]      = useState(false)
  const [changesUsed,    setChangesUsed]    = useState(0)
  const [changesLoading, setChangesLoading] = useState(false)

  // ── Admin dot ─────────────────────────────────────────────
  const [hasNewRequests, setHasNewRequests] = useState(false)

  const panelRef   = useRef(null)
  const triggerRef = useRef(null)
  const fileRef    = useRef(null)
  const nameInputRef = useRef(null)

  // ── Fetch how many changes this user made in the last 24 h ─
  const fetchChangesUsed = useCallback(async () => {
    if (!currentUser?.id) return
    setChangesLoading(true)
    const { count } = await supabase
      .from('username_changes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', currentUser.id)
      .gte('changed_at', since24h())
    setChangesUsed(count ?? 0)
    setChangesLoading(false)
  }, [currentUser?.id])

  // ── Reset all draft state when panel opens ─────────────────
  useEffect(() => {
    if (isOpen && currentUser) {
      setDraftAvatar(currentUser.avatar)
      setAvatarFile(null)
      setAvatarSaving(false)
      setAvatarSaved(false)
      setEditingName(false)
      setNameDraft(currentUser.name)
      setNameError('')
      setNameSaved(false)
      fetchChangesUsed()
    }
  }, [isOpen, currentUser, fetchChangesUsed])

  // ── Close on outside click ────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => {
      if (
        panelRef.current   && !panelRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  // ── Admin notification dot ────────────────────────────────
  const checkPendingRequests = useCallback(async () => {
    if (!currentUser?.isAdmin) return
    const lastVisit = localStorage.getItem(ADMIN_VISIT_KEY) || new Date(0).toISOString()
    const { count } = await supabase
      .from('pending_users')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .gt('created_at', lastVisit)
    setHasNewRequests((count ?? 0) > 0)
  }, [currentUser?.isAdmin])

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

  useEffect(() => {
    if (location.pathname !== '/admin' || !currentUser?.isAdmin) return
    localStorage.setItem(ADMIN_VISIT_KEY, new Date().toISOString())
    setHasNewRequests(false)
  }, [location.pathname, currentUser?.isAdmin])

  // ── Avatar handlers ───────────────────────────────────────
  const handleAvatarFile = (e) => {
    const file = e.target.files[0]
    if (file) {
      setAvatarFile(file)
      setDraftAvatar(URL.createObjectURL(file))
      setAvatarSaved(false)
    }
  }

  const handleSaveAvatar = async () => {
    if (!avatarFile || avatarSaving) return
    setAvatarSaving(true)
    try {
      const ext  = avatarFile.name.split('.').pop()
      const path = `avatars/${currentUser.id}/${Date.now()}.${ext}`
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('cp-studios')
        .upload(path, avatarFile, { upsert: true })

      if (!uploadErr) {
        const { data: { publicUrl } } = supabase.storage
          .from('cp-studios')
          .getPublicUrl(uploadData.path)
        await updateCurrentUser({ name: currentUser.name, avatar_url: publicUrl })
      }
      setAvatarFile(null)
      setAvatarSaved(true)
      setTimeout(() => { setAvatarSaved(false); setIsOpen(false) }, 800)
    } catch (err) {
      console.error('Avatar save failed:', err)
    } finally {
      setAvatarSaving(false)
    }
  }

  // ── Username handlers ─────────────────────────────────────
  const handleStartEditName = () => {
    setNameDraft(currentUser.name)
    setNameError('')
    setNameSaved(false)
    setEditingName(true)
    // Focus input on next tick
    setTimeout(() => nameInputRef.current?.focus(), 30)
  }

  const handleCancelEditName = () => {
    setEditingName(false)
    setNameError('')
  }

  const handleSaveName = async () => {
    const trimmed = nameDraft.trim()
    if (!trimmed) return
    // No change — silently exit edit mode
    if (trimmed === currentUser.name) {
      setEditingName(false)
      return
    }

    setNameSaving(true)
    setNameError('')
    try {
      // Re-query count right before saving to guard against races
      const { count } = await supabase
        .from('username_changes')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', currentUser.id)
        .gte('changed_at', since24h())

      const used = count ?? 0

      if (used >= USERNAME_LIMIT) {
        setChangesUsed(USERNAME_LIMIT)
        setNameError('You can only change your username 3 times per day. Please try again tomorrow.')
        return
      }

      // Check for a conflicting profile name (case-insensitive)
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .ilike('full_name', trimmed)
        .limit(1)
        .maybeSingle()

      if (existing) {
        setNameError('That username is already taken — please choose a different one.')
        return
      }

      // Save to auth metadata (triggers onAuthStateChange → currentUser updates everywhere)
      await updateCurrentUser({ name: trimmed, avatar_url: currentUser.avatar })

      // Mirror the new name into wallets.display_name so the leaderboard and
      // Send-Coins modal show the updated name without any profiles join.
      await supabase
        .from('wallets')
        .update({ display_name: trimmed })
        .eq('user_id', currentUser.id)

      // Record the change
      await supabase.from('username_changes').insert({ user_id: currentUser.id })

      setChangesUsed(used + 1)
      setEditingName(false)
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 3500)
    } catch (err) {
      console.error('Username save failed:', err)
      setNameError('Failed to save. Please try again.')
    } finally {
      setNameSaving(false)
    }
  }

  const handleNameKeyDown = (e) => {
    if (e.key === 'Enter')  handleSaveName()
    if (e.key === 'Escape') handleCancelEditName()
  }

  const handleLogout = async () => {
    setIsOpen(false)
    await logout()
    navigate('/login')
  }

  if (!currentUser) return null

  const remaining = Math.max(0, USERNAME_LIMIT - changesUsed)
  const atLimit   = remaining === 0

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
            {/* War */}
            <NavLink
              to="/war"
              className={({ isActive }) =>
                `text-sm font-medium transition-colors duration-150 flex items-center gap-1.5 ${
                  isActive ? 'text-red-400' : 'text-red-400/60 hover:text-red-400'
                }`
              }
            >
              <SwordIcon />
              War
            </NavLink>

            {[
              { to: '/',        label: 'Home',   icon: null                          },
              { to: '/casino',  label: 'Casino', icon: <DiceIcon />                  },
              ...(currentUser.isAdmin
                ? [{ to: '/admin', label: 'Admin', badge: hasNewRequests, icon: null }]
                : []),
            ].map(({ to, label, badge, icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `text-sm font-medium transition-colors duration-150 flex items-center gap-1.5 ${
                    isActive
                      ? to === '/casino' ? 'text-amber-400' : 'text-cp-text'
                      : to === '/casino' ? 'text-amber-400/60 hover:text-amber-400'
                        : 'text-cp-muted hover:text-cp-text'
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
                ) : (
                  <>
                    {icon}
                    {label}
                  </>
                )}
              </NavLink>
            ))}

            {/* Chat — toggles the group-chat panel (same panel as the right-edge tab) */}
            <button
              onClick={() => setChatOpen(o => !o)}
              className={`text-sm font-medium transition-colors duration-150 flex items-center gap-1.5 ${
                chatOpen ? 'text-cp-text' : 'text-cp-muted hover:text-cp-text'
              }`}
            >
              <ChatIcon />
              Chat
            </button>
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

            {/* ── Dropdown panel ─────────────────────────────── */}
            {isOpen && (
              <div
                ref={panelRef}
                className="absolute top-full right-0 mt-3 w-72 bg-cp-card border border-cp-border rounded-2xl overflow-hidden z-50 modal-in shadow-xl shadow-black/40"
              >
                {/* ── Avatar section ─────────────────────────── */}
                <div className="flex flex-col items-center gap-2 pt-6 pb-4 px-5 border-b border-cp-border">
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

                  {/* Save photo button — only shown when a file is pending */}
                  {avatarFile && (
                    <button
                      onClick={handleSaveAvatar}
                      disabled={avatarSaving}
                      className={`mt-1 w-full py-2 rounded-xl text-xs font-medium transition-all duration-150 flex items-center justify-center gap-1.5 ${
                        avatarSaved
                          ? 'bg-cp-elevated text-cp-muted border border-cp-border'
                          : 'bg-cp-accent hover:bg-cp-accent-hover text-cp-bg'
                      } disabled:opacity-60`}
                    >
                      {avatarSaving && (
                        <span className="w-3 h-3 border-2 border-cp-bg/40 border-t-cp-bg rounded-full animate-spin" />
                      )}
                      {avatarSaved ? 'Photo saved!' : 'Save photo'}
                    </button>
                  )}
                </div>

                {/* ── Fields section ─────────────────────────── */}
                <div className="px-5 py-4 space-y-4">

                  {/* Username */}
                  <div className="space-y-1.5">
                    <label className="block text-xs text-cp-muted uppercase tracking-wider">Username</label>

                    {/* Display mode */}
                    {!editingName && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 min-h-[2.25rem]">
                          <span className="flex-1 text-cp-text text-sm font-medium truncate">
                            {currentUser.name}
                          </span>
                          <button
                            onClick={handleStartEditName}
                            disabled={atLimit}
                            title={atLimit ? 'No more changes today' : 'Edit username'}
                            className={`flex-none w-7 h-7 flex items-center justify-center rounded-lg border transition-all duration-150 ${
                              atLimit
                                ? 'border-cp-border text-cp-muted/30 cursor-not-allowed'
                                : 'border-cp-border text-cp-muted hover:text-cp-accent hover:border-cp-accent/30 hover:bg-cp-accent/5'
                            }`}
                          >
                            <PencilIcon />
                          </button>
                        </div>

                        {/* Success flash */}
                        {nameSaved && (
                          <div className="flex items-center gap-1.5 text-cp-accent text-xs">
                            <CheckSmallIcon />
                            <span>Username updated!</span>
                          </div>
                        )}

                        {/* Remaining count */}
                        <p className={`text-[11px] ${atLimit ? 'text-red-400/70' : 'text-cp-muted/50'}`}>
                          {changesLoading
                            ? <span className="inline-block w-24 h-2.5 bg-cp-elevated rounded animate-pulse" />
                            : atLimit
                            ? 'No more changes allowed today'
                            : `${remaining} of ${USERNAME_LIMIT} changes remaining today`
                          }
                        </p>
                      </div>
                    )}

                    {/* Edit mode */}
                    {editingName && (
                      <div className="space-y-2">
                        <input
                          ref={nameInputRef}
                          type="text"
                          value={nameDraft}
                          onChange={e => { setNameDraft(e.target.value); setNameError('') }}
                          onKeyDown={handleNameKeyDown}
                          className="w-full bg-cp-elevated border border-cp-border rounded-xl px-3 py-2.5 text-cp-text text-sm focus:border-cp-border-soft transition-colors"
                          maxLength={40}
                        />

                        {/* Error */}
                        {nameError && (
                          <p className="text-red-400 text-[11px] leading-relaxed">{nameError}</p>
                        )}

                        {/* Remaining count (show below input) */}
                        {!nameError && (
                          <p className={`text-[11px] ${atLimit ? 'text-red-400/70' : 'text-cp-muted/50'}`}>
                            {atLimit
                              ? 'No more changes allowed today'
                              : `${remaining} of ${USERNAME_LIMIT} changes remaining today`
                            }
                          </p>
                        )}

                        {/* Cancel / Save */}
                        <div className="flex gap-2 pt-0.5">
                          <button
                            onClick={handleCancelEditName}
                            disabled={nameSaving}
                            className="flex-1 py-2 rounded-xl border border-cp-border text-cp-muted text-xs hover:text-cp-text hover:border-cp-border-soft transition-all duration-150 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveName}
                            disabled={nameSaving || !nameDraft.trim()}
                            className="flex-1 py-2 rounded-xl bg-cp-accent hover:bg-cp-accent-hover text-cp-bg text-xs font-medium transition-colors duration-150 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {nameSaving && (
                              <span className="w-3 h-3 border-2 border-cp-bg/40 border-t-cp-bg rounded-full animate-spin" />
                            )}
                            Save
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Email (read-only) */}
                  <div className="text-xs text-cp-muted/60">
                    {currentUser.email}
                  </div>
                </div>

                {/* ── Logout ────────────────────────────────── */}
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
