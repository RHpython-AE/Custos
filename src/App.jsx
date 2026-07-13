import { useEffect, useRef, useState } from 'react'
import { supabase, isConfigured } from './supabaseClient'
import { fmt, fmtBare, parseBR, MESES } from './format'
import {
  mkey, seedMonth, migrate, newCard, CARD_COLORS,
  cartaoTotalBase, cartaoTotal, avulsoTotal, gastoTotal, openPaid,
  getParcelas, newParcelaId, activeParcelas, extraByCard, parcelaKAt,
  suggestCategorias, suggestBoletos, prevFilled, history, reminders,
  loadCache, saveCache, loadFromCloud, upsertRow, deleteRow,
} from './store'

function MoneyInput({ value, onChange, ariaLabel }) {
  const [txt, setTxt] = useState(fmtBare(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setTxt(fmtBare(value)) }, [value, focused])
  return (
    <div className="amt">
      <span className="cur">R$</span>
      <input className="money" inputMode="decimal" aria-label={ariaLabel || 'valor'} value={txt}
        onFocus={() => { setFocused(true); setTxt(value != null ? String(value).replace('.', ',') : '') }}
        onChange={(e) => { setTxt(e.target.value); onChange(parseBR(e.target.value)) }}
        onBlur={() => { setFocused(false); setTxt(fmtBare(value)) }} />
    </div>
  )
}

function Chk({ on, onClick, label }) {
  return <button className={'chk' + (on ? ' on' : '')} aria-label={label} aria-pressed={on} onClick={onClick}>{on ? '✓' : ''}</button>
}

function Auth() {
  const [mode, setMode] = useState('in'); const [email, setEmail] = useState(''); const [pass, setPass] = useState('')
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false)
  async function submit() {
    setErr(''); setOk(''); setBusy(true)
    try {
      if (mode === 'in') { const { error } = await supabase.auth.signInWithPassword({ email, password: pass }); if (error) throw error }
      else { const { error } = await supabase.auth.signUp({ email, password: pass }); if (error) throw error; setOk('Conta criada. Se exigir confirmação por e-mail, confirme e entre.') }
    } catch (e) { setErr(e.message || 'Não foi possível autenticar.') } finally { setBusy(false) }
  }
  return (
    <div className="auth">
      <div className="logo">R$</div><h1>Minha Sobra</h1>
      <p>{mode === 'in' ? 'Entre na sua conta' : 'Crie sua conta'}</p>
      <input type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" placeholder="senha" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      <button className="primary" onClick={submit} disabled={busy}>{busy ? '...' : mode === 'in' ? 'Entrar' : 'Criar conta'}</button>
      <button className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(''); setOk('') }}>{mode === 'in' ? 'Não tem conta? Criar agora' : 'Já tenho conta — entrar'}</button>
      <div className="err">{err}</div><div className="ok">{ok}</div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  const [db, setDb] = useState({})
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [view, setView] = useState('mes')
  const [sync, setSync] = useState('idle')
  const timers = useRef({}); const syncTimer = useRef(null)

  useEffect(() => {
    if (!isConfigured) { setSession({ local: true, user: { email: 'modo local (sem nuvem)' } }); setReady(true); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!session) return
    setDb(loadCache())
    loadFromCloud().then((cloud) => { if (cloud) setDb(cloud) }).catch(() => {})
  }, [session])

  const ym = mkey(year, month)
  const isNewMonth = db[ym] === undefined
  const firstEver = Object.keys(db).filter((k) => k !== 'parcelas').length === 0 && year === now.getFullYear() && month === now.getMonth()
  const M = migrate(db[ym] ? { ...db[ym] } : seedMonth(firstEver))
  const parcelas = getParcelas(db)

  function commitRow(key, next) {
    const nd = { ...db, [key]: next }
    setDb(nd); saveCache(nd); setSync('saving')
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => {
      upsertRow(key, next).then(() => { setSync('saved'); clearTimeout(syncTimer.current); syncTimer.current = setTimeout(() => setSync('idle'), 1500) }).catch(() => setSync('idle'))
    }, 500)
  }
  const commit = (next) => commitRow(ym, next)
  const commitParcelas = (list) => commitRow('parcelas', { list })
  const mutate = (fn) => { const c = JSON.parse(JSON.stringify(M)); fn(c); commit(c) }
  function removeThisMonth() {
    if (!confirm('Excluir todos os dados deste mês? Não dá para desfazer.')) return
    const nd = { ...db }; delete nd[ym]; setDb(nd); deleteRow(ym).catch(() => {})
  }

  if (!ready) return null
  if (!session) return <Auth />

  const localMode = !isConfigured
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

  return (
    <div>
      <header>
        <div className="wrap">
          <div className="brand">
            <div className="logo">R$</div><h1>Minha Sobra</h1>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: sync === 'saved' ? 'var(--green)' : 'var(--muted)', minWidth: 62, textAlign: 'right' }}>
              {sync === 'saving' ? 'Salvando…' : sync === 'saved' ? 'Salvo ✓' : ''}
            </span>
            <select className="yearsel" style={{ marginLeft: 8 }} value={year} onChange={(e) => setYear(parseInt(e.target.value))} aria-label="Ano">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {view === 'mes' && (
            <div className="months">
              {MESES.map((m, i) => <button key={i} className={'chip' + (i === month ? ' active' : '')} onClick={() => setMonth(i)}>{m}</button>)}
            </div>
          )}
        </div>
      </header>

      <main className="wrap">
        {localMode && view === 'mes' && (
          <div className="banner" style={{ marginTop: 12 }}>Modo local: sem login e sem nuvem. Os dados ficam só neste navegador — ótimo para testar. Configure o Supabase para ativar login e sincronização.</div>
        )}
        {view === 'mes' && <MesView M={M} mutate={mutate} db={db} parcelas={parcelas} year={year} month={month}
          isNewMonth={isNewMonth} onCopyPrev={() => { const p = prevFilled(db, year, month); if (p) commit(p) }}
          hasPrev={Boolean(prevFilled(db, year, month))} onDeleteMonth={removeThisMonth} monthLabel={`${MESES[month]} ${year}`} />}
        {view === 'parcelas' && <ParcelasView db={db} parcelas={parcelas} commitParcelas={commitParcelas} year={year} month={month} />}
        {view === 'hist' && <HistView db={db} parcelas={parcelas} goto={(y, m) => { setYear(y); setMonth(m); setView('mes') }} />}
        {view === 'gastos' && <GastosView db={db} parcelas={parcelas} />}
        {view === 'ajustes' && <AjustesView db={db} setDb={setDb} email={session.user.email} />}
      </main>

      <nav>
        {[['mes', '📅', 'Mês'], ['parcelas', '🧾', 'Parcelas'], ['hist', '🗂️', 'Histórico'], ['gastos', '📊', 'Gastos'], ['ajustes', '⚙️', 'Ajustes']].map(([k, ic, lb]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}><span className="ic" aria-hidden="true">{ic}</span>{lb}</button>
        ))}
      </nav>
    </div>
  )
}

function MesView({ M, mutate, db, parcelas, year, month, isNewMonth, onCopyPrev, hasPrev, onDeleteMonth, monthLabel }) {
  const cats = suggestCategorias(db); const bols = suggestBoletos(db)
  const extra = extraByCard(parcelas, year, month)
  const total = gastoTotal(M, parcelas, year, month)
  const liq = M.liquido || 0, sobra = liq - total, meta = M.meta || 0
  const { open, paid } = openPaid(M, parcelas, year, month)
  const pct = liq > 0 ? Math.round(total / liq * 100) : 0
  const rem = reminders(db, parcelas, year, month)
  const actives = activeParcelas(parcelas, year, month)

  return (
    <section>
      <datalist id="dl-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="dl-bol">{bols.map((c) => <option key={c} value={c} />)}</datalist>

      {rem.length > 0 && (
        <div className="remind">
          {rem.map((r, i) => (
            <div className="remind-row" key={i}>
              <span className="ri" aria-hidden="true">{r.tipo === 'fatura' ? '📅' : '⚠️'}</span>
              <span className="rt">{r.texto}</span>
              <span className="rv">{fmt(r.valor)}</span>
            </div>
          ))}
        </div>
      )}

      {isNewMonth && hasPrev && (
        <div className="banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>Começar {monthLabel} a partir do mês anterior?</span>
          <button className="chip" onClick={onCopyPrev}>Copiar</button>
        </div>
      )}

      <div className={'card hero ' + (sobra < 0 ? 'neg' : 'pos')}>
        <div className="lbl">Sobra em conta</div>
        <div className="big">{fmt(sobra)}</div>
        <div className="sub">{liq > 0 ? `${pct}% do líquido comprometido` : 'Informe o líquido em conta'}</div>
      </div>

      <div className="card">
        <div className="field"><label>Líquido em conta</label>
          <MoneyInput value={M.liquido} ariaLabel="Líquido em conta" onChange={(v) => mutate((d) => { d.liquido = v })} /></div>
      </div>

      <div className="sec-title">Cartões</div>
      {M.cartoes.map((c, ci) => {
        const cardParcelas = actives.filter(({ p }) => p.cartao === c.nome)
        return (
          <div className="card" key={ci}>
            <div className="cardhead">
              <button className="dot" aria-label="Trocar cor do cartão" style={{ background: c.cor }}
                onClick={() => mutate((d) => { const idx = CARD_COLORS.indexOf(d.cartoes[ci].cor); d.cartoes[ci].cor = CARD_COLORS[(idx + 1) % CARD_COLORS.length] })} />
              <input value={c.nome} placeholder="Nome do cartão" aria-label="Nome do cartão" onChange={(e) => mutate((d) => { d.cartoes[ci].nome = e.target.value })} />
              <div className="venc">vence dia
                <input inputMode="numeric" value={c.venc ?? ''} placeholder="—" aria-label="Dia de vencimento"
                  onChange={(e) => mutate((d) => { const n = parseInt(e.target.value); d.cartoes[ci].venc = isNaN(n) ? null : Math.min(31, Math.max(1, n)) })} />
              </div>
              <button className="del" aria-label="Remover cartão" onClick={() => { if (confirm(`Remover o cartão "${c.nome || 'sem nome'}" e seus itens?`)) mutate((d) => { d.cartoes.splice(ci, 1) }) }}>🗑</button>
            </div>
            {c.itens.map((it, ii) => (
              <div className="line" key={ii}>
                <Chk on={it.pago} label="Marcar como pago" onClick={() => mutate((d) => { d.cartoes[ci].itens[ii].pago = !d.cartoes[ci].itens[ii].pago })} />
                <input className={'desc' + (it.pago ? ' paid' : '')} list="dl-cats" value={it.cat} placeholder="Categoria" aria-label="Categoria"
                  onChange={(e) => mutate((d) => { d.cartoes[ci].itens[ii].cat = e.target.value })} />
                <MoneyInput value={it.valor} ariaLabel="Valor" onChange={(v) => mutate((d) => { d.cartoes[ci].itens[ii].valor = v })} />
                <button className="del" aria-label="Remover item" onClick={() => mutate((d) => { d.cartoes[ci].itens.splice(ii, 1) })}>×</button>
              </div>
            ))}
            {cardParcelas.map(({ p, k }) => {
              const pago = !!(M.parcelasPagas && M.parcelasPagas[p.id])
              return (
                <div className="line pline" key={p.id}>
                  <Chk on={pago} label="Marcar parcela como paga" onClick={() => mutate((d) => { d.parcelasPagas[p.id] = !d.parcelasPagas[p.id] })} />
                  <div className={'pdesc' + (pago ? ' paid' : '')}>{p.desc} <span className="pbadge">{k}/{p.n}</span></div>
                  <div className="pval">{fmt(p.valor)}</div>
                  <span style={{ width: 30 }} />
                </div>
              )
            })}
            <button className="addbtn" onClick={() => mutate((d) => { d.cartoes[ci].itens.push({ cat: '', valor: null, pago: false }) })}>+ Adicionar categoria</button>
            <div className="subt"><span>Subtotal</span><span>{fmt(cartaoTotal(c, extra))}</span></div>
          </div>
        )
      })}
      <button className="addbtn" style={{ borderStyle: 'solid', fontWeight: 800 }} onClick={() => mutate((d) => { d.cartoes.push(newCard(d.cartoes.length)) })}>+ Adicionar cartão</button>

      <div className="sec-title">Boletos à parte</div>
      <div className="card">
        {M.avulsos.map((b, i) => (
          <div className="line" key={i}>
            <Chk on={b.pago} label="Marcar como pago" onClick={() => mutate((d) => { d.avulsos[i].pago = !d.avulsos[i].pago })} />
            <input className={'desc' + (b.pago ? ' paid' : '')} list="dl-bol" value={b.nome} placeholder="Descrição" aria-label="Descrição"
              onChange={(e) => mutate((d) => { d.avulsos[i].nome = e.target.value })} />
            <MoneyInput value={b.valor} ariaLabel="Valor" onChange={(v) => mutate((d) => { d.avulsos[i].valor = v })} />
            <button className="del" aria-label="Remover boleto" onClick={() => mutate((d) => { d.avulsos.splice(i, 1) })}>×</button>
          </div>
        ))}
        <button className="addbtn" onClick={() => mutate((d) => { d.avulsos.push({ nome: '', valor: null, pago: false }) })}>+ Adicionar boleto</button>
        <div className="subt"><span>Total boletos à parte</span><span>{fmt(avulsoTotal(M))}</span></div>
      </div>

      <div className="card">
        <div className="grand"><span>Total de gastos</span><span>{fmt(total)}</span></div>
        <div className="openpaid">
          <div className="op open"><span>Em aberto</span><b>{fmt(open)}</b></div>
          <div className="op paid"><span>Pago</span><b>{fmt(paid)}</b></div>
        </div>
      </div>

      <div className="card vr">
        <span className="tag">Cartão à parte</span>
        <div className="field"><label>VR / VA</label><MoneyInput value={M.vr} ariaLabel="VR ou VA" onChange={(v) => mutate((d) => { d.vr = v })} /></div>
        <div className="note">Informativo — não entra na sobra da conta.</div>
      </div>

      <div className="sec-title">Reserva</div>
      <div className="card">
        <div className="field"><label>Meta de reserva</label><MoneyInput value={M.meta} ariaLabel="Meta de reserva" onChange={(v) => mutate((d) => { d.meta = v })} /></div>
        <div className="row" style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 12 }}>
          <span className="k">Sobra após reserva</span><span className="v">{fmt(sobra - meta)}</span>
        </div>
      </div>

      {!isNewMonth && <button className="danger" onClick={onDeleteMonth}>Excluir dados deste mês</button>}
    </section>
  )
}

function ParcelasView({ db, parcelas, commitParcelas, year, month }) {
  const [desc, setDesc] = useState('')
  const [cartao, setCartao] = useState('')
  const [valor, setValor] = useState(null)
  const [n, setN] = useState(2)
  const [sy, setSy] = useState(year); const [sm, setSm] = useState(month)
  const cardNames = [...new Set(Object.keys(db).filter((k) => k !== 'parcelas').flatMap((k) => (migrate(db[k]).cartoes || []).map((c) => c.nome)).filter(Boolean))]

  function add() {
    if (!desc.trim() || !valor || n < 1) { alert('Preencha descrição, valor da parcela e nº de parcelas.'); return }
    const p = { id: newParcelaId(), cartao: cartao.trim() || (cardNames[0] || 'Cartão 1'), desc: desc.trim(), valor, n: parseInt(n), start: { y: sy, m: sm } }
    commitParcelas([...parcelas, p]); setDesc(''); setValor(null); setN(2)
  }
  function remove(id) { if (confirm('Remover esta compra parcelada de todos os meses?')) commitParcelas(parcelas.filter((p) => p.id !== id)) }
  const endLabel = (p) => { let em = p.start.m + p.n - 1, ey = p.start.y; while (em > 11) { em -= 12; ey += 1 } return `${MESES[em]}/${String(ey).slice(2)}` }

  return (
    <section>
      <div className="sec-title">Nova compra parcelada</div>
      <div className="card">
        <div className="prow"><label>Descrição</label><input className="pin" value={desc} placeholder="Ex.: Notebook" onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="prow"><label>Cartão</label><input className="pin" list="dl-cards" value={cartao} placeholder={cardNames[0] || 'Cartão'} onChange={(e) => setCartao(e.target.value)} />
          <datalist id="dl-cards">{cardNames.map((c) => <option key={c} value={c} />)}</datalist></div>
        <div className="prow"><label>Valor da parcela</label><MoneyInput value={valor} ariaLabel="Valor da parcela" onChange={setValor} /></div>
        <div className="prow"><label>Nº de parcelas</label><input className="pin small" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, '') || '')} /></div>
        <div className="prow"><label>Começa em</label>
          <span style={{ display: 'flex', gap: 6 }}>
            <select value={sm} onChange={(e) => setSm(parseInt(e.target.value))} aria-label="Mês inicial">{MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}</select>
            <select value={sy} onChange={(e) => setSy(parseInt(e.target.value))} aria-label="Ano inicial">{[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </span>
        </div>
        <button className="addbtn" style={{ borderStyle: 'solid', fontWeight: 800 }} onClick={add}>Adicionar parcelamento</button>
      </div>

      <div className="sec-title">Parcelamentos ativos</div>
      <div className="card">
        {parcelas.length === 0 && <div className="empty" style={{ padding: '14px 0' }}>Nenhuma compra parcelada cadastrada.</div>}
        {parcelas.map((p) => {
          const k = parcelaKAt(p, year, month)
          const restantes = k ? p.n - k : (new Date(year, month) < new Date(p.start.y, p.start.m) ? p.n : 0)
          return (
            <div className="pitem" key={p.id}>
              <div className="pmain">
                <div className="pnm">{p.desc}</div>
                <div className="psub">{p.cartao} · {fmt(p.valor)}/mês · {MESES[p.start.m]}/{String(p.start.y).slice(2)} → {endLabel(p)}</div>
                <div className="pprog">{k ? `Parcela ${k} de ${p.n} neste mês` : 'Fora do mês selecionado'}{restantes > 0 ? ` · faltam ${restantes}` : k === p.n ? ' · última' : ''}</div>
              </div>
              <button className="del" aria-label="Remover parcelamento" onClick={() => remove(p.id)}>🗑</button>
            </div>
          )
        })}
      </div>
      <div className="info">Cada parcela entra automaticamente no cartão informado, no mês certo, e some quando acaba. O valor conta no total do mês e no "Onde mais gasto".</div>
    </section>
  )
}

function HistView({ db, parcelas, goto }) {
  const h = history(db, parcelas)
  const acc = h.reduce((a, x) => a + x.sobra, 0)
  const chrono = [...h].reverse().slice(-12)
  const max = Math.max(1, ...chrono.map((x) => Math.abs(x.sobra)))
  return (
    <section>
      <div className="summ">
        <div className="box"><div className="l">Meses salvos</div><div className="n">{h.length}</div></div>
        <div className="box"><div className="l">Sobra acumulada</div><div className="n">{fmt(acc)}</div></div>
      </div>
      <div className="sec-title">Sobra por mês (12 últimos)</div>
      <div className="card"><div className="bars">
        {chrono.map((x, i) => (
          <div className="bar-wrap" key={i}>
            <div className={'bar' + (x.sobra < 0 ? ' neg' : '')} style={{ height: Math.max(2, Math.abs(x.sobra) / max * 130) }} />
            <div className="bar-lbl">{MESES[x.m]}</div>
          </div>
        ))}
      </div></div>
      <div className="sec-title">Tudo que você salvou</div>
      <div className="card">
        {h.map((x, i) => (
          <div className="hitem" key={i} onClick={() => goto(x.y, x.m)}>
            <div className="mon">{MESES[x.m]} {String(x.y).slice(2)}</div>
            <div className="mid">Líquido <b>{fmt(x.liquido)}</b> · Gastos <b>{fmt(x.total)}</b></div>
            <div className={'sob ' + (x.sobra < 0 ? 'neg' : 'pos')}>{fmt(x.sobra)}</div><div className="chev">›</div>
          </div>
        ))}
      </div>
      {h.length === 0 && <div className="empty">Preencha um mês na aba "Mês" para começar seu histórico.</div>}
    </section>
  )
}

function GastosView({ db, parcelas }) {
  const h = history(db, parcelas)
  const byCard = {}, byCat = {}, cardColor = {}; let grand = 0
  h.forEach((x) => {
    x.d.cartoes.forEach((c) => {
      const cn = (c.nome || '').trim() || 'Cartão'; if (c.cor) cardColor[cn] = c.cor
      c.itens.forEach((it) => { const v = it.valor || 0; if (v <= 0) return; byCard[cn] = (byCard[cn] || 0) + v; const cat = (it.cat || '').trim() || 'Sem categoria'; byCat[cat] = (byCat[cat] || 0) + v; grand += v })
    })
    activeParcelas(parcelas, x.y, x.m).forEach(({ p }) => { const v = p.valor || 0; if (v <= 0) return; byCard[p.cartao] = (byCard[p.cartao] || 0) + v; byCat[p.desc] = (byCat[p.desc] || 0) + v; grand += v })
    const av = avulsoTotal(x.d); if (av > 0) byCard['Boletos à parte'] = (byCard['Boletos à parte'] || 0) + av
    x.d.avulsos.forEach((b) => { const v = b.valor || 0; if (v <= 0) return; const nm = (b.nome || '').trim() || 'Boleto'; byCat[nm] = (byCat[nm] || 0) + v; grand += v })
  })
  const Bars = ({ obj, colorize }) => {
    const rr = Object.entries(obj).sort((a, b) => b[1] - a[1]); const mx = rr.length ? rr[0][1] : 1
    return rr.map(([nm, v]) => (
      <div className="grow" key={nm}>
        <div className="top"><span className="nm">{nm}</span><span className="rt"><b>{fmt(v)}</b> · {grand > 0 ? Math.round(v / grand * 100) : 0}%</span></div>
        <div className="track"><i style={{ width: Math.max(3, v / mx * 100) + '%', background: colorize ? (cardColor[nm] || 'var(--muted)') : 'var(--green)' }} /></div>
      </div>
    ))
  }
  return (
    <section>
      <div className="summ">
        <div className="box"><div className="l">Total já gasto</div><div className="n">{fmt(grand)}</div></div>
        <div className="box"><div className="l">Média / mês</div><div className="n">{fmt(h.length ? grand / h.length : 0)}</div></div>
      </div>
      <div className="sec-title">Por cartão</div>
      <div className="card"><Bars obj={byCard} colorize /></div>
      <div className="sec-title">Onde mais gasto (categorias)</div>
      <div className="card"><Bars obj={byCat} /></div>
      {grand === 0 && <div className="empty">Ainda não há gastos lançados.</div>}
    </section>
  )
}

function AjustesView({ db, setDb, email }) {
  const fileRef = useRef(null)
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
  async function ativarNotif() {
    if (typeof Notification === 'undefined') { alert('Este navegador não suporta notificações.'); return }
    const p = await Notification.requestPermission(); setPerm(p)
    if (p === 'granted') {
      try {
        const key = import.meta.env.VITE_VAPID_PUBLIC_KEY
        if (key && 'serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready
          const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) })
          const { data: u } = await supabase.auth.getUser()
          if (u?.user?.id) await supabase.from('push_subscriptions').upsert({ user_id: u.user.id, subscription: sub, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
        }
        alert('Notificações ativadas.')
      } catch (e) { alert('Permitido, mas o push ainda não está configurado no servidor. Lembretes no app seguem funcionando.') }
    }
  }
  async function testar() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') { alert('Ative as notificações primeiro.'); return }
    try { const reg = await navigator.serviceWorker.ready; reg.showNotification('Minha Sobra', { body: 'Notificação de teste ✓', icon: 'icon-192.png' }) }
    catch { new Notification('Minha Sobra', { body: 'Notificação de teste ✓' }) }
  }
  function exportBackup() {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); const d = new Date()
    a.href = URL.createObjectURL(blob)
    a.download = `minhasobra-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`
    a.click(); URL.revokeObjectURL(a.href)
  }
  function importBackup(e) {
    const f = e.target.files[0]; if (!f) return
    const rd = new FileReader()
    rd.onload = async () => {
      try {
        const obj = JSON.parse(rd.result)
        if (confirm('Isso vai substituir os dados atuais por este backup e enviar para a nuvem. Continuar?')) {
          setDb(obj); saveCache(obj)
          for (const k in obj) { await upsertRow(k, obj[k]).catch(() => {}) }
          alert('Backup restaurado e sincronizado.')
        }
      } catch { alert('Arquivo inválido.') }
      e.target.value = ''
    }
    rd.readAsText(f)
  }
  return (
    <section>
      <div className="sec-title">Conta</div>
      <div className="card"><div className="row"><span className="k">Conectado como</span><span className="v">{email}</span></div></div>
      <button className="aj" onClick={() => supabase ? supabase.auth.signOut() : alert('Modo local: não há login para sair.')}><span>Sair</span><span className="s">›</span></button>
      <div className="sec-title">Notificações</div>
      <button className="aj" onClick={ativarNotif}><span>Ativar notificações</span><span className="s">{perm === 'granted' ? 'ativado ✓' : 'permitir ›'}</span></button>
      <button className="aj" onClick={testar}><span>Testar notificação</span><span className="s">›</span></button>
      <div className="info">Os lembretes dentro do app (fatura vencendo, valor em aberto) já funcionam sozinhos. O push com o app fechado depende da Edge Function configurada no servidor — veja o README.</div>
      <div className="sec-title">Backup dos dados</div>
      <button className="aj" onClick={exportBackup}><span>Exportar backup</span><span className="s">baixar .json ›</span></button>
      <button className="aj" onClick={() => fileRef.current.click()}><span>Importar backup</span><span className="s">de um arquivo ›</span></button>
      <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={importBackup} />
    </section>
  )
}

function urlB64(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64); const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

function ConfigNeeded() {
  return (
    <div className="auth">
      <div className="logo">R$</div><h1>Minha Sobra</h1>
      <p>Configuração pendente</p>
      <div className="banner" style={{ maxWidth: 320 }}>Defina <b>VITE_SUPABASE_URL</b> e <b>VITE_SUPABASE_ANON_KEY</b> nas variáveis de ambiente e recarregue. Veja o README.</div>
    </div>
  )
}
