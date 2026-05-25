import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { useApp } from '../context/AppContext'

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  )
}

export default function UploadModal({ profileId, onClose, onUploaded }) {
  const { session } = useApp()
  const [isDragging, setIsDragging] = useState(false)
  const [preview,    setPreview]    = useState(null)
  const [file,       setFile]       = useState(null)
  const [caption,    setCaption]    = useState('')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleFile = (f) => {
    if (f && f.type.startsWith('image/')) {
      setFile(f)
      setPreview(URL.createObjectURL(f))
      setError('')
    }
  }

  const handleDragOver  = (e) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false) }
  const handleDrop      = (e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }

  const handleSubmit = async () => {
    if (!file) { setError('Please select a photo.'); return }
    setLoading(true)
    setError('')

    try {
      // 1. Upload image to Storage
      const ext  = file.name.split('.').pop()
      const path = `photos/${profileId}/${Date.now()}.${ext}`
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('cp-studios')
        .upload(path, file)

      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage
        .from('cp-studios')
        .getPublicUrl(uploadData.path)

      // 2. Insert photo row
      const { error: insertErr } = await supabase.from('photos').insert({
        profile_id:  profileId,
        uploader_id: session.user.id,
        image_url:   publicUrl,
        caption:     caption.trim(),
      })

      if (insertErr) throw insertErr

      onUploaded?.()
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-in"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose() }}
    >
      <div className="bg-cp-card border border-cp-border rounded-3xl w-full max-w-md p-8 modal-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-7">
          <h2 className="font-display text-xl text-cp-text">Upload Photo</h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-cp-muted hover:text-cp-text hover:bg-cp-elevated transition-all duration-150 disabled:opacity-50"
          >
            <XIcon />
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-200 mb-5 overflow-hidden
            ${isDragging
              ? 'border-cp-accent bg-cp-accent/5'
              : 'border-cp-border hover:border-cp-border-soft hover:bg-cp-elevated/50'
            }`}
        >
          {preview ? (
            <div className="aspect-[4/3]">
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
                <span className="text-cp-text text-xs font-medium">Click to change</span>
              </div>
            </div>
          ) : (
            <div className="aspect-[4/3] flex flex-col items-center justify-center gap-3">
              <span className={`transition-colors duration-200 ${isDragging ? 'text-cp-accent' : 'text-cp-muted'}`}>
                <UploadIcon />
              </span>
              <div className="text-center">
                <p className={`text-sm font-medium transition-colors ${isDragging ? 'text-cp-accent' : 'text-cp-text'}`}>
                  {isDragging ? 'Drop to upload' : 'Drag and drop'}
                </p>
                <p className="text-xs text-cp-muted mt-0.5">or click to browse</p>
              </div>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />

        {error && (
          <p className="mb-4 text-xs text-red-400/80">{error}</p>
        )}

        {/* Caption */}
        <div className="mb-7">
          <label className="block text-xs text-cp-muted uppercase tracking-wider mb-2">Caption</label>
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Add an optional caption..."
            className="w-full bg-cp-elevated border border-cp-border rounded-xl px-4 py-3 text-cp-text text-sm placeholder-cp-muted/40 focus:border-cp-border-soft transition-colors duration-150"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-3 rounded-xl border border-cp-border text-cp-muted text-sm font-medium hover:text-cp-text hover:border-cp-border-soft transition-all duration-150 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !file}
            className="flex-1 py-3 rounded-xl bg-cp-accent hover:bg-cp-accent-hover text-cp-bg text-sm font-medium transition-colors duration-150 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-cp-bg/40 border-t-cp-bg rounded-full animate-spin" />}
            {loading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}
