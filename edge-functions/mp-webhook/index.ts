import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ZAPI_INSTANCE = Deno.env.get('ZAPI_INSTANCE') || '';
const ZAPI_TOKEN = Deno.env.get('ZAPI_TOKEN') || '';
const ZAPI_CLIENT_TOKEN = Deno.env.get('ZAPI_CLIENT_TOKEN') || '';
// Configurar em: Painel MP → Configurações → Notificações → Chave secreta
const MP_WEBHOOK_SECRET = Deno.env.get('MP_WEBHOOK_SECRET') || '';

// Verifica assinatura HMAC-SHA256 enviada pelo Mercado Pago.
// Retorna true se válida ou se MP_WEBHOOK_SECRET não estiver configurado (graceful degradation).
async function verifyMPSignature(req: Request, paymentId: string): Promise<boolean> {
  if (!MP_WEBHOOK_SECRET) return true;
  const signature = req.headers.get('x-signature') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const parts = Object.fromEntries(
    signature.split(',').map(p => { const [k, v] = p.split('='); return [k.trim(), v?.trim()]; })
  );
  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;

  const template = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(MP_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(template));
  const hex = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === v1;
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const paymentIdFromQuery = url.searchParams.get('data.id');
    const typeFromQuery = url.searchParams.get('type');
    const cotacaoIdFallback = url.searchParams.get('cotacao_id');
    let body: any = {};
    try { const text = await req.text(); if (text) body = JSON.parse(text); } catch(_) {}
    const type = typeFromQuery || body.type;
    const paymentId = paymentIdFromQuery || body.data?.id;
    console.log('Webhook - type:', type, 'paymentId:', paymentId);
    if (type !== 'payment' || !paymentId) return new Response('ok', { status: 200 });

    // Verificação de assinatura — impede webhooks falsos
    const valid = await verifyMPSignature(req, paymentId.toString());
    if (!valid) {
      console.log('Assinatura MP inválida, ignorando webhook');
      return new Response('unauthorized', { status: 401 });
    }

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const payment = await mpRes.json();
    console.log('Payment status:', payment.status);
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    let finalCotacaoId = payment.metadata?.cotacao_id || cotacaoIdFallback;
    if (!finalCotacaoId) {
      const { data: c } = await sb.from('cotacoes').select('id').eq('mp_payment_id', paymentId.toString()).single();
      if (!c) { console.log('cotacao não encontrada'); return new Response('ok', { status: 200 }); }
      finalCotacaoId = c.id;
    }
    await sb.from('cotacoes').update({
      mp_status: payment.status,
      status: payment.status === 'approved' ? 'pago' : payment.status === 'rejected' ? 'cancelado' : 'aguardando_pagamento',
    }).eq('id', finalCotacaoId);
    if (payment.status === 'approved') {
      const { data: cotacao } = await sb
        .from('cotacoes')
        .select('*, recommendations:recommendation_id(*, patients:patient_id(name, email, whatsapp, address))')
        .eq('id', finalCotacaoId)
        .single();
      if (cotacao) {
        const paciente = cotacao.recommendations?.patients;
        const numeroPedido = finalCotacaoId.slice(0, 8).toUpperCase();
        const valorTotal = parseFloat(cotacao.valor_total || 0).toFixed(2).replace('.', ',');
        const valorFarmacia = parseFloat(cotacao.valor_farmacia || 0).toFixed(2).replace('.', ',');

        // WhatsApp farmácia
        const msgFarmacia = `✅ *PAGAMENTO CONFIRMADO — Synka*\n\n📋 *Pedido:* ${numeroPedido}\n👤 *Paciente:* ${paciente?.name}\n📍 *Endereço:*\n${paciente?.address || 'Não informado'}\n\n💰 *Valor total:* R$ ${valorTotal}\n   → *Seu repasse: R$ ${valorFarmacia}*\n\n⏰ Prazo: ${cotacao.prazo || 'não informado'}\n\nPor favor, confirme respondendo *CONFIRMO*.`;
        if (cotacao.farmacia_wa && ZAPI_INSTANCE && ZAPI_TOKEN) {
          const num = cotacao.farmacia_wa.replace(/\D/g, '');
          const numBR = num.startsWith('55') ? num : '55' + num;
          const r = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
            body: JSON.stringify({ phone: numBR, message: msgFarmacia }),
          });
          console.log('WhatsApp farmácia:', JSON.stringify(await r.json()));
        }

        // WhatsApp paciente
        const msgPaciente = `✅ *Pedido confirmado — Synka*\n\n📋 *Pedido:* ${numeroPedido}\n🏪 *Farmácia:* ${cotacao.farmacia_nome}\n\n💰 *Total pago:* R$ ${valorTotal}\n   → Manipulado + frete: R$ ${valorFarmacia}\n   → Taxa Synka: R$ 8,00\n\n⏰ *Prazo de entrega:* ${cotacao.prazo || 'não informado'}\n📍 *Endereço de entrega:* ${paciente?.address || 'não informado'}\n\nAcompanhe seu pedido pelo app Synka!`;
        if (paciente?.whatsapp && ZAPI_INSTANCE && ZAPI_TOKEN) {
          const num = paciente.whatsapp.replace(/\D/g, '');
          const numBR = num.startsWith('55') ? num : '55' + num;
          const r = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
            body: JSON.stringify({ phone: numBR, message: msgPaciente }),
          });
          console.log('WhatsApp paciente:', JSON.stringify(await r.json()));
        }

        // Email paciente via Supabase
        if (paciente?.email) {
          await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
            body: JSON.stringify({
              to: paciente.email,
              subject: `✅ Pedido ${numeroPedido} confirmado — Synka`,
              html: `<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px"><div style="background:#1D9E75;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px"><h1 style="color:white;margin:0;font-size:22px">✅ Pedido Confirmado!</h1></div><p style="color:#333">Olá, <strong>${paciente.name}</strong>!</p><p>Seu pedido foi confirmado e a farmácia já foi notificada para iniciar o preparo.</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr style="background:#f5f7f6"><td style="padding:10px 14px;font-size:13px;color:#666">Pedido</td><td style="padding:10px 14px;font-weight:700">${numeroPedido}</td></tr><tr><td style="padding:10px 14px;font-size:13px;color:#666">Farmácia</td><td style="padding:10px 14px;font-weight:700">${cotacao.farmacia_nome}</td></tr><tr style="background:#f5f7f6"><td style="padding:10px 14px;font-size:13px;color:#666">Total pago</td><td style="padding:10px 14px;font-weight:700;color:#1D9E75">R$ ${valorTotal}</td></tr><tr><td style="padding:10px 14px;font-size:13px;color:#666">Prazo</td><td style="padding:10px 14px;font-weight:700">${cotacao.prazo || 'não informado'}</td></tr><tr style="background:#f5f7f6"><td style="padding:10px 14px;font-size:13px;color:#666">Endereço</td><td style="padding:10px 14px;font-weight:700">${paciente.address || 'não informado'}</td></tr></table><p style="font-size:12px;color:#999;text-align:center;margin-top:24px">Synka · synkasaude.com.br</p></div>`,
            }),
          }).catch(e => console.log('Email error:', e));
        }

        await sb.from('cotacoes').update({ status: 'em_preparo' }).eq('id', finalCotacaoId);
        console.log('✅ em_preparo, notificações enviadas');
      }
    }
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('Webhook error:', e);
    return new Response('error', { status: 500 });
  }
});
