import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { pdf, filename } = await req.json();
    const OPENAI_KEY = Deno.env.get('OPENAI_KEY');

    const pdfBytes = Uint8Array.from(atob(pdf), c => c.charCodeAt(0));
    const formData = new FormData();
    formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename || 'exame.pdf');
    formData.append('purpose', 'user_data');

    const uploadRes = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: formData,
    });
    const uploadData = await uploadRes.json();

    if (!uploadData.id) {
      return new Response(JSON.stringify({ error: 'Upload falhou', itens: [] }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // try/finally garante que o arquivo seja deletado da OpenAI mesmo em caso de erro
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 8000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Leia este laudo laboratorial e extraia TODOS os resultados exatamente como estão no documento, sem arredondar ou alterar nenhum valor. IMPORTANTE: para cada item, o resultado e os valores de referência DEVEM estar na mesma unidade. Se o resultado for 6,92 x10^3/uL e a referência for 3500-10500 /uL, converta o resultado para 6920 e use refMin="3500" refMax="10500". Se o resultado for 267 x10^3/uL e referência 150000-450000, converta para 267000. Sempre normalize para a unidade da referência. Retorne APENAS JSON válido: {"nome":"nome resumido do conjunto de exames","laboratorio":"nome do lab","data":"ISO8601","paciente":"nome","itens":[{"nome":"nome do exame","resultado":"valor já convertido para unidade da referência","unidade":"unidade da referência","refMin":"ref mínima","refMax":"ref máxima"}]}. Use ponto como decimal. Para "<=40" use refMax="40" refMin="". Para "4,30 - 5,70" use refMin="4.30" refMax="5.70". Inclua absolutamente todos os exames presentes.`
              },
              {
                type: 'file',
                file: { file_id: uploadData.id }
              }
            ]
          }],
          response_format: { type: 'json_object' },
        }),
      });

      const aiData = await response.json();
      console.log('finish_reason:', aiData.choices?.[0]?.finish_reason);

      if (!aiData.choices?.[0]?.message?.content) {
        console.error('No content:', JSON.stringify(aiData));
        return new Response(JSON.stringify({ error: 'OpenAI sem resposta', itens: [] }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const parsed = JSON.parse(aiData.choices[0].message.content);
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } finally {
      await fetch(`https://api.openai.com/v1/files/${uploadData.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
      }).catch(e => console.log('Erro ao deletar arquivo OpenAI:', e));
    }

  } catch (error) {
    console.error('Function error:', error.message);
    return new Response(JSON.stringify({ error: error.message, itens: [] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});