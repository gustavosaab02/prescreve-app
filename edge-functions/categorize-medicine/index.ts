import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { nome } = await req.json();
    const OPENAI_KEY = Deno.env.get('OPENAI_KEY');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: `Categorize este medicamento em UMA das categorias abaixo. Responda APENAS com o JSON {"categoria":"NOME"}.

Categorias disponíveis:
- Dor & Febre (analgésicos, anti-inflamatórios, antitérmicos)
- Estômago (antiácidos, antieméticos, laxantes, digestivos)
- Alergia (anti-histamínicos)
- Antibióticos (antibacterianos, antifúngicos, antivirais)
- Vitaminas & Suplementos (vitaminas, minerais, suplementos)
- Pressão & Coração (anti-hipertensivos, estatinas, diuréticos)
- Diabetes (hipoglicemiantes, insulinas)
- Tireoide (hormônios tireoidianos)
- Antidepressivos & Ansiedade (ISRS, benzodiazepínicos, ansiolíticos, antidepressivos)
- Hormônios (testosterona, estrogênio, progesterona, anticoncepcionais)
- Respiratório (broncodilatadores, corticoides inalados)
- Pele & Cabelo (dermatológicos, minoxidil, isotretinoína)
- Coagulação (anticoagulantes, antifibrinolíticos como ácido tranexâmico)
- Outros (não se encaixa em nenhuma categoria)

Medicamento: ${nome}`
        }],
        response_format: { type: 'json_object' },
      }),
    });

    const aiData = await response.json();
    const parsed = JSON.parse(aiData.choices[0].message.content);
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ categoria: 'Outros' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});