import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'

const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

const ADMIN_EMAIL = 'jonas.wedam@gmail.com'

// Normalise a DB profile row → shape the rest of the app expects
export function normalizeProfile(row) {
  return {
    id:     row.id,
    name:   row.full_name,
    avatar: row.avatar_url || `https://i.pravatar.cc/150?img=${(row.full_name?.charCodeAt(0) || 65) % 68 + 1}`,
    bio:    row.bio || '',
    // keep raw fields too
    _user_id:   row.user_id,
    _full_name: row.full_name,
  }
}

export function AppProvider({ children }) {
  const [session,     setSession]     = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [profiles,    setProfiles]    = useState([])

  // ── Auth state ─────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Load profiles when logged in ───────────────────────────
  const loadProfiles = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true })
    if (!error && data) setProfiles(data.map(normalizeProfile))
  }, [])

  useEffect(() => {
    if (!session) { setProfiles([]); return }
    loadProfiles()
  }, [session?.user?.id, loadProfiles])

  // ── Derived currentUser ────────────────────────────────────
  const currentUser = session
    ? {
        id:     session.user.id,
        email:  session.user.email,
        name:   session.user.user_metadata?.full_name
                  || session.user.email?.split('@')[0]
                  || 'You',
        avatar: session.user.user_metadata?.avatar_url
                  || `https://i.pravatar.cc/150?img=3`,
        isAdmin: session.user.email === ADMIN_EMAIL,
      }
    : null

  // ── Auth actions ───────────────────────────────────────────
  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    // Admin bypasses the pending-approval gate
    if (data.user.email !== ADMIN_EMAIL) {
      const { data: pu } = await supabase
        .from('pending_users')
        .select('status')
        .eq('user_id', data.user.id)
        .single()

      if (!pu || pu.status === 'pending') {
        await supabase.auth.signOut()
        throw new Error('Your account is pending admin approval.')
      }
      if (pu.status === 'rejected') {
        await supabase.auth.signOut()
        throw new Error('Your signup request was not approved.')
      }
    }
    return data
  }

  const signup = async (email, password, username) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: username } },
    })
    if (error) throw error

    // After signup the session is null (email confirmation pending or
    // approval gate not yet passed). Read the user id directly from the
    // auth response — never from the session, which may be null here.
    const userId = data?.user?.id
    if (!userId) throw new Error('Signup failed — please try again.')

    // Add to pending_users with status "pending"
    const { error: puError } = await supabase.from('pending_users').insert({
      user_id:  userId,
      email,
      username,
    })
    if (puError && !puError.message.includes('duplicate')) throw puError

    // Sign out immediately – they need admin approval first
    await supabase.auth.signOut()
  }

  const logout = async () => {
    await supabase.auth.signOut()
  }

  const updateCurrentUser = async ({ name, avatar_url }) => {
    await supabase.auth.updateUser({ data: { full_name: name, avatar_url } })
    // onAuthStateChange will fire and update `session`
  }

  // ── Profile list helpers ───────────────────────────────────
  const addProfileToList = (rawRow) => {
    setProfiles(prev => [...prev, normalizeProfile(rawRow)])
  }

  return (
    <AppContext.Provider
      value={{
        session,
        authLoading,
        currentUser,
        profiles,
        loadProfiles,
        addProfileToList,
        login,
        signup,
        logout,
        updateCurrentUser,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
