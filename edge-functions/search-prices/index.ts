import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SERP_KEY = Deno.env.get("SERP_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { query, num = 8, immersiveUrl } = body;

    let url: string;

    if (immersiveUrl) {
      const u = new URL(immersiveUrl);
      u.searchParams.set("api_key", SERP_KEY);
      url = u.toString();
    } else if (query) {
      const params = new URLSearchParams({
        engine: "google_shopping",
        q: query,
        gl: "br",
        hl: "pt",
        num: String(num),
        api_key: SERP_KEY,
      });
      url = `https://serpapi.com/search.json?${params}`;
    } else {
      return new Response(JSON.stringify({ error: "query or immersiveUrl required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`SerpAPI error: ${resp.status}`);
    const data = await resp.json();

    return new Response(
      JSON.stringify({
        shopping_results: data.shopping_results || [],
        sellers: data.sellers || data.buying_options || data.online_sellers || [],
        search_metadata: data.search_metadata || {},
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message, shopping_results: [], sellers: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
