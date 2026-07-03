import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
    }});
  }

  try {
    const { texto } = await req.json();
    const OPENAI_KEY = Deno.env.get('OPENAI_KEY') || '';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_KEY,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Você está lendo uma receita ou protocolo de saúde. Extraia TODOS os produtos, medicamentos ou suplementos mencionados. Para cada um, identifique nome, dosagem, frequência e duração se disponíveis. Responda SOMENTE com array JSON válido sem markdown, sem explicação: [{"nome":"nome do produto","dosagem":"ex: 5000 UI ou string vazia se não informado","frequencia":"ex: 1x ao dia ou string vazia","duracao":"ex: 3 meses ou string vazia"}]. Se não houver produtos de saúde, retorne [].

Texto da receita:
${texto}`
        }]
      })
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '[]';
    const clean = text.replace(/```json|```/g, '').trim();

    return new Response(clean, {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch(e) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
