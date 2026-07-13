import { supabase } from './supabaseClient'

const CACHE = 'minhasobra:cache:v2'
export const PARCELAS_KEY = 'parcelas'

export const mkey = (y, m) => `${y}-${m}`
export const CARD_COLORS = ['#0F9D6E', '#2563EB', '#D85A30', '#7F77DD', '#D4537E', '#BA7517']

export function seedMonth(first) {
  return {
    liquido: first ? 4819.09 : null, vr: first ? 456.06 : null, meta: null,
    cartoes: [
      { nome: 'Cartão 1', cor: CARD_COLORS[0], venc: null, itens: [
        { cat: 'Mercado', valor: first ? 350 : null, pago: false },
        { cat: 'Transporte', valor: first ? 250 : null, pago: false },
        { cat: 'Lazer', valor: first ? 200 : null, pago: false } ] },
      { nome: 'Cartão 2', cor: CARD_COLORS[1], venc: null, itens: [
        { cat: 'Assinaturas', valor: first ? 80 : null, pago: false },
        { cat: 'Compras', valor: first ? 300 : null, pago: false } ] },
    ],
    avulsos: [
      { nome: 'Moradia', valor: first ? 1500 : null, pago: false },
      { nome: 'Condomínio', valor: first ? 500 : null, pago: false },
      { nome: 'Energia', valor: first ? 150 : null, pago: false } ],
    parcelasPagas: {},
  }
}

export function migrate(d) {
  if (!d) return d
  if (d.list) return d // parcelas row, not a month
  if (d.boletos && !d.cartoes) {
    d.cartoes = [{ nome: 'Cartão 1', itens: [] }, { nome: 'Cartão 2', itens: [] }]
    d.avulsos = d.boletos.map((b) => ({ nome: b.nome, valor: b.valor })); delete d.boletos
  }
  if (!d.cartoes) d.cartoes = []
  d.cartoes.forEach((c, i) => {
    if (!c.cor) c.cor = CARD_COLORS[i % CARD_COLORS.length]
    if (c.venc === undefined) c.venc = null
    if (!c.itens) c.itens = []
    c.itens.forEach((it) => { if (it.pago === undefined) it.pago = false })
  })
  if (!d.avulsos) d.avulsos = []
  d.avulsos.forEach((b) => { if (b.pago === undefined) b.pago = false })
  if (!d.parcelasPagas) d.parcelasPagas = {}
  return d
}

export function newCard(index) {
  return { nome: `Cartão ${index + 1}`, cor: CARD_COLORS[index % CARD_COLORS.length], venc: null, itens: [] }
}

// ---------- parcelas ----------
export function getParcelas(db) { return (db[PARCELAS_KEY] && db[PARCELAS_KEY].list) || [] }
export function newParcelaId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'p' + Date.now() + Math.random().toString(36).slice(2, 6)
}
export const offsetMonths = (start, y, m) => (y - start.y) * 12 + (m - start.m)
// returns installment number (1..n) active in (y,m), or 0 if not active
export function parcelaKAt(p, y, m) {
  const off = offsetMonths(p.start, y, m)
  return (off >= 0 && off < p.n) ? off + 1 : 0
}
export function activeParcelas(parcelas, y, m) {
  const out = []
  for (const p of parcelas) { const k = parcelaKAt(p, y, m); if (k) out.push({ p, k }) }
  return out
}
export function extraByCard(parcelas, y, m) {
  const map = {}
  for (const { p } of activeParcelas(parcelas, y, m)) map[p.cartao] = (map[p.cartao] || 0) + (p.valor || 0)
  return map
}

// ---------- totals ----------
const sum = (arr) => arr.reduce((a, x) => a + (x.valor || 0), 0)
export const cartaoTotalBase = (c) => sum(c.itens)
export const cartaoTotal = (c, extra) => cartaoTotalBase(c) + ((extra && extra[c.nome]) || 0)
export const avulsoTotal = (d) => sum(d.avulsos)
export function gastoTotal(d, parcelas, y, m) {
  const extra = parcelas ? extraByCard(parcelas, y, m) : {}
  return d.cartoes.reduce((a, c) => a + cartaoTotal(c, extra), 0) + avulsoTotal(d)
}
// open vs paid for a month
export function openPaid(d, parcelas, y, m) {
  let paid = 0
  d.cartoes.forEach((c) => c.itens.forEach((it) => { if (it.pago) paid += (it.valor || 0) }))
  d.avulsos.forEach((b) => { if (b.pago) paid += (b.valor || 0) })
  const pagasMap = d.parcelasPagas || {}
  activeParcelas(parcelas || [], y, m).forEach(({ p }) => { if (pagasMap[p.id]) paid += (p.valor || 0) })
  const total = gastoTotal(d, parcelas, y, m)
  return { total, paid, open: total - paid }
}

// ---------- suggestions ----------
export function suggestCategorias(db) {
  const s = new Set()
  for (const k in db) { if (k === PARCELAS_KEY) continue; const d = migrate(db[k]); if (!d || !d.cartoes) continue; d.cartoes.forEach((c) => c.itens.forEach((it) => { const n = (it.cat || '').trim(); if (n) s.add(n) })) }
  return [...s].sort()
}
export function suggestBoletos(db) {
  const s = new Set()
  for (const k in db) { if (k === PARCELAS_KEY) continue; const d = migrate(db[k]); if (!d || !d.avulsos) continue; d.avulsos.forEach((b) => { const n = (b.nome || '').trim(); if (n) s.add(n) }) }
  return [...s].sort()
}
export function prevFilled(db, y, m) {
  for (let i = 1; i <= 24; i++) {
    let mm = m - i, yy = y; while (mm < 0) { mm += 12; yy -= 1 }
    const d = db[mkey(yy, mm)]; if (d && d.liquido != null) return migrate(JSON.parse(JSON.stringify(d)))
  }
  return null
}

// ---------- reminders (in-app) ----------
export function reminders(db, parcelas, y, m) {
  const out = []
  const d = db[mkey(y, m)] ? migrate(db[mkey(y, m)]) : null
  const today = new Date()
  const isCurrent = y === today.getFullYear() && m === today.getMonth()
  if (d) {
    const { open } = openPaid(d, parcelas, y, m)
    if (open > 0) out.push({ tipo: 'aberto', texto: `Você tem em aberto neste mês`, valor: open })
    if (isCurrent) {
      d.cartoes.forEach((c) => {
        if (c.venc) {
          const dia = today.getDate()
          const diff = c.venc - dia
          if (diff >= 0 && diff <= 5) out.push({ tipo: 'fatura', texto: `Fatura ${c.nome} vence ${diff === 0 ? 'hoje' : 'em ' + diff + ' dia' + (diff > 1 ? 's' : '')}`, valor: cartaoTotalBase(c) })
        }
      })
    }
  }
  return out
}

// ---------- cache + cloud ----------
export function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE)) || {} } catch { return {} } }
export function saveCache(db) { try { localStorage.setItem(CACHE, JSON.stringify(db)) } catch {} }
export async function loadFromCloud() {
  if (!supabase) return null
  const { data, error } = await supabase.from('budgets').select('ym, data')
  if (error) throw error
  const db = {}
  for (const row of data) db[row.ym] = row.ym === PARCELAS_KEY ? row.data : migrate(row.data)
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

export function history(db, parcelas) {
  const out = []
  for (const k in db) {
    if (k === PARCELAS_KEY) continue
    let d = db[k]; if (!d || d.liquido == null) continue
    d = migrate(d)
    const [y, m] = k.split('-').map(Number)
    const t = gastoTotal(d, parcelas, y, m)
    out.push({ y, m, liquido: d.liquido || 0, total: t, sobra: (d.liquido || 0) - t, d })
  }
  out.sort((a, b) => b.y - a.y || b.m - a.m)
  return out
}
