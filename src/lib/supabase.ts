import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
)

/**
 * Supabase client for client-side queries (subject to Row Level Security).
 * Service-role keys are strictly forbidden from this file and frontend bundles.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

