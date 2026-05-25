import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'

function InputField({ label, type = 'text', placeholder, value, onChange, inputRef }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-cp-muted uppercase tracking-wider">{label}</label>
      <input
        ref={inputRef}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required
        className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm placeholder-cp-muted/40 focus:border-cp-border-soft transition-colors duration-150"
      />
    </div>
  )
}

export default function LoginPage() {
  const { login, signup } = useApp()
  const navigate = useNavigate()

  const [tab,        setTab]        = useState('login')
  const [submitted,  setSubmitted]  = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [errorMsg,   setErrorMsg]   = useState('')

  // Login fields
  const [loginEmail,    setLoginEmail]    = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Signup fields
  const [signupName,     setSignupName]     = useState('')
  const [signupEmail,    setSignupEmail]    = useState('')
  const [signupPassword, setSignupPassword] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setLoading(true)
    try {
      await login(loginEmail.trim(), loginPassword)
      navigate('/')
    } catch (err) {
      setErrorMsg(err.message || 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setLoading(true)
    try {
      await signup(signupEmail.trim(), signupPassword, signupName.trim())
      setSubmitted(true)
    } catch (err) {
      setErrorMsg(err.message || 'Signup failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const switchTab = (t) => {
    setTab(t)
    setSubmitted(false)
    setErrorMsg('')
  }

  return (
    <div className="min-h-screen bg-cp-bg flex items-center justify-center p-6 page-in">
      <div className="w-full max-w-sm">
        {/* Wordmark */}
        <div className="text-center mb-10">
          <span className="font-display text-3xl">
            <span className="italic text-cp-accent">CP</span>
            <span className="font-light text-cp-text/90"> Studios</span>
          </span>
          <p className="text-cp-muted text-sm mt-2">Shared moments, close to home.</p>
        </div>

        {/* Card */}
        <div className="bg-cp-card border border-cp-border rounded-3xl p-8">
          {/* Tabs */}
          <div className="flex border-b border-cp-border mb-8">
            {['login', 'signup'].map((t) => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                className={`pb-3 text-sm font-medium mr-6 border-b-2 -mb-px transition-colors duration-150 ${
                  tab === t
                    ? 'border-cp-accent text-cp-text'
                    : 'border-transparent text-cp-muted hover:text-cp-text'
                }`}
              >
                {t === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          {/* Error banner */}
          {errorMsg && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs leading-relaxed">
              {errorMsg}
            </div>
          )}

          {/* ── Login Form ── */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-5">
              <InputField
                label="Email" type="email" placeholder="you@example.com"
                value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
              />
              <InputField
                label="Password" type="password" placeholder="••••••••"
                value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-cp-accent hover:bg-cp-accent-hover text-cp-bg text-sm font-medium transition-colors duration-150 mt-2 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading && <span className="w-4 h-4 border-2 border-cp-bg/40 border-t-cp-bg rounded-full animate-spin" />}
                Sign In
              </button>
              <p className="text-center text-xs text-cp-muted">
                No account?{' '}
                <button type="button" onClick={() => switchTab('signup')} className="text-cp-accent hover:underline">
                  Create one
                </button>
              </p>
            </form>
          )}

          {/* ── Signup Form ── */}
          {tab === 'signup' && !submitted && (
            <form onSubmit={handleSignup} className="space-y-5">
              <InputField
                label="Full Name" placeholder="Your name"
                value={signupName} onChange={e => setSignupName(e.target.value)}
              />
              <InputField
                label="Email" type="email" placeholder="you@example.com"
                value={signupEmail} onChange={e => setSignupEmail(e.target.value)}
              />
              <InputField
                label="Password" type="password" placeholder="Choose a password (min 6 chars)"
                value={signupPassword} onChange={e => setSignupPassword(e.target.value)}
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-cp-accent hover:bg-cp-accent-hover text-cp-bg text-sm font-medium transition-colors duration-150 mt-2 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading && <span className="w-4 h-4 border-2 border-cp-bg/40 border-t-cp-bg rounded-full animate-spin" />}
                Request Access
              </button>
            </form>
          )}

          {/* ── Pending approval state ── */}
          {tab === 'signup' && submitted && (
            <div className="py-4 text-center space-y-3 page-in">
              <div className="w-12 h-12 rounded-2xl bg-cp-elevated border border-cp-border flex items-center justify-center mx-auto">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-cp-accent">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0z" />
                </svg>
              </div>
              <div>
                <p className="text-cp-text text-sm font-medium">Request received</p>
                <p className="text-cp-muted text-xs mt-1 leading-relaxed">
                  Your account is pending admin approval.<br />
                  You'll be notified once it's reviewed.
                </p>
              </div>
              <button
                onClick={() => switchTab('login')}
                className="text-xs text-cp-accent hover:underline"
              >
                Back to sign in
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-cp-muted/50 mt-8">
          Private photo sharing for family and friends.
        </p>
      </div>
    </div>
  )
}
