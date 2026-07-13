// Camada de dados: cache local + nuvem (Supabase). Lógica pura vive em logic.js
import { supabase } from './supabaseClient'
import { migrate, PARCELAS_KEY, LIMITES_KEY } from './logic.js'

export * from './logic.js'

const CACHE = 'minhasobra:cache:v2'

export function getParcelas(db) { return (db[PARCELAS_KEY] && db[PARCELAS_KEY].list) || [] }
export function getLimites(db) { return (db[LIMITES_KEY] && db[LIMITES_KEY].map) || {} }

export function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE)) || {} } catch { return {} } }
export function saveCache(db) { try { localStorage.setItem(CACHE, JSON.stringify(db)) } catch {} }

export async function loadFromCloud() {
  if (!supabase) return null
  const { data, error } = await supabase.from('budgets').select('ym, data')
  if (error) throw error
  const db = {}
  for (const row of data) db[row.ym] = (row.ym === PARCELAS_KEY || row.ym === LIMITES_KEY) ? row.data : migrate(row.data)
  saveCache(db); return db
}
export async function upsertRow(ym, data) {
  if (!supabase) return
  const { data: u } = await supabase.auth.getUser(); const uid = u?.user?.id; if (!uid) return
  const { error } = await supabase.from('budgets').upsert({ user_id: uid, ym, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id,ym' })
  if (error) throw error
}
export async function deleteRow(ym) {
  const db = loadCache(); delete db[ym]; saveCache(db)
  if (!supabase) return
  const { data: u } = await supabase.auth.getUser(); const uid = u?.user?.id; if (!uid) return
  await supabase.from('budgets').delete().eq('user_id', uid).eq('ym', ym)
}
