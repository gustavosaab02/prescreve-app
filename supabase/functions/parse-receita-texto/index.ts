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
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Você está lendo uma receita ou protocolo de saúde. Extraia TODOS os produtos, medicamentos ou suplementos.

Para cada item classifique o tipo:
- "pronto": produto comercial comprado pronto (ex: Vitamina D3 5000UI, Ômega 3, Whey protein, Ritalina)
- "manipulado": fórmula que uma farmácia manipula sob encomenda (ex: fórmulas com vários ativos combinados como "Vitamina C 1g + Zinco 20mg + Selênio", ou quando o texto diz "manipular", "fórmula", "aviado em farmácia")

Para manipulados, tente extrair os componentes individuais se listados.

Responda SOMENTE com array JSON válido sem markdown: [{"nome":"nome do produto ou fórmula","tipo":"pronto","dosagem":"ex: 5000 UI","frequencia":"ex: 1x ao dia","duracao":"ex: 3 meses","componentes":[]}]

Para manipulados com componentes: {"nome":"Fórmula Detox","tipo":"manipulado","dosagem":"1 capsula","frequencia":"1x ao dia","duracao":"60 dias","componentes":[{"nome":"Vitamina C","conc":"500mg"},{"nome":"Zinco","conc":"10mg"}]}

Se não houver produtos, retorne [].

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
