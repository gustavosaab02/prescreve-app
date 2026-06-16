import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CONSULTARIO_KEY = Deno.env.get("CONSULTARIO_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { tipo, numero, uf } = await req.json();

    let url = `https://consultar.io/api/v1/${tipo}/consultar?numero_registro=${numero}`;
    if (uf) url += `&uf=${uf.toLowerCase()}`;
    if (tipo === 'cro') url += `&categoria=cd`;

    const response = await fetch(url, {
      headers: {
        "Authorization": `Token ${CONSULTARIO_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok || data?.error === "NAO_ENCONTRADO" || data?.error) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const nome = data?.nome_razao_social || data?.nome || null;
    return new Response(
      JSON.stringify({ found: true, nome }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ found: false, error: e.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
