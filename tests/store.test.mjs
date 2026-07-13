// Testes da lógica pura — rode com: npm test
import assert from 'node:assert/strict'
import {
  migrate, seedMonth, templateMonth, mergeLegacyPagas, cardIdFromName,
  parcelaKAt, activeParcelas, parcelaPaga, gastoTotal, openPaid, history, mkey, PARCELAS_KEY,
} from '../src/logic.js'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('✓', name) }

test('migrate atribui ID estável por nome (mesmo nome = mesmo cartão lógico)', () => {
  const a = migrate({ liquido: 1, cartoes: [{ nome: 'Nubank', itens: [] }], avulsos: [] })
  const b = migrate({ liquido: 1, cartoes: [{ nome: 'Nubank', itens: [] }], avulsos: [] })
  assert.equal(a.cartoes[0].id, b.cartoes[0].id)
  assert.equal(a.cartoes[0].id, cardIdFromName('Nubank'))
})

test('renomear cartão mantém o ID — parcelas continuam vinculadas', () => {
  const d = migrate({ liquido: 1, cartoes: [{ nome: 'Cartão 1', itens: [] }], avulsos: [] })
  const idAntes = d.cartoes[0].id
  d.cartoes[0].nome = 'Nubank' // renomeia
  assert.equal(d.cartoes[0].id, idAntes)
})

test('janela de parcelas: 10x começando jun/26', () => {
  const p = { valor: 300, n: 10, start: { y: 2026, m: 5 } }
  assert.equal(parcelaKAt(p, 2026, 5), 1)
  assert.equal(parcelaKAt(p, 2026, 6), 2)
  assert.equal(parcelaKAt(p, 2027, 2), 10)
  assert.equal(parcelaKAt(p, 2027, 3), 0)
})

test('antecipação: parcela futura marcada paga conta no mês dela, não no atual', () => {
  const p = { id: 'a', cartaoId: 'c_nubank', cartao: 'Nubank', valor: 300, n: 10, start: { y: 2026, m: 5 }, pagas: { 8: true } }
  const M = migrate({ liquido: 5000, cartoes: [{ nome: 'Nubank', itens: [] }], avulsos: [] })
  assert.equal(openPaid(M, [p], 2026, 6).paid, 0)      // jul: k=2 não paga
  assert.equal(openPaid(M, [p], 2027, 0).paid, 300)    // jan/27: k=8 antecipada
})

test('gastoTotal soma parcela mesmo se o cartão de origem não existe no mês (órfã)', () => {
  const p = { id: 'a', cartaoId: 'c_c6', cartao: 'C6', valor: 200, n: 5, start: { y: 2026, m: 6 }, pagas: {} }
  const M = migrate({ liquido: 5000, cartoes: [{ nome: 'Nubank', itens: [{ cat: 'X', valor: 100 }] }], avulsos: [] })
  assert.equal(gastoTotal(M, [p], 2026, 6), 300) // 100 + órfã 200
})

test('mergeLegacyPagas: converte pago-por-mês antigo e injeta cartaoId', () => {
  const db = {
    [PARCELAS_KEY]: { list: [{ id: 'b', cartao: 'Itaú', valor: 200, n: 5, start: { y: 2026, m: 4 } }] },
    [mkey(2026, 5)]: { liquido: 1, parcelasPagas: { b: true }, cartoes: [], avulsos: [] },
  }
  const { list, changed } = mergeLegacyPagas(db)
  assert.equal(changed, true)
  assert.equal(list[0].cartaoId, cardIdFromName('Itaú'))
  assert.equal(parcelaPaga(list[0], 2), true) // jun/26 = k2
})

test('templateMonth: mês novo traz cascas dos cartões + só itens recorrentes', () => {
  const db = { [mkey(2026, 6)]: migrate({ liquido: 4819, cartoes: [
    { nome: 'Nubank', venc: 10, itens: [{ cat: 'Streaming', valor: 50, rec: true }, { cat: 'Mercado', valor: 350 }] }
  ], avulsos: [{ nome: 'Aluguel', valor: 1500, rec: true }, { nome: 'IPVA', valor: 800 }] }) }
  const ago = templateMonth(db, 2026, 7, false)
  assert.equal(ago.cartoes.length, 1)
  assert.equal(ago.cartoes[0].venc, 10)
  assert.deepEqual(ago.cartoes[0].itens.map((i) => i.cat), ['Streaming'])
  assert.equal(ago.cartoes[0].itens[0].pago, false)
  assert.deepEqual(ago.avulsos.map((b) => b.nome), ['Aluguel'])
})

test('history inclui parcelas nos totais e ignora linhas especiais', () => {
  const p = { id: 'a', cartaoId: 'c_nubank', cartao: 'Nubank', valor: 300, n: 3, start: { y: 2026, m: 6 }, pagas: {} }
  const db = {
    [PARCELAS_KEY]: { list: [p] },
    limites: { map: { Mercado: 500 } },
    [mkey(2026, 6)]: migrate({ liquido: 5000, cartoes: [{ nome: 'Nubank', itens: [{ cat: 'Mercado', valor: 400 }] }], avulsos: [] }),
  }
  const h = history(db, [p])
  assert.equal(h.length, 1)
  assert.equal(h[0].total, 700)
  assert.equal(h[0].sobra, 4300)
})

console.log(`\n${passed} testes passaram.`)
