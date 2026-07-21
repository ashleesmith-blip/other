// Serverless proxy for the Anthropic Messages API.
// Keeps ANTHROPIC_API_KEY server-side — the browser never sees it.
// Set ANTHROPIC_API_KEY in Netlify → Site settings → Environment variables.
export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: { message: "Method not allowed" } }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: { message: "ANTHROPIC_API_KEY is not set in the Netlify site's environment variables." } }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: { message: "Invalid JSON body." } }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: body.model || "claude-sonnet-5",
      max_tokens: body.max_tokens || 1500,
      messages: body.messages || [],
    }),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
};
