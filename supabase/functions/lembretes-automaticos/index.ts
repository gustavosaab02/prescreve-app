import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZAPI_INSTANCE = Deno.env.get("ZAPI_INSTANCE") || "";
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN") || "";
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN") || "";
const ZAPI_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;

async function enviarWA(numero: string, mensagem: string) {
  const num = numero.replace(/\D/g, "");
  const numBR = num.startsWith("55") ? num : "55" + num;
  const res = await fetch(`${ZAPI_URL}/send-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Client-Token": ZAPI_CLIENT_TOKEN },
    body: JSON.stringify({ phone: numBR, message: mensagem }),
  });
  return res.ok;
}

async function enviarPushMedico(token: string, titulo: string, corpo: string, data: Record<string, unknown>) {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: token, title: titulo, body: corpo, data, sound: "default" }),
  });
  return res.ok;
}

function formatarData(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    weekday: "long",
  });
}

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);

  const em3Dias = new Date(hoje);
  em3Dias.setUTCDate(hoje.getUTCDate() + 3);
  const em3DiasStr = em3Dias.toISOString().split("T")[0];

  const ha7DiasInicio = new Date(hoje);
  ha7DiasInicio.setUTCDate(hoje.getUTCDate() - 7);
  const ha7DiasFim = new Date(ha7DiasInicio);
  ha7DiasFim.setUTCDate(ha7DiasInicio.getUTCDate() + 1);

  let retornosEnviados = 0;
  let acompanhamentosEnviados = 0;
  const erros: string[] = [];

  // ── 1. RETORNO: WhatsApp direto ao paciente (3 dias antes) ──────────────────
  // É logístico — faz sentido vir da Synka
  const { data: retornos, error: errRetornos } = await sb
    .from("recommendations")
    .select("id, return_date, patients:patient_id(name, whatsapp), doctors:doctor_id(name, specialty)")
    .eq("return_date", em3DiasStr)
    .not("patient_id", "is", null);

  if (errRetornos) erros.push("retorno query: " + errRetornos.message);

  for (const rec of retornos || []) {
    const paciente = rec.patients as any;
    if (!paciente?.whatsapp) continue;

    const nomeP = paciente.name || "paciente";
    const medico = (rec.doctors as any)?.name ? `Dr(a). ${(rec.doctors as any).name}` : "seu médico";
    const especialidade = (rec.doctors as any)?.specialty ? ` (${(rec.doctors as any).specialty})` : "";
    const dataFormatada = formatarData(rec.return_date);

    const msg =
      `💊 *Lembrete de retorno — Synka*\n\n` +
      `Olá, ${nomeP}! 👋\n\n` +
      `Seu retorno com *${medico}${especialidade}* está marcado para *${dataFormatada}*.\n\n` +
      `Lembre-se de levar seus medicamentos e anotar qualquer dúvida ou sintoma. 📋\n\n` +
      `_Synka · synkasaude.com.br_`;

    try {
      const ok = await enviarWA(paciente.whatsapp, msg);
      if (ok) retornosEnviados++;
      else erros.push(`retorno ${rec.id}: z-api retornou erro`);
    } catch (e: any) {
      erros.push(`retorno ${rec.id}: ${e.message}`);
    }
  }

  // ── 2. ACOMPANHAMENTO: push para o médico (7 dias após prescrição) ───────────
  // O médico toca na notificação → WhatsApp abre com mensagem pré-preenchida
  const { data: acomps, error: errAcomps } = await sb
    .from("recommendations")
    .select(
      "id, created_at, notes, " +
      "patients:patient_id(name, whatsapp), " +
      "products:product_id(name), " +
      "recommendation_items(products:product_id(name)), " +
      "doctors:doctor_id(expo_push_token)"
    )
    .gte("created_at", ha7DiasInicio.toISOString())
    .lt("created_at", ha7DiasFim.toISOString())
    .not("patient_id", "is", null);

  if (errAcomps) erros.push("acomp query: " + errAcomps.message);

  for (const rec of acomps || []) {
    const paciente = rec.patients as any;
    const doctorToken = (rec.doctors as any)?.expo_push_token;

    // Sem token do médico, sem WhatsApp do paciente → pula
    if (!doctorToken || !paciente?.whatsapp) continue;

    // Resolve nome do produto (manipulado ou convencional)
    let produto = "";
    try {
      const manip = JSON.parse(rec.notes || "");
      if (manip?.__manipulado && manip?.nome) produto = manip.nome;
    } catch (_) {}
    if (!produto) produto = (rec.products as any)?.name || "";
    if (!produto) {
      const items = rec.recommendation_items as any[];
      produto = items?.[0]?.products?.name || "";
    }

    const nomeP = paciente.name || "paciente";

    try {
      const ok = await enviarPushMedico(
        doctorToken,
        `💊 Acompanhar ${nomeP.split(" ")[0]}`,
        `Faz 1 semana desde a prescrição${produto ? ` de ${produto}` : ""}. Toque para enviar mensagem.`,
        {
          type: "acompanhamento",
          patient_name: paciente.name,
          patient_whatsapp: paciente.whatsapp,
          produto,
        }
      );
      if (ok) acompanhamentosEnviados++;
      else erros.push(`acomp ${rec.id}: expo push retornou erro`);
    } catch (e: any) {
      erros.push(`acomp ${rec.id}: ${e.message}`);
    }
  }

  console.log({ retornosEnviados, acompanhamentosEnviados, erros });

  return new Response(
    JSON.stringify({ ok: true, retornosEnviados, acompanhamentosEnviados, erros }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
