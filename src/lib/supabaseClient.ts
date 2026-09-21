import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && key)

// Ohne .env.local läuft die App im Demo-Modus mit den lokalen Mock-Daten (siehe AppContext.tsx) —
// genau wie im Fundament Command Center.
export const supabase = isSupabaseConfigured ? createClient(url!, key!) : null
