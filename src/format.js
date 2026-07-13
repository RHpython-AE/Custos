export const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
export const MESES_LONG = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const fmt = (v) => BRL.format(isFinite(v) ? v : 0)
export const fmtBare = (v) => (v != null ? fmt(v).replace('R$', '').trim() : '')

export function parseBR(s) {
  if (s == null) return null
  s = String(s).trim()
  if (!s) return null
  s = s.replace(/[^\d.,-]/g, '')
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.')
  const v = parseFloat(s)
  return isNaN(v) ? null : v
}
