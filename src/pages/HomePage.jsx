import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'

function ProfileCard({ profile }) {
  return (
    <Link
      to={`/profile/${profile.id}`}
      className="group flex flex-col items-center gap-3 p-6 rounded-2xl border border-cp-border hover:border-cp-border-soft hover:bg-cp-card transition-all duration-200"
    >
      <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-cp-border group-hover:border-cp-accent/40 transition-colors duration-200">
        <img
          src={profile.avatar}
          alt={profile.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      </div>
      <span className="font-display text-cp-text text-sm font-medium text-center leading-tight">
        {profile.name}
      </span>
    </Link>
  )
}

export default function HomePage() {
  const { profiles } = useApp()

  return (
    <div className="page-in max-w-7xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="font-display text-3xl text-cp-text font-normal">View and Upload Photos</h1>
        <p className="text-cp-muted text-sm mt-1.5">Browse a profile to view or upload photos.</p>
      </div>

      {/* Profile grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {profiles.map((profile) => (
          <ProfileCard key={profile.id} profile={profile} />
        ))}

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
    </div>
  )
}
