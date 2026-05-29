import { useNavigate } from 'react-router-dom'

export default function WarComingSoon() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-cp-bg flex items-center justify-center p-6">
      <div className="flex flex-col items-center text-center max-w-sm gap-6">

        {/* Icon */}
        <div className="w-20 h-20 rounded-3xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            className="w-9 h-9 text-red-400/70"
          >
            <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
            <line x1="13" y1="19" x2="19" y2="13" />
            <line x1="16" y1="16" x2="20" y2="20" />
            <line x1="19" y1="21" x2="21" y2="19" />
          </svg>
        </div>

        {/* Text */}
        <div className="space-y-2">
          <h1 className="font-display text-2xl text-cp-text font-normal">CP War — Coming Soon</h1>
          <p className="text-cp-muted text-sm leading-relaxed">
            We are working on improvements to CP War. Check back soon!
          </p>
        </div>

        {/* CTA */}
        <button
          onClick={() => navigate('/')}
          className="px-6 py-2.5 rounded-xl border border-cp-border text-cp-muted text-sm font-medium hover:text-cp-text hover:border-cp-border-soft transition-all duration-150"
        >
          Back to Home
        </button>

      </div>
    </div>
  )
}
