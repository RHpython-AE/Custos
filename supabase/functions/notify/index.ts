// Supabase Edge Function — Minha Sobra: lembretes de fatura por push
// -------------------------------------------------------------------
// Este é um MODELO pronto para adaptar. Ele roda no servidor (Deno),
// idealmente agendado 1x/dia (pg_cron), varre as faturas que vencem em
// breve e envia push para os dispositivos inscritos.
//
// Pré-requisitos (ver README > Notificações):
//   - Gerar chaves VAPID (npx web-push generate-vapid-keys)
//   - Secrets no projeto: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//   - Deploy: supabase functions deploy notify
//   - Agendar com pg_cron (exemplo no README)
//
// Observação: o formato exato do envio de push (web-push) pode variar
// conforme a lib escolhida para Deno. Trate este arquivo como ponto de
// partida e ajuste os imports/chamadas ao publicar.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // service role: acesso total, só no servidor
)

// Quantos dias antes do vencimento avisar
const DIAS_AVISO = 3

Deno.serve(async () => {
  const hoje = new Date()
  const ym = `${hoje.getFullYear()}-${hoje.getMonth()}` // mês atual (mês 0..11)

  // 1) Pega o orçamento do mês atual de todos os usuários
  const { data: budgets, error } = await supabase
    .from('budgets')
    .select('user_id, data')
    .eq('ym', ym)
  if (error) return new Response(error.message, { status: 500 })

  // 2) Descobre quem tem fatura vencendo nos próximos DIAS_AVISO dias
  const alvos: Record<string, string[]> = {}
  for (const b of budgets ?? []) {
    const cartoes = (b.data?.cartoes ?? []) as Array<{ nome: string; venc: number | null }>
    for (const c of cartoes) {
      if (!c.venc) continue
      const diff = c.venc - hoje.getDate()
      if (diff >= 0 && diff <= DIAS_AVISO) {
        (alvos[b.user_id] ??= []).push(
          `Fatura ${c.nome} vence ${diff === 0 ? 'hoje' : 'em ' + diff + ' dia(s)'}`,
        )
      }
    }
  }

  // 3) Envia push para cada usuário alvo
  const userIds = Object.keys(alvos)
  if (userIds.length === 0) return new Response('nada a notificar', { status: 200 })

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('user_id, subscription')
    .in('user_id', userIds)

  for (const s of subs ?? []) {
    const msgs = alvos[s.user_id]
    const payload = JSON.stringify({ title: 'Minha Sobra', body: msgs.join(' · '), url: '.' })
    try {
      // TODO: enviar via web-push com as chaves VAPID.
      // Ex. (pseudo): await sendWebPush(s.subscription, payload, {
      //   publicKey: Deno.env.get('VAPID_PUBLIC_KEY'),
      //   privateKey: Deno.env.get('VAPID_PRIVATE_KEY'),
      //   subject: Deno.env.get('VAPID_SUBJECT'),
      // })
      console.log('push ->', s.user_id, payload)
    } catch (e) {
      console.error('falha push', s.user_id, e)
    }
  }

  return new Response(`notificados: ${userIds.length}`, { status: 200 })
})
