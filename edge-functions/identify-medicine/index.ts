import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { image } = await req.json();
    const OPENAI_KEY = Deno.env.get('OPENAI_KEY');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Identifique este remédio na foto. Retorne APENAS JSON: {"nome":"nome completo com dosagem","dosagem":"posologia se visível","principio_ativo":"princípio ativo"}. Se não conseguir identificar retorne {"nome":"","dosagem":"","principio_ativo":""}.' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}`, detail: 'low' } }
          ]
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
    return new Response(JSON.stringify({ nome: '', dosagem: '', principio_ativo: '' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});