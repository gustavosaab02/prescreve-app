import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { produto, marca } = await req.json();
    const nome = produto + (marca ? ' ' + marca : '');

    const prompt = `Você é um assistente farmacêutico. Forneça um resumo claro e simples da bula do produto "${nome}" para um paciente leigo.

Estruture exatamente assim (use esses títulos em negrito):

**Para que serve**
[1-2 frases simples]

**Como usar**
[dosagem e modo de uso típico]

**Efeitos colaterais mais comuns**
[lista com os 3-5 mais comuns]

**Quando não usar**
[contraindicações principais]

**Atenção**
[1 alerta importante]

Seja direto, use linguagem simples. Se não conhecer o produto, diga claramente.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    console.log('Anthropic response:', JSON.stringify(data));

    const text = data.content?.[0]?.text ?? '';
    if (!text) throw new Error('No text in response: ' + JSON.stringify(data));

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch(e) {
    console.error('Error:', e.message);
    return new Response(JSON.stringify({ text: '', error: e.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});