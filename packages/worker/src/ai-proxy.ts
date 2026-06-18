import { bad, bodyJson, json, SECURITY_HEADERS } from './http';
import type { Env } from './types';

const CF_ACCOUNT_ID = 'c1089bfcc43c1c6c2aa89e584e86f0bc';
const CF_GATEWAY_ID = 'freeideastore';

const PROVIDERS: Record<string, { gateway: string; header: string; model: string }> = {
  anthropic: {
    gateway: `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/anthropic/v1/messages`,
    header: 'x-api-key',
    model: 'claude-sonnet-4-5-20250514',
  },
  openai: {
    gateway: `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openai/chat/completions`,
    header: 'Authorization',
    model: 'gpt-4o-mini',
  },
};

const SYSTEM_BASE = `You are the FreeIdeaStore AI assistant. You help people turn vague ideas into structured, honest, publishable idea pages.

Rules:
- Never invent users, evidence, metrics, or sources.
- Be direct and specific. Ask clarifying questions when important facts are missing.
- Title must be under 80 characters. Put detail in the summary.
- When you have enough context, output the idea in this JSON format (and ONLY this JSON, no other text):

\`\`\`json
{"title":"...","summary":"...","stage":"raw","category":"...","signal":"...","nextStep":"...","risk":"...","body":"## Snapshot\\n...\\n## How to help\\n..."}
\`\`\`

Use the universal spine sections when the idea has enough substance: Snapshot, People And Problem, Context And Evidence, Proposed Solution, Risks And Constraints, Validation, How To Help.

If the user's input is too vague, interview them first — ask at most 3 focused questions before drafting.`;

export async function handleAiProxy(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  }

  if (request.method !== 'POST') return bad('method not allowed', 405);

  const input = await bodyJson(request);
  const apiKey = String(input.apiKey || '').trim();
  const provider = String(input.provider || 'anthropic').toLowerCase();
  const messages: { role: string; content: string }[] = Array.isArray(input.messages) ? input.messages : [];
  const skillPrompt = String(input.skillPrompt || '').trim();

  if (!apiKey) return bad('API key is required');
  if (!messages.length) return bad('messages are required');

  const config = PROVIDERS[provider];
  if (!config) return bad('unsupported provider: use anthropic or openai');

  const systemPrompt = skillPrompt
    ? `${SYSTEM_BASE}\n\n## Active skill\n\n${skillPrompt}`
    : SYSTEM_BASE;

  if (provider === 'anthropic') {
    const res = await fetch(config.gateway, {
      method: 'POST',
      headers: {
        [config.header]: apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: String(input.model || config.model),
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
        stream: true,
      }),
    });

    if (!res.ok) {
      return json({ error: `AI provider returned an error (${res.status})` }, { status: res.status });
    }

    return new Response(res.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...SECURITY_HEADERS,
      },
    });
  }

  // OpenAI-compatible
  const authValue = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  const res = await fetch(config.gateway, {
    method: 'POST',
    headers: {
      [config.header]: authValue,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: String(input.model || config.model),
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      ],
      stream: true,
    }),
  });

  if (!res.ok) {
    return json({ error: `AI provider returned an error (${res.status})` }, { status: res.status });
  }

  return new Response(res.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...SECURITY_HEADERS,
    },
  });
}
