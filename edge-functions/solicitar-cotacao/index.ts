import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") || "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") || "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") || "";
const ZAPI_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { recommendation_id } = await req.json();
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data: rec, error } = await sb
      .from("recommendations")
      .select("*, doctors(name, specialty, crm, assinatura_url, logo_url), patients(name, whatsapp, address)")
      .eq("id", recommendation_id)
      .single();

    if (error || !rec) throw new Error("Recomendação não encontrada");

    let formula = "";
    let nomeProduto = "Medicamento manipulado";
    let veiculo = "";
    let qtd = "";

    if (rec.notes) {
      try {
        const parsed = JSON.parse(rec.notes);
        nomeProduto = parsed.nome || nomeProduto;
        veiculo = parsed.veiculo || "";
        qtd = parsed.qtd || "";
        if (parsed.componentes) {
          formula = parsed.componentes
            .filter((c: any) => c.nome?.trim())
            .map((c: any) => `• ${c.nome}${c.conc ? " " + c.conc : ""}`)
            .join("\n");
        }
      } catch {
        formula = rec.notes;
      }
    }

    const { data: farmacias } = await sb
      .from("farmacias_parceiras")
      .select("*")
      .eq("ativo", true);

    if (!farmacias || farmacias.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, message: "Nenhuma farmácia parceira cadastrada" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const nomePaciente = rec.patients?.name || "Paciente";
    const enderecoPaciente = rec.patients?.address || "Não informado";
    const nomeMedico = rec.doctors?.name || "Médico";
    const crmMedico = rec.doctors?.crm ? ` · CRM ${rec.doctors.crm}` : "";
    const especialidade = rec.doctors?.specialty ? ` · ${rec.doctors.specialty}` : "";

    // Número de pedido único baseado no UUID da recomendação + timestamp — sem colisão
    const numeroPedido = recommendation_id.replace(/-/g, "").slice(0, 6).toUpperCase() +
      (Date.now() % 10000).toString().padStart(4, "0");

    let enviadas = 0;

    for (const farmacia of farmacias) {
      if (!farmacia.whatsapp) continue;
      const numero = farmacia.whatsapp.replace(/[^0-9]/g, "");

      const mensagem =
        `🏥 *Nova solicitação de orçamento — Synka*\n\n` +
        `Olá, *${farmacia.nome}*!\n\n` +
        `📋 *Pedido:* #${numeroPedido}\n\n` +
        `👨‍⚕️ *Médico:* Dr(a). ${nomeMedico}${especialidade}${crmMedico}\n\n` +
        `👤 *Paciente:* ${nomePaciente}\n` +
        `📍 *Endereço de entrega:*\n${enderecoPaciente}\n\n` +
        `💊 *Fórmula:* ${nomeProduto}\n` +
        `${formula ? formula + "\n" : ""}` +
        `${veiculo ? `🧪 *Veículo:* ${veiculo}\n` : ""}` +
        `${qtd ? `📦 *Quantidade:* ${qtd}\n` : ""}` +
        `${rec.dosage ? `💉 *Posologia:* ${rec.dosage}\n` : ""}` +
        `${rec.duration ? `⏱ *Duração:* ${rec.duration}\n` : ""}` +
        `\n💰 Responda com o número *#${numeroPedido}* informando:\n` +
        `- Valor do manipulado\n` +
        `- Valor do frete para o endereço acima\n` +
        `- Prazo de entrega\n\n` +
        `_A receita assinada digitalmente está disponível no sistema Synka._\n` +
        `_Synka · synkasaude.com.br_`;

      const zapiRes = await fetch(`${ZAPI_URL}/send-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Client-Token": ZAPI_CLIENT_TOKEN },
        body: JSON.stringify({ phone: "55" + numero, message: mensagem }),
      });
      const zapiData = await zapiRes.json();
      console.log("Z-API resposta:", JSON.stringify(zapiData));

      if (zapiData.zaapId || zapiData.messageId) {
        await sb.from("cotacoes").insert({
          recommendation_id,
          farmacia_nome: farmacia.nome,
          farmacia_wa: farmacia.whatsapp,
          numero_pedido: numeroPedido,
          preco: null,
          prazo: null,
          observacao: null,
          status: "aguardando",
        });
        enviadas++;
      }
    }

    if (rec.patients?.whatsapp && enviadas > 0) {
      const numPaciente = rec.patients.whatsapp.replace(/[^0-9]/g, "");
      await fetch(`${ZAPI_URL}/send-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Client-Token": ZAPI_CLIENT_TOKEN },
        body: JSON.stringify({
          phone: "55" + numPaciente,
          message: `💊 *Orçamentos solicitados!*\n\nSolicitamos orçamentos para *${nomeProduto}* em ${enviadas} farmácia(s) parceira(s).\n\nVocê receberá os valores em breve no app Synka. Quando escolher uma farmácia, poderá pagar direto pelo app! 📱`,
        }),
      });
    }

    return new Response(JSON.stringify({ ok: true, enviadas }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.log("Erro:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
