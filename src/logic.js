// Lógica pura do Minha Sobra — sem dependências de navegador ou Supabase (testável em Node)

export const PARCELAS_KEY = 'parcelas'
export const LIMITES_KEY = 'limites'
export const mkey = (y, m) => `${y}-${m}`
export const CARD_COLORS = ['#0F9D6E', '#2563EB', '#D85A30', '#7F77DD', '#D4537E', '#BA7517']

export function newId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'id' + Date.now() + Math.random().toString(36).slice(2, 6)
}
export const newParcelaId = newId

// ID determinístico a partir do nome (para dados antigos): mesmo nome => mesmo cartão lógico
export const cardIdFromName = (nome) =>
  'c_' + String(nome || 'cartao').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'c_cartao'

export function seedMonth(first) {
  if (!first) return { liquido: null, vr: null, meta: null, cartoes: [], avulsos: [], parcelasPagas: {} }
  return {
    liquido: 4819.09, vr: 456.06, meta: null,
    cartoes: [
      { id: 'c_cartao-1', nome: 'Cartão 1', cor: CARD_COLORS[0], venc: null, itens: [
        { cat: 'Mercado', valor: 350, pago: false },
        { cat: 'Transporte', valor: 250, pago: false },
        { cat: 'Lazer', valor: 200, pago: false } ] },
      { id: 'c_cartao-2', nome: 'Cartão 2', cor: CARD_COLORS[1], venc: null, itens: [
        { cat: 'Assinaturas', valor: 80, pago: false },
        { cat: 'Compras', valor: 300, pago: false } ] },
    ],
    avulsos: [
      { nome: 'Moradia', valor: 1500, pago: false },
      { nome: 'Condomínio', valor: 500, pago: false },
      { nome: 'Energia', valor: 150, pago: false } ],
    parcelasPagas: {},
  }
}

export function migrate(d) {
  if (!d) return d
  if (d.list || d.map) return d // linhas especiais (parcelas / limites)
  if (d.boletos && !d.cartoes) {
    d.cartoes = [{ nome: 'Cartão 1', itens: [] }, { nome: 'Cartão 2', itens: [] }]
    d.avulsos = d.boletos.map((b) => ({ nome: b.nome, valor: b.valor })); delete d.boletos
  }
  if (!d.cartoes) d.cartoes = []
  d.cartoes.forEach((c, i) => {
    if (!c.id) c.id = cardIdFromName(c.nome || ('cartao-' + (i + 1)))
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
  return { id: newId(), nome: `Cartão ${index + 1}`, cor: CARD_COLORS[index % CARD_COLORS.length], venc: null, itens: [] }
}

// ---------- parcelas ----------
export const offsetMonths = (start, y, m) => (y - start.y) * 12 + (m - start.m)
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
  for (const { p } of activeParcelas(parcelas, y, m)) {
    const key = p.cartaoId || cardIdFromName(p.cartao)
    map[key] = (map[key] || 0) + (p.valor || 0)
  }
  return map
}
export function parcelaPaga(p, k) { return !!(p.pagas && p.pagas[k]) }

// normaliza parcelas (cartaoId) e migra "pago por mês" antigo para p.pagas[k]
export function mergeLegacyPagas(db) {
  const row = db[PARCELAS_KEY]
  if (!row || !row.list) return { list: (row && row.list) || [], changed: false }
  let changed = false
  const list = row.list.map((p) => ({ ...p, pagas: { ...(p.pagas || {}) } }))
  for (const p of list) { if (!p.cartaoId) { p.cartaoId = cardIdFromName(p.cartao); changed = true } }
  for (const key in db) {
    if (key === PARCELAS_KEY || key === LIMITES_KEY) continue
    const d = db[key]; if (!d || !d.parcelasPagas) continue
    const [y, m] = key.split('-').map(Number)
    for (const id in d.parcelasPagas) {
      if (!d.parcelasPagas[id]) continue
      const p = list.find((x) => x.id === id); if (!p) continue
      const k = parcelaKAt(p, y, m); if (!k) continue
      if (!p.pagas[k]) { p.pagas[k] = true; changed = true }
    }
  }
  return { list, changed }
}

// ---------- totais ----------
const sum = (arr) => arr.reduce((a, x) => a + (x.valor || 0), 0)
export const cartaoTotalBase = (c) => sum(c.itens)
export const cartaoTotal = (c, extra) => cartaoTotalBase(c) + ((extra && (extra[c.id] || 0)) || 0)
export const avulsoTotal = (d) => sum(d.avulsos)
export function gastoTotal(d, parcelas, y, m) {
  const extra = parcelas ? extraByCard(parcelas, y, m) : {}
  const knownIds = new Set(d.cartoes.map((c) => c.id))
  let orphanExtra = 0
  for (const id in extra) if (!knownIds.has(id)) orphanExtra += extra[id]
  return d.cartoes.reduce((a, c) => a + cartaoTotal(c, extra), 0) + avulsoTotal(d) + orphanExtra
}
export function openPaid(d, parcelas, y, m) {
  let paid = 0
  d.cartoes.forEach((c) => c.itens.forEach((it) => { if (it.pago) paid += (it.valor || 0) }))
  d.avulsos.forEach((b) => { if (b.pago) paid += (b.valor || 0) })
  activeParcelas(parcelas || [], y, m).forEach(({ p, k }) => { if (parcelaPaga(p, k)) paid += (p.valor || 0) })
  const total = gastoTotal(d, parcelas, y, m)
  return { total, paid, open: total - paid }
}

// ---------- sugestões / histórico ----------
export function suggestCategorias(db) {
  const s = new Set()
  for (const k in db) { if (k === PARCELAS_KEY || k === LIMITES_KEY) continue; const d = migrate(db[k]); if (!d || !d.cartoes) continue; d.cartoes.forEach((c) => c.itens.forEach((it) => { const n = (it.cat || '').trim(); if (n) s.add(n) })) }
  return [...s].sort()
}
export function suggestBoletos(db) {
  const s = new Set()
  for (const k in db) { if (k === PARCELAS_KEY || k === LIMITES_KEY) continue; const d = migrate(db[k]); if (!d || !d.avulsos) continue; d.avulsos.forEach((b) => { const n = (b.nome || '').trim(); if (n) s.add(n) }) }
  return [...s].sort()
}
export function prevFilled(db, y, m) {
  for (let i = 1; i <= 24; i++) {
    let mm = m - i, yy = y; while (mm < 0) { mm += 12; yy -= 1 }
    const d = db[mkey(yy, mm)]; if (d && d.liquido != null) return migrate(JSON.parse(JSON.stringify(d)))
  }
  return null
}
export function resolveCardCor(db, cartaoId, nomeFallback) {
  const keys = Object.keys(db).filter((k) => k !== PARCELAS_KEY && k !== LIMITES_KEY)
    .map((k) => { const [y, m] = k.split('-').map(Number); return { k, y, m } })
    .sort((a, b) => b.y - a.y || b.m - a.m)
  for (const { k } of keys) {
    const d = db[k]; if (!d || !d.cartoes) continue
    const c = d.cartoes.find((x) => x.id === cartaoId || (nomeFallback && x.nome === nomeFallback))
    if (c && c.cor) return c.cor
  }
  return null
}

// mês novo: traz os cartões reais existentes (casca) + itens recorrentes
export function templateMonth(db, y, m, firstEver) {
  const base = seedMonth(firstEver)
  if (!firstEver) {
    const prev = prevFilled(db, y, m)
    if (prev) {
      base.cartoes = (prev.cartoes || []).map((c) => ({
        id: c.id, nome: c.nome, cor: c.cor, venc: c.venc,
        itens: (c.itens || []).filter((it) => it.rec).map((it) => ({ cat: it.cat, valor: it.valor, pago: false, rec: true })),
      }))
      base.avulsos = (prev.avulsos || []).filter((b) => b.rec).map((b) => ({ nome: b.nome, valor: b.valor, pago: false, rec: true }))
    }
  }
  return base
}

export function history(db, parcelas) {
  const out = []
  for (const k in db) {
    if (k === PARCELAS_KEY || k === LIMITES_KEY) continue
    let d = db[k]; if (!d || d.liquido == null) continue
    d = migrate(d)
    const [y, m] = k.split('-').map(Number)
    const t = gastoTotal(d, parcelas, y, m)
    out.push({ y, m, liquido: d.liquido || 0, total: t, sobra: (d.liquido || 0) - t, d })
  }
  out.sort((a, b) => b.y - a.y || b.m - a.m)
  return out
}

export function reminders(db, parcelas, y, m) {
  const out = []
  const d = db[mkey(y, m)] ? migrate(db[mkey(y, m)]) : null
  const today = new Date()
  const isCurrent = y === today.getFullYear() && m === today.getMonth()
  if (d) {
    const { open } = openPaid(d, parcelas, y, m)
    if (open > 0) out.push({ tipo: 'aberto', texto: 'Você tem em aberto neste mês', valor: open })
    if (isCurrent) {
      d.cartoes.forEach((c) => {
        if (c.venc) {
          const diff = c.venc - today.getDate()
          if (diff >= 0 && diff <= 5) out.push({ tipo: 'fatura', texto: `Fatura ${c.nome} vence ${diff === 0 ? 'hoje' : 'em ' + diff + ' dia' + (diff > 1 ? 's' : '')}`, valor: cartaoTotalBase(c) })
        }
      })
    }
  }
  return out
}
