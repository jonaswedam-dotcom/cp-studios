import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

export default function CreateProfilePage() {
  const navigate             = useNavigate()
  const { session, addProfileToList } = useApp()
  const fileInputRef         = useRef(null)

  const [name,          setName]          = useState('')
  const [bio,           setBio]           = useState('')
  const [avatarFile,    setAvatarFile]    = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [error,         setError]         = useState('')
  const [loading,       setLoading]       = useState(false)

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      setAvatarFile(file)
      setAvatarPreview(URL.createObjectURL(file))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Please enter a full name.')
      return
    }
    setLoading(true)
    setError('')

    try {
      // Check for duplicate name (case-insensitive) before inserting
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .ilike('full_name', name.trim())
        .limit(1)
        .maybeSingle()

      if (existing) {
        setError('That name is already taken — please choose a different one.')
        setLoading(false)
        return
      }

      let avatar_url = ''

      // Upload avatar to Storage if one was chosen
      if (avatarFile) {
        const ext  = avatarFile.name.split('.').pop()
        const path = `avatars/${session.user.id}/${Date.now()}.${ext}`
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('cp-studios')
          .upload(path, avatarFile)

        if (uploadErr) throw uploadErr

        const { data: { publicUrl } } = supabase.storage
          .from('cp-studios')
          .getPublicUrl(uploadData.path)
        avatar_url = publicUrl
      }

      // Insert profile row — link to the logged-in user's auth account so that:
      //   • the "owner can update profile" RLS policy (auth.uid() = user_id) works
      //   • the comments_with_author view can resolve their name from their profile
      const { data, error: insertErr } = await supabase
        .from('profiles')
        .insert({
          user_id:    session?.user?.id ?? null,
          full_name:  name.trim(),
          bio:        bio.trim(),
          avatar_url: avatar_url || `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 68) + 1}`,
        })
        .select()
        .single()

      if (insertErr) throw insertErr

      addProfileToList(data)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Failed to create profile.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-in max-w-lg mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="font-display text-3xl text-cp-text font-normal">New Profile</h1>
        <p className="text-cp-muted text-sm mt-1.5">Add a family member or friend to the collection.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Avatar picker */}
        <div className="flex flex-col items-center gap-4 py-6">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-28 h-28 rounded-full border-2 border-dashed border-cp-border hover:border-cp-accent/40 flex items-center justify-center overflow-hidden transition-all duration-200 group"
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <span className="text-cp-muted group-hover:text-cp-accent transition-colors duration-200">
                <UserIcon />
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs text-cp-muted hover:text-cp-accent transition-colors duration-150"
          >
            {avatarPreview ? 'Change photo' : 'Add profile photo'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Name */}
        <div className="space-y-1.5">
          <label className="block text-xs text-cp-muted uppercase tracking-wider">Full Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError('') }}
            placeholder="e.g. Sarah Mitchell"
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm placeholder-cp-muted/40 focus:border-cp-border-soft transition-colors duration-150"
          />
          {error && <p className="text-xs text-red-400/80">{error}</p>}
        </div>

        {/* Bio */}
        <div className="space-y-1.5">
          <label className="block text-xs text-cp-muted uppercase tracking-wider">
            Short Bio <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A short description..."
            rows={3}
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm placeholder-cp-muted/40 focus:border-cp-border-soft transition-colors duration-150 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            disabled={loading}
            className="flex-1 py-3 rounded-xl border border-cp-border text-cp-muted text-sm font-medium hover:text-cp-text hover:border-cp-border-soft transition-all duration-150 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-3 rounded-xl bg-cp-accent hover:bg-cp-accent-hover text-cp-bg text-sm font-medium transition-colors duration-150 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-cp-bg/40 border-t-cp-bg rounded-full animate-spin" />}
            Create Profile
          </button>
        </div>
      </form>
    </div>
  )
}
