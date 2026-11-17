import { SIM } from '../routing'
import { localStore } from './local'
import { supabaseStore } from './supabase'
import type { Store } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Con le chiavi Supabase l'app usa il database condiviso; senza, parte in modalità dimostrativa. */
export const store: Store = !SIM && url && key ? supabaseStore(url, key) : localStore
export * from './types'
