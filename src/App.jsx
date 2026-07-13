import { useEffect, useRef, useState } from 'react'
import { supabase, isConfigured } from './supabaseClient'
import { fmt, fmtBare, parseBR, MESES, MESES_LONG } from './format'
import {
  mkey, seedMonth, migrate, newCard, CARD_COLORS,
  cartaoTotal, avulsoTotal, gastoTotal, openPaid, parcelaPaga, mergeLegacyPagas,
  getParcelas, newParcelaId, activeParcelas, extraByCard,
  suggestCategorias, suggestBoletos, prevFilled, history, reminders,
  loadCache, saveCache, loadFromCloud, upsertRow, deleteRow, PARCELAS_KEY,
} from './store'

/* ---------- helpers ---------- */
function traduz(msg) {
  if (!msg) return 'Não foi possível autenticar.'
  const m = String(msg).toLowerCase()
  if (m.includes('invalid login')) return 'E-mail ou senha incorretos.'
  if (m.includes('already registered')) return 'Este e-mail já tem conta. Toque em "entrar".'
  if (m.includes('at least 6')) return 'A senha precisa de pelo menos 6 caracteres.'
  if (m.includes('not confirmed')) return 'Confirme seu e-mail antes de entrar.'
  if (m.includes('invalid api key')) return 'Chave da API inválida — confira as variáveis do deploy.'
  if (m.includes('rate limit')) return 'Muitas tentativas. Aguarde um instante.'
  return msg
}

function MoneyInput({ value, onChange, ariaLabel, big }) {
  const [txt, setTxt] = useState(fmtBare(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setTxt(fmtBare(value)) }, [value, focused])
  return (
    <div className={'amt' + (big ? ' big' : '')}>
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

function Sheet({ title, onClose, children }) {
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><span>{title}</span><button aria-label="Fechar" onClick={onClose}>×</button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

/* ---------- auth ---------- */
function Auth() {
  const [mode, setMode] = useState('in') // in | up | forgot
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false)

  async function submit() {
    setErr(''); setOk(''); setBusy(true)
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email)
        if (error) throw error
        setOk('Enviamos um link de redefinição para o seu e-mail.')
      } else if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password: pass })
        if (error) throw error
        setOk('Conta criada! Se pedir confirmação, veja seu e-mail e depois entre.')
      }
    } catch (e) { setErr(traduz(e.message)) } finally { setBusy(false) }
  }

  return (
    <div className="auth2">
      <div className="auth2-brand">
        <div className="logo xl">R$</div>
        <h1>Minha Sobra</h1>
        <p>Seu dinheiro, na palma da mão</p>
      </div>
      <div className="auth2-card">
        <h2>{mode === 'in' ? 'Entrar' : mode === 'up' ? 'Criar conta' : 'Recuperar senha'}</h2>
        <label className="a2-label">E-mail</label>
        <input className="a2-input" type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        {mode !== 'forgot' && (<>
          <label className="a2-label">Senha</label>
          <div className="a2-pass">
            <input className="a2-input" type={show ? 'text' : 'password'} placeholder="mínimo 6 caracteres" value={pass}
              onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
            <button className="a2-eye" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow(!show)}>{show ? '🙈' : '👁'}</button>
          </div>
        </>)}
        <button className="a2-primary" onClick={submit} disabled={busy}>
          {busy ? '...' : mode === 'in' ? 'Entrar' : mode === 'up' ? 'Criar conta' : 'Enviar link'}
        </button>
        {mode === 'in' && <button className="a2-link subtle" onClick={() => { setMode('forgot'); setErr(''); setOk('') }}>Esqueci minha senha</button>}
        <div className="a2-err">{err}</div>
        <div className="a2-ok">{ok}</div>
        <div className="a2-sep" />
        <button className="a2-link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(''); setOk('') }}>
          {mode === 'in' ? 'Não tem conta? Criar agora' : 'Já tenho conta — entrar'}
        </button>
      </div>
    </div>
  )
}

/* ---------- app ---------- */
export default function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  const [db, setDb] = useState({})
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [view, setView] = useState('mes')
  const [sync, setSync] = useState('idle')
  const [navHide, setNavHide] = useState(false)
  const timers = useRef({}); const syncTimer = useRef(null)

  useEffect(() => {
    if (!isConfigured) { setSession({ local: true, user: { email: 'modo local (sem nuvem)' } }); setReady(true); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') {
        const np = window.prompt('Digite a nova senha (mín. 6 caracteres):')
        if (np) supabase.auth.updateUser({ password: np }).then(({ error }) => alert(error ? traduz(error.message) : 'Senha atualizada.'))
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    const applyMerge = (base) => {
      const { list, changed } = mergeLegacyPagas(base)
      if (changed) {
        const nd = { ...base, [PARCELAS_KEY]: { list } }
        saveCache(nd); upsertRow(PARCELAS_KEY, { list }).catch(() => {})
        return nd
      }
      return base
    }
    setDb(applyMerge(loadCache()))
    loadFromCloud().then((cloud) => { if (cloud) setDb(applyMerge(cloud)) }).catch(() => {})
  }, [session])

  // esconder a barra de abas ao rolar para baixo
  useEffect(() => {
    let last = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      if (Math.abs(y - last) > 8) { setNavHide(y > last && y > 60); last = y }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const ym = mkey(year, month)
  const isNewMonth = db[ym] === undefined
  const firstEver = Object.keys(db).filter((k) => k !== PARCELAS_KEY).length === 0 && year === now.getFullYear() && month === now.getMonth()
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
  const commitParcelas = (list) => commitRow(PARCELAS_KEY, { list })
  const mutate = (fn) => { const c = JSON.parse(JSON.stringify(M)); fn(c); commit(c) }
  function removeThisMonth() {
    if (!confirm('Excluir todos os dados deste mês? Não dá para desfazer.')) return
    const nd = { ...db }; delete nd[ym]; setDb(nd); deleteRow(ym).catch(() => {})
  }

  if (!ready) return null
  if (!session) return <Auth />

  const monthOpts = []
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) for (let m = 0; m < 12; m++) monthOpts.push({ y, m })

  return (
    <div>
      <header>
        <div className="wrap">
          <div className="brand">
            <div className="logo">R$</div><h1>Minha Sobra</h1>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: sync === 'saved' ? 'var(--green)' : 'var(--muted)', minWidth: 62, textAlign: 'right' }}>
              {sync === 'saving' ? 'Salvando…' : sync === 'saved' ? 'Salvo ✓' : ''}
            </span>
            {view === 'mes' && (
              <select className="monthsel" aria-label="Mês e ano" value={`${year}-${month}`}
                onChange={(e) => { const [y, m] = e.target.value.split('-').map(Number); setYear(y); setMonth(m) }}>
                {monthOpts.map(({ y, m }) => <option key={`${y}-${m}`} value={`${y}-${m}`}>{MESES_LONG[m]} {y}</option>)}
              </select>
            )}
          </div>
        </div>
      </header>

      <main className="wrap">
        {view === 'mes' && <MesView M={M} mutate={mutate} db={db} parcelas={parcelas} commitParcelas={commitParcelas}
          year={year} month={month} isNewMonth={isNewMonth}
          onCopyPrev={() => { const p = prevFilled(db, year, month); if (p) commit(p) }}
          hasPrev={Boolean(prevFilled(db, year, month))}
          onDeleteMonth={removeThisMonth} monthLabel={`${MESES_LONG[month]} ${year}`} />}
        {view === 'hist' && <HistView db={db} parcelas={parcelas} goto={(y, m) => { setYear(y); setMonth(m); setView('mes') }} />}
        {view === 'gastos' && <GastosView db={db} parcelas={parcelas} />}
        {view === 'ajustes' && <AjustesView db={db} setDb={setDb} email={session.user.email} />}
      </main>

      <nav className={navHide ? 'hide' : ''}>
        {[['mes', '📅', 'Mês'], ['hist', '🗂️', 'Histórico'], ['gastos', '📊', 'Gastos'], ['ajustes', '⚙️', 'Ajustes']].map(([k, ic, lb]) => (
          <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            <span className="ic" aria-hidden="true">{ic}</span>{lb}
          </button>
        ))}
      </nav>
    </div>
  )
}

/* ---------- Mês ---------- */
function MesView({ M, mutate, db, parcelas, commitParcelas, year, month, isNewMonth, onCopyPrev, hasPrev, onDeleteMonth, monthLabel }) {
  const [sheet, setSheet] = useState(null)
  const cats = suggestCategorias(db); const bols = suggestBoletos(db)
  const extra = extraByCard(parcelas, year, month)
  const total = gastoTotal(M, parcelas, year, month)
  const liq = M.liquido || 0, sobra = liq - total, meta = M.meta || 0
  const { open, paid } = openPaid(M, parcelas, year, month)
  const pct = liq > 0 ? Math.round(total / liq * 100) : 0
  const rem = reminders(db, parcelas, year, month)
  const actives = activeParcelas(parcelas, year, month)
  const orphans = actives.filter(({ p }) => !M.cartoes.some((c) => c.nome === p.cartao))

  const toggleParcela = (id, k) => commitParcelas(parcelas.map((p) => p.id === id ? { ...p, pagas: { ...(p.pagas || {}), [k]: !parcelaPaga(p, k) } } : p))
  const removeParcela = (id) => { if (confirm('Remover esta compra parcelada de todos os meses?')) { commitParcelas(parcelas.filter((p) => p.id !== id)); setSheet(null) } }

  return (
    <section>
      <datalist id="dl-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="dl-bol">{bols.map((c) => <option key={c} value={c} />)}</datalist>

      {rem.length > 0 && (
        <div className="remind">
          {rem.map((r, i) => (
            <div className="remind-row" key={i}>
              <span className="ri" aria-hidden="true">{r.tipo === 'fatura' ? '📅' : '⚠️'}</span>
              <span className="rt">{r.texto}</span><span className="rv">{fmt(r.valor)}</span>
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
            <div className="cardhead2">
              <span className="dot-ro" style={{ background: c.cor }} />
              <div className="ch-main">
                <div className="ch-name">{c.nome || 'Cartão'}</div>
                <div className="ch-sub">{c.venc ? `vence dia ${c.venc}` : 'sem vencimento'} · {fmt(cartaoTotal(c, extra))}</div>
              </div>
              <button className="edit" aria-label="Editar cartão" onClick={() => setSheet({ t: 'card', ci })}>✎</button>
            </div>
            {c.itens.map((it, ii) => (
              <div className="line ro" key={ii}>
                <Chk on={it.pago} label="Marcar como pago" onClick={() => mutate((d) => { d.cartoes[ci].itens[ii].pago = !d.cartoes[ci].itens[ii].pago })} />
                <span className={'ro-name' + (it.pago ? ' paid' : '')}>{it.cat || 'Sem nome'}</span>
                <span className="ro-val">{fmt(it.valor)}</span>
                <button className="edit" aria-label="Editar item" onClick={() => setSheet({ t: 'item', ci, ii })}>✎</button>
              </div>
            ))}
            {cardParcelas.map(({ p, k }) => (
              <div className="line ro pline" key={p.id}>
                <Chk on={parcelaPaga(p, k)} label="Marcar parcela como paga" onClick={() => toggleParcela(p.id, k)} />
                <span className={'ro-name' + (parcelaPaga(p, k) ? ' paid' : '')}>{p.desc} <span className="pbadge">{k}/{p.n}</span></span>
                <span className="ro-val">{fmt(p.valor)}</span>
                <button className="edit" aria-label="Ver parcelas" onClick={() => setSheet({ t: 'parc', id: p.id })}>✎</button>
              </div>
            ))}
            <button className="addbtn" onClick={() => setSheet({ t: 'item', ci, ii: null })}>+ Adicionar gasto</button>
          </div>
        )
      })}
      {orphans.length > 0 && (
        <div className="card">
          <div className="cardhead2"><span className="dot-ro" style={{ background: 'var(--muted)' }} />
            <div className="ch-main"><div className="ch-name">Parcelas (outros cartões)</div><div className="ch-sub">cartão original não está neste mês</div></div></div>
          {orphans.map(({ p, k }) => (
            <div className="line ro pline" key={p.id}>
              <Chk on={parcelaPaga(p, k)} label="Marcar parcela como paga" onClick={() => toggleParcela(p.id, k)} />
              <span className={'ro-name' + (parcelaPaga(p, k) ? ' paid' : '')}>{p.desc} <span className="pbadge">{k}/{p.n}</span></span>
              <span className="ro-val">{fmt(p.valor)}</span>
              <button className="edit" aria-label="Ver parcelas" onClick={() => setSheet({ t: 'parc', id: p.id })}>✎</button>
            </div>
          ))}
        </div>
      )}
      <button className="addbtn" style={{ borderStyle: 'solid', fontWeight: 800 }} onClick={() => setSheet({ t: 'card', ci: null })}>+ Adicionar cartão</button>

      <div className="sec-title">Boletos à parte</div>
      <div className="card">
        {M.avulsos.map((b, i) => (
          <div className="line ro" key={i}>
            <Chk on={b.pago} label="Marcar como pago" onClick={() => mutate((d) => { d.avulsos[i].pago = !d.avulsos[i].pago })} />
            <span className={'ro-name' + (b.pago ? ' paid' : '')}>{b.nome || 'Sem nome'}</span>
            <span className="ro-val">{fmt(b.valor)}</span>
            <button className="edit" aria-label="Editar boleto" onClick={() => setSheet({ t: 'boleto', ii: i })}>✎</button>
          </div>
        ))}
        <button className="addbtn" onClick={() => setSheet({ t: 'boleto', ii: null })}>+ Adicionar boleto</button>
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
        <div className="field"><label>VR / VA</label>
          <MoneyInput value={M.vr} ariaLabel="VR ou VA" onChange={(v) => mutate((d) => { d.vr = v })} /></div>
        <div className="note">Informativo — não entra na sobra da conta.</div>
      </div>

      <div className="sec-title">Reserva</div>
      <div className="card">
        <div className="field"><label>Meta de reserva</label>
          <MoneyInput value={M.meta} ariaLabel="Meta de reserva" onChange={(v) => mutate((d) => { d.meta = v })} /></div>
        <div className="row" style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 12 }}>
          <span className="k">Sobra após reserva</span><span className="v">{fmt(sobra - meta)}</span>
        </div>
      </div>

      {!isNewMonth && <button className="danger" onClick={onDeleteMonth}>Excluir dados deste mês</button>}

      {/* ---------- sheets ---------- */}
      {sheet?.t === 'item' && (
        <ItemSheet
          card={M.cartoes[sheet.ci]}
          initial={sheet.ii != null ? M.cartoes[sheet.ci].itens[sheet.ii] : null}
          allowParcelado={sheet.ii == null}
          year={year} month={month}
          onSave={(cat, valor) => { mutate((d) => { if (sheet.ii != null) { d.cartoes[sheet.ci].itens[sheet.ii].cat = cat; d.cartoes[sheet.ci].itens[sheet.ii].valor = valor } else { d.cartoes[sheet.ci].itens.push({ cat, valor, pago: false }) } }); setSheet(null) }}
          onSaveParcelado={(desc, valor, n, start) => { commitParcelas([...parcelas, { id: newParcelaId(), cartao: M.cartoes[sheet.ci].nome, desc, valor, n, start, pagas: {} }]); setSheet(null) }}
          onDelete={sheet.ii != null ? () => { mutate((d) => { d.cartoes[sheet.ci].itens.splice(sheet.ii, 1) }); setSheet(null) } : null}
          onClose={() => setSheet(null)} />
      )}
      {sheet?.t === 'boleto' && (
        <BoletoSheet
          initial={sheet.ii != null ? M.avulsos[sheet.ii] : null}
          onSave={(nome, valor) => { mutate((d) => { if (sheet.ii != null) { d.avulsos[sheet.ii].nome = nome; d.avulsos[sheet.ii].valor = valor } else { d.avulsos.push({ nome, valor, pago: false }) } }); setSheet(null) }}
          onDelete={sheet.ii != null ? () => { mutate((d) => { d.avulsos.splice(sheet.ii, 1) }); setSheet(null) } : null}
          onClose={() => setSheet(null)} />
      )}
      {sheet?.t === 'card' && (
        <CardSheet
          initial={sheet.ci != null ? M.cartoes[sheet.ci] : null}
          onSave={(nome, cor, venc) => { mutate((d) => { if (sheet.ci != null) { d.cartoes[sheet.ci].nome = nome; d.cartoes[sheet.ci].cor = cor; d.cartoes[sheet.ci].venc = venc } else { const nc = newCard(d.cartoes.length); nc.nome = nome || nc.nome; nc.cor = cor; nc.venc = venc; d.cartoes.push(nc) } }); setSheet(null) }}
          onDelete={sheet.ci != null ? () => { if (confirm(`Remover o cartão "${M.cartoes[sheet.ci].nome}" e seus itens deste mês?`)) { mutate((d) => { d.cartoes.splice(sheet.ci, 1) }); setSheet(null) } } : null}
          onClose={() => setSheet(null)} />
      )}
      {sheet?.t === 'parc' && (() => {
        const p = parcelas.find((x) => x.id === sheet.id)
        return p ? <ParcelaSheet p={p} onToggle={(k) => toggleParcela(p.id, k)} onDelete={() => removeParcela(p.id)} onClose={() => setSheet(null)} /> : null
      })()}
    </section>
  )
}

/* ---------- sheets ---------- */
function ItemSheet({ card, initial, allowParcelado, year, month, onSave, onSaveParcelado, onDelete, onClose }) {
  const [nome, setNome] = useState(initial ? (initial.cat || '') : '')
  const [valor, setValor] = useState(initial ? initial.valor : null)
  const [tipo, setTipo] = useState('avista')
  const [np, setNp] = useState(2)
  const [sm, setSm] = useState(month); const [sy, setSy] = useState(year)
  const parcelado = allowParcelado && tipo === 'parcelado'
  function save() {
    if (!nome.trim()) { alert('Dê um nome/categoria ao gasto.'); return }
    if (valor == null || valor <= 0) { alert('Informe o valor.'); return }
    if (parcelado) {
      const n = parseInt(np)
      if (!n || n < 2) { alert('Parcelado precisa de 2 ou mais parcelas.'); return }
      onSaveParcelado(nome.trim(), valor, n, { y: sy, m: sm })
    } else onSave(nome.trim(), valor)
  }
  return (
    <Sheet title={initial ? 'Editar gasto' : `Novo gasto — ${card?.nome || 'Cartão'}`} onClose={onClose}>
      {allowParcelado && (
        <div className="seg">
          <button className={tipo === 'avista' ? 'on' : ''} onClick={() => setTipo('avista')}>À vista</button>
          <button className={tipo === 'parcelado' ? 'on' : ''} onClick={() => setTipo('parcelado')}>Parcelado</button>
        </div>
      )}
      <label className="s-label">{parcelado ? 'Descrição da compra' : 'Categoria'}</label>
      <input className="s-input" list="dl-cats" value={nome} placeholder={parcelado ? 'Ex.: Notebook' : 'Ex.: Mercado'} onChange={(e) => setNome(e.target.value)} />
      <label className="s-label">{parcelado ? 'Valor de cada parcela' : 'Valor'}</label>
      <MoneyInput big value={valor} ariaLabel="Valor" onChange={setValor} />
      {parcelado && (<>
        <label className="s-label">Número de parcelas</label>
        <input className="s-input" inputMode="numeric" value={np} onChange={(e) => setNp(e.target.value.replace(/\D/g, ''))} />
        <label className="s-label">Primeira parcela em</label>
        <div className="s-row">
          <select value={sm} onChange={(e) => setSm(parseInt(e.target.value))}>{MESES_LONG.map((m, i) => <option key={i} value={i}>{m}</option>)}</select>
          <select value={sy} onChange={(e) => setSy(parseInt(e.target.value))}>{[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </div>
        {valor > 0 && parseInt(np) >= 2 && <div className="s-hint">Total da compra: {fmt(valor * parseInt(np))} · entra automaticamente nos próximos meses</div>}
      </>)}
      <button className="s-primary" onClick={save}>{initial ? 'Salvar' : 'Adicionar'}</button>
      {onDelete && <button className="s-danger" onClick={() => { if (confirm('Excluir este gasto?')) onDelete() }}>Excluir</button>}
    </Sheet>
  )
}

function BoletoSheet({ initial, onSave, onDelete, onClose }) {
  const [nome, setNome] = useState(initial ? (initial.nome || '') : '')
  const [valor, setValor] = useState(initial ? initial.valor : null)
  function save() {
    if (!nome.trim()) { alert('Dê um nome ao boleto.'); return }
    if (valor == null || valor <= 0) { alert('Informe o valor.'); return }
    onSave(nome.trim(), valor)
  }
  return (
    <Sheet title={initial ? 'Editar boleto' : 'Novo boleto'} onClose={onClose}>
      <label className="s-label">Descrição</label>
      <input className="s-input" list="dl-bol" value={nome} placeholder="Ex.: Aluguel" onChange={(e) => setNome(e.target.value)} />
      <label className="s-label">Valor</label>
      <MoneyInput big value={valor} ariaLabel="Valor" onChange={setValor} />
      <button className="s-primary" onClick={save}>{initial ? 'Salvar' : 'Adicionar'}</button>
      {onDelete && <button className="s-danger" onClick={() => { if (confirm('Excluir este boleto?')) onDelete() }}>Excluir</button>}
    </Sheet>
  )
}

function CardSheet({ initial, onSave, onDelete, onClose }) {
  const [nome, setNome] = useState(initial ? (initial.nome || '') : '')
  const [cor, setCor] = useState(initial ? initial.cor : CARD_COLORS[0])
  const [venc, setVenc] = useState(initial && initial.venc != null ? String(initial.venc) : '')
  function save() {
    if (!nome.trim()) { alert('Dê um nome ao cartão.'); return }
    const v = parseInt(venc)
    onSave(nome.trim(), cor, isNaN(v) ? null : Math.min(31, Math.max(1, v)))
  }
  return (
    <Sheet title={initial ? 'Editar cartão' : 'Novo cartão'} onClose={onClose}>
      <label className="s-label">Nome do cartão</label>
      <input className="s-input" value={nome} placeholder="Ex.: Nubank" onChange={(e) => setNome(e.target.value)} />
      <label className="s-label">Cor</label>
      <div className="s-colors">
        {CARD_COLORS.map((c) => <button key={c} className={'s-dot' + (cor === c ? ' on' : '')} style={{ background: c }} aria-label={'Cor ' + c} onClick={() => setCor(c)} />)}
      </div>
      <label className="s-label">Dia de vencimento da fatura (opcional)</label>
      <input className="s-input" inputMode="numeric" value={venc} placeholder="Ex.: 10" onChange={(e) => setVenc(e.target.value.replace(/\D/g, ''))} />
      <button className="s-primary" onClick={save}>{initial ? 'Salvar' : 'Adicionar cartão'}</button>
      {onDelete && <button className="s-danger" onClick={onDelete}>Excluir cartão</button>}
    </Sheet>
  )
}

function ParcelaSheet({ p, onToggle, onDelete, onClose }) {
  const rows = []
  for (let k = 1; k <= p.n; k++) { let mm = p.start.m + k - 1, yy = p.start.y; while (mm > 11) { mm -= 12; yy += 1 } rows.push({ k, label: `${MESES[mm]}/${String(yy).slice(2)}` }) }
  const pagasN = rows.filter(({ k }) => parcelaPaga(p, k)).length
  const restante = (p.n - pagasN) * (p.valor || 0)
  return (
    <Sheet title={p.desc} onClose={onClose}>
      <div className="s-hint" style={{ marginTop: 0 }}>{p.cartao} · {fmt(p.valor)}/parcela · {pagasN} de {p.n} pagas · restam {fmt(restante)}</div>
      <div className="parc-grid">
        {rows.map(({ k, label }) => (
          <button key={k} className={'parc-cell' + (parcelaPaga(p, k) ? ' on' : '')} onClick={() => onToggle(k)}>
            <span className="pc-k">{k}/{p.n}</span><span className="pc-m">{label}</span><span className="pc-v">{parcelaPaga(p, k) ? 'paga ✓' : fmt(p.valor)}</span>
          </button>
        ))}
      </div>
      <div className="s-hint">Toque em qualquer parcela para marcar como paga — inclusive futuras, se você antecipar.</div>
      <button className="s-danger" onClick={onDelete}>Excluir parcelamento</button>
    </Sheet>
  )
}

/* ---------- Histórico ---------- */
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

/* ---------- Gastos ---------- */
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

/* ---------- Ajustes ---------- */
function AjustesView({ db, setDb, email }) {
  const fileRef = useRef(null)
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
  async function ativarNotif() {
    if (typeof Notification === 'undefined') { alert('Este navegador não suporta notificações.'); return }
    const p = await Notification.requestPermission(); setPerm(p)
    if (p === 'granted') {
      try {
        const key = import.meta.env.VITE_VAPID_PUBLIC_KEY
        if (key && 'serviceWorker' in navigator && supabase) {
          const reg = await navigator.serviceWorker.ready
          const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) })
          const { data: u } = await supabase.auth.getUser()
          if (u?.user?.id) await supabase.from('push_subscriptions').upsert({ user_id: u.user.id, subscription: sub, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
        }
        alert('Notificações ativadas.')
      } catch { alert('Permitido, mas o push ainda não está configurado no servidor. Lembretes no app seguem funcionando.') }
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
      <div className="sec-title">Backup dos dados</div>
      <button className="aj" onClick={exportBackup}><span>Exportar backup</span><span className="s">baixar .json ›</span></button>
      <button className="aj" onClick={() => fileRef.current.click()}><span>Importar backup</span><span className="s">de um arquivo ›</span></button>
      <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={importBackup} />
      <div className="info">Seus dados ficam na sua conta (nuvem) e em cache neste aparelho para funcionar offline.</div>
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
