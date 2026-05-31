import { supabase } from '../supabase'

// Find or create the 1:1 thread with another account. Returns the thread id (uuid).
export async function getOrCreateThread(otherUserId) {
  const { data, error } = await supabase.rpc('get_or_create_dm_thread', {
    other_user_id: otherUserId,
  })
  if (error) throw error
  return data
}

// The current user's DM threads, newest activity first.
// Each row: { thread_id, other_user_id, other_name, other_avatar,
//             last_content, last_image_url, last_sender_id, last_message_at }
export async function listThreads() {
  const { data, error } = await supabase.rpc('list_dm_threads')
  if (error) throw error
  return data || []
}

// Accounts the current user can DM: [{ user_id, full_name, avatar_url }]
export async function listRecipients() {
  const { data, error } = await supabase.rpc('list_dm_recipients')
  if (error) throw error
  return data || []
}

// All messages in a thread, oldest first.
export async function fetchThreadMessages(threadId) {
  const { data, error } = await supabase
    .from('direct_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Insert one DM. Returns the inserted row.
export async function sendDirectMessage({ threadId, senderId, senderName, content, imageUrl }) {
  const { data, error } = await supabase
    .from('direct_messages')
    .insert({
      thread_id:   threadId,
      sender_id:   senderId,
      sender_name: senderName,
      ...(content  && { content }),
      ...(imageUrl && { image_url: imageUrl }),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Upload a DM image to the public bucket under dm/<threadId>/. Returns its public URL.
export async function uploadDmImage({ threadId, file }) {
  const ext  = file.name.split('.').pop()
  const path = `dm/${threadId}/${Date.now()}.${ext}`
  const { data, error } = await supabase.storage
    .from('cp-studios')
    .upload(path, file, { upsert: false })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage
    .from('cp-studios')
    .getPublicUrl(data.path)
  return publicUrl
}
