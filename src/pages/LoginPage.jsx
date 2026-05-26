import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'

function InputField({ label, type = 'text', placeholder, value, onChange }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-cp-muted uppercase tracking-wider">{label}</label>
      <input
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

// Banner variants: 'error' (red) | 'warning' (amber) | 'info' (blue-ish)
function Banner({ message, variant = 'error' }) {
  const styles = {
    error:   'bg-red-500/10 border-red-500/20 text-red-400',
    warning: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    info:    'bg-cp-accent/10 border-cp-accent/20 text-cp-accent',
  }
  return (
    <div className={`mb-5 px-4 py-3 rounded-xl border text-xs leading-relaxed ${styles[variant]}`}>
      {message}
    </div>
  )
}

// Map structured error codes → { message, variant }
function resolveLoginError(err) {
  switch (err.code) {
    case 'EMAIL_NOT_CONFIRMED':
      return {
        variant: 'warning',
        message: "You haven't confirmed your email address yet. Check your inbox for a confirmation link, then come back to sign in.",
      }
    case 'PENDING_APPROVAL':
      return {
        variant: 'info',
        message: 'Your account is pending admin approval. You will be able to sign in once approved.',
      }
    case 'REJECTED':
      return {
        variant: 'error',
        message: 'Your signup request was not approved. Please contact the admin.',
      }
    default:
      return {
        variant: 'error',
        message: err.message || 'Sign in failed. Please try again.',
      }
  }
}

export default function LoginPage() {
  const { login, signup } = useApp()
  const navigate = useNavigate()

  const [tab,     setTab]     = useState('login')
  const [loading, setLoading] = useState(false)

  // Login state
  const [loginEmail,    setLoginEmail]    = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError,    setLoginError]    = useState(null)   // { message, variant }

  // Signup state
  const [signupName,     setSignupName]     = useState('')
  const [signupEmail,    setSignupEmail]    = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [signupError,    setSignupError]    = useState('')
  // null = not submitted, false = submitted (no email confirm needed), true = submitted (email confirm needed)
  const [signupDone,                setSignupDone]                = useState(null)
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState(false)

  // ── Handlers ───────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault()
    setLoginError(null)
    setLoading(true)
    try {
      await login(loginEmail.trim(), loginPassword)
      navigate('/')
    } catch (err) {
      setLoginError(resolveLoginError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    setSignupError('')
    setLoading(true)
    try {
      const { emailConfirmationRequired } = await signup(
        signupEmail.trim(),
        signupPassword,
        signupName.trim(),
      )
      setEmailConfirmationRequired(emailConfirmationRequired)
      setSignupDone(true)
    } catch (err) {
      setSignupError(err.message || 'Signup failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const switchTab = (t) => {
    setTab(t)
    setLoginError(null)
    setSignupError('')
    setSignupDone(null)
  }

  // ── Signup success screens ─────────────────────────────────
  const SignupSuccessWithEmailConfirm = () => (
    <div className="py-4 text-center space-y-4 page-in">
      <div className="w-12 h-12 rounded-2xl bg-cp-elevated border border-cp-border flex items-center justify-center mx-auto">
        {/* Envelope icon */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-cp-accent">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      </div>
      <div>
        <p className="text-cp-text text-sm font-medium">Check your email</p>
        <p className="text-cp-muted text-xs mt-2 leading-relaxed max-w-[220px] mx-auto">
          We sent a confirmation link to{' '}
          <span className="text-cp-text">{signupEmail}</span>.
          <br /><br />
          <strong className="text-cp-text/80">Step 1 —</strong> Click that link to verify your address.
          <br />
          <strong className="text-cp-text/80">Step 2 —</strong> Come back and sign in once an admin approves your account.
        </p>
      </div>
      <button
        onClick={() => switchTab('login')}
        className="text-xs text-cp-accent hover:underline"
      >
        Back to sign in
      </button>
    </div>
  )

  const SignupSuccessNoEmailConfirm = () => (
    <div className="py-4 text-center space-y-3 page-in">
      <div className="w-12 h-12 rounded-2xl bg-cp-elevated border border-cp-border flex items-center justify-center mx-auto">
        {/* Clock icon */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-cp-accent">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
      <div>
        <p className="text-cp-text text-sm font-medium">Request received</p>
        <p className="text-cp-muted text-xs mt-1 leading-relaxed">
          Your account is pending admin approval.
          <br />
          You'll be able to sign in once approved.
        </p>
      </div>
      <button
        onClick={() => switchTab('login')}
        className="text-xs text-cp-accent hover:underline"
      >
        Back to sign in
      </button>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────
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

          {/* ── Login Form ── */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-5">
              {loginError && <Banner message={loginError.message} variant={loginError.variant} />}

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
          {tab === 'signup' && signupDone === null && (
            <form onSubmit={handleSignup} className="space-y-5">
              {signupError && <Banner message={signupError} variant="error" />}

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

          {/* ── Signup success ── */}
          {tab === 'signup' && signupDone === true && (
            emailConfirmationRequired
              ? <SignupSuccessWithEmailConfirm />
              : <SignupSuccessNoEmailConfirm />
          )}
        </div>

        <p className="text-center text-xs text-cp-muted/50 mt-8">
          Private photo sharing for family and friends.
        </p>
      </div>
    </div>
  )
}
