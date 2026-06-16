import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
    }});
  }

  try {
    const { image } = await req.json();
    const OPENAI_KEY = Deno.env.get('OPENAI_KEY') || '';

    console.log('Calling OpenAI, image size:', image?.length);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_KEY,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Voce esta vendo uma imagem que pode conter medicamentos, suplementos ou produtos de saude. Pode ser uma receita medica formal, uma anotacao manuscrita simples, um papel com nomes de remedios, ou qualquer documento relacionado a saude. Extraia TODOS os produtos de saude, medicamentos ou suplementos visiveis na imagem, mesmo que seja so um nome escrito a mao. Responda SOMENTE com um array JSON valido sem markdown, sem explicacao, sem texto extra. Formato exato: [{"produto":"nome do medicamento ou suplemento","dosagem":"ex 1mg ou vazio","frequencia":"ex 2x ao dia ou vazio","duracao":"ex 5 dias ou vazio","observacoes":"obs ou vazio"}]. Se nao houver nenhum produto de saude visivel, retorne [].'
            },
            {
              type: 'image_url',
              image_url: { url: 'data:image/jpeg;base64,' + image }
            }
          ]
        }]
      })
    });

    const data = await response.json();
    console.log('OpenAI status:', response.status);
    console.log('OpenAI content:', data.choices?.[0]?.message?.content);
    console.log('OpenAI error:', data.error);

    const text = data.choices?.[0]?.message?.content || '[]';
    const clean = text.replace(/```json|```/g, '').trim();

    return new Response(clean, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch(e) {
    console.log('Error:', String(e));
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});