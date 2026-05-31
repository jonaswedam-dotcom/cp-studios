import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'

const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

const ADMIN_EMAILS = ['jonas.wedam@gmail.com', 'admin@cpstudios.app']

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
  const [chatOpen,    setChatOpen]    = useState(false)

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
        isAdmin: ADMIN_EMAILS.includes(session.user.email),
      }
    : null

  // ── Auth actions ───────────────────────────────────────────

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      const msg = error.message?.toLowerCase() ?? ''

      // Supabase returns this when the user hasn't clicked their confirmation link yet
      if (msg.includes('email not confirmed') || error.code === 'email_not_confirmed') {
        const e = new Error('EMAIL_NOT_CONFIRMED')
        e.code  = 'EMAIL_NOT_CONFIRMED'
        throw e
      }

      // Wrong credentials – don't leak which field is wrong
      if (msg.includes('invalid login credentials') || msg.includes('invalid email or password')) {
        const e = new Error('Incorrect email or password.')
        e.code  = 'INVALID_CREDENTIALS'
        throw e
      }

      throw error
    }

    // Admin bypasses the pending-approval gate
    if (!ADMIN_EMAILS.includes(data.user.email)) {
      const { data: pu, error: puErr } = await supabase
        .from('pending_users')
        .select('status')
        .eq('user_id', data.user.id)
        .maybeSingle()

      // Don't treat a transient query failure as "pending" — that would
      // silently sign out a legitimately approved user. Fail explicitly.
      if (puErr) {
        await supabase.auth.signOut()
        const e = new Error('Could not verify your account status. Please try again.')
        e.code  = 'STATUS_CHECK_FAILED'
        throw e
      }

      if (!pu || pu.status === 'pending') {
        await supabase.auth.signOut()
        const e = new Error('PENDING_APPROVAL')
        e.code  = 'PENDING_APPROVAL'
        throw e
      }
      if (pu.status === 'rejected') {
        await supabase.auth.signOut()
        const e = new Error('Your signup request was not approved.')
        e.code  = 'REJECTED'
        throw e
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

    // Read the user id directly from the auth response — the session is null
    // when Supabase requires email confirmation, so we never rely on it here.
    const userId = data?.user?.id
    if (!userId) throw new Error('Signup failed — please try again.')

    // When email confirmation is enabled, data.session is null.
    // We use this to tell the UI which "next step" message to show.
    const emailConfirmationRequired = !data.session

    // Add to pending_users with status "pending"
    const { error: puError } = await supabase.from('pending_users').insert({
      user_id:  userId,
      email,
      username,
    })
    if (puError && !puError.message?.includes('duplicate')) throw puError

    // Only sign out when Supabase handed us an active session immediately
    // (i.e. email confirmation is disabled). Otherwise there is nothing to sign out from.
    if (data.session) {
      await supabase.auth.signOut()
    }

    return { emailConfirmationRequired }
  }

  const logout = async () => {
    await supabase.auth.signOut()
  }

  const updateCurrentUser = async ({ name, avatar_url }) => {
    await supabase.auth.updateUser({ data: { full_name: name, avatar_url } })
    // onAuthStateChange will fire and update `session`
  }

  return (
    <AppContext.Provider
      value={{
        session,
        authLoading,
        currentUser,
        profiles,
        loadProfiles,
        login,
        signup,
        logout,
        updateCurrentUser,
        chatOpen,
        setChatOpen,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
