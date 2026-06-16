import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_KEY")!;

const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") || "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") || "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") || "";
const ZAPI_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;

async function extrairCotacaoComGPT(mensagem: string, nomeFarmacia: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: `Você é um assistente que extrai informações de orçamentos de farmácias de manipulação. Analise a mensagem e retorne um JSON com: is_cotacao: boolean, numero_pedido: string ou null, preco: number ou null, valor_frete: number ou null, prazo: string ou null, estimativa_entrega: string ou null, observacao: string ou null. Separe sempre o valor do manipulado do frete. Retorne APENAS o JSON.` },
        { role: "user", content: `Farmácia: ${nomeFarmacia}\nMensagem: ${mensagem}` },
      ],
    }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); }
  catch { return { preco: null, valor_frete: null, prazo: null, observacao: mensagem, is_cotacao: false, numero_pedido: null }; }
}

serve(async (req) => {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const phone = (body.phone || "").replace(/[^0-9]/g, "").replace(/^55/, "");
    const text = (body.text?.message || body.message || "").trim();
    const fromMe = body.fromMe || false;
    if (fromMe || !text || !phone) return new Response("ok", { headers: corsHeaders });
    const { data: farmacia } = await sb.from("farmacias_parceiras").select("*").ilike("whatsapp", `%${phone.slice(-8)}%`).single();
    if (!farmacia) return new Response("ok", { headers: corsHeaders });
    const extraido = await extrairCotacaoComGPT(text, farmacia.nome);
    if (!extraido.is_cotacao) return new Response("ok", { headers: corsHeaders });
    let cotacao = null;
    if (extraido.numero_pedido) {
      const { data } = await sb.from("cotacoes").select("*, recommendations(*, patients(name, whatsapp, expo_push_token))").eq("numero_pedido", extraido.numero_pedido).eq("status", "aguardando").single();
      cotacao = data;
    }
    if (!cotacao) {
      const { data } = await sb.from("cotacoes").select("*, recommendations(*, patients(name, whatsapp, expo_push_token))").eq("status", "aguardando").ilike("farmacia_wa", `%${phone.slice(-8)}%`).order("created_at", { ascending: false }).limit(1).single();
      cotacao = data;
    }
    if (!cotacao) return new Response("ok", { headers: corsHeaders });
    const preco = extraido.preco || 0;
    const frete = extraido.valor_frete || 0;
    const taxa = 8;
    const total = parseFloat((preco + frete + taxa).toFixed(2));
    await sb.from("cotacoes").update({ preco: extraido.preco, valor_frete: frete || null, prazo: extraido.prazo, estimativa_entrega: extraido.estimativa_entrega || null, observacao: extraido.observacao, valor_total: total, taxa_synka: taxa, valor_farmacia: parseFloat((preco + frete).toFixed(2)), status: "recebido" }).eq("id", cotacao.id);
    await fetch(`${ZAPI_URL}/send-text`, { method: "POST", headers: { "Content-Type": "application/json", "Client-Token": ZAPI_CLIENT_TOKEN }, body: JSON.stringify({ phone: "55" + phone, message: `✅ *Orçamento recebido!*\nManipulado: R$ ${preco.toFixed(2).replace(".",",")}${frete > 0 ? `\nFrete: R$ ${frete.toFixed(2).replace(".",",")}` : ""}\nTotal paciente: R$ ${total.toFixed(2).replace(".",",")}\nO paciente será notificado. 💊` }) });
    const paciente = cotacao.recommendations?.patients;
    if (paciente?.whatsapp) {
      const num = paciente.whatsapp.replace(/[^0-9]/g, "");
      await fetch(`${ZAPI_URL}/send-text`, { method: "POST", headers: { "Content-Type": "application/json", "Client-Token": ZAPI_CLIENT_TOKEN }, body: JSON.stringify({ phone: "55" + num, message: `💊 *Novo orçamento — Synka*\n\nA farmácia *${cotacao.farmacia_nome}* enviou um orçamento de *R$ ${total.toFixed(2).replace(".",",")}*${extraido.prazo ? ` com prazo de *${extraido.prazo}*` : ""}.\n\nAbra o app Synka para ver e comprar! 📱` }) });
    }
    if (paciente?.expo_push_token) {
      await fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: paciente.expo_push_token, title: "💊 Novo orçamento!", body: `${cotacao.farmacia_nome} · R$ ${total.toFixed(2).replace(".",",")}${extraido.prazo ? ` · ${extraido.prazo}` : ""}`, data: { cotacao_id: cotacao.id } }) });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
