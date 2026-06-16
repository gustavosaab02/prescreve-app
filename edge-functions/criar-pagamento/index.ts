import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { cotacao_id, payment_method, card_token, installments, email_pagador } = await req.json();
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: cotacao, error } = await sb
      .from('cotacoes')
      .select('*, recommendations:recommendation_id(*, patients:patient_id(name, email, whatsapp, address))')
      .eq('id', cotacao_id)
      .single();
    if (error || !cotacao) return new Response(JSON.stringify({ error: 'Cotação não encontrada' }), { status: 404, headers: corsHeaders });
    const precoManipulado = parseFloat(cotacao.preco || 0);
    const valorFrete = parseFloat(cotacao.valor_frete || 0);
    const taxaSynka = 8;
    const valorTotal = parseFloat((precoManipulado + valorFrete + taxaSynka).toFixed(2));
    const valorFarmacia = parseFloat((precoManipulado + valorFrete).toFixed(2));
    const paymentPayload: any = {
      transaction_amount: valorTotal,
      description: `Manipulado - ${cotacao.farmacia_nome} via Synka`,
      payment_method_id: payment_method,
      payer: {
        email: email_pagador || cotacao.recommendations?.patients?.email,
        first_name: cotacao.recommendations?.patients?.name?.split(' ')[0] || '',
        last_name: cotacao.recommendations?.patients?.name?.split(' ').slice(1).join(' ') || '',
      },
      metadata: { cotacao_id, farmacia_nome: cotacao.farmacia_nome, farmacia_wa: cotacao.farmacia_wa, taxa_synka: taxaSynka, valor_farmacia: valorFarmacia },
      notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook?cotacao_id=${cotacao_id}`,
    };
    if (payment_method === 'credit_card' && card_token) { paymentPayload.token = card_token; paymentPayload.installments = installments || 1; }
    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': cotacao_id },
      body: JSON.stringify(paymentPayload),
    });
    const mpData = await mpRes.json();
    if (!mpRes.ok) return new Response(JSON.stringify({ error: 'Erro ao criar pagamento', details: mpData }), { status: 400, headers: corsHeaders });
    await sb.from('cotacoes').update({ mp_payment_id: mpData.id.toString(), mp_status: mpData.status, valor_total: valorTotal, taxa_synka: taxaSynka, valor_farmacia: valorFarmacia, payment_method, status: 'aguardando_pagamento' }).eq('id', cotacao_id);
    const response: any = { payment_id: mpData.id, status: mpData.status, valor_total: valorTotal };
    if (payment_method === 'pix') { response.pix_qr_code = mpData.point_of_interaction?.transaction_data?.qr_code; response.pix_qr_code_base64 = mpData.point_of_interaction?.transaction_data?.qr_code_base64; }
    return new Response(JSON.stringify(response), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('Erro:', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
