gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    color: '#4a90c9',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    keyPlaceholder: 'AIza...',
    keyStorageName: 'hub_key_gemini',
    // Google's OpenAI-compatibility layer — takes a plain Bearer
    // API key (from aistudio.google.com/apikey), NOT OAuth2/service
    // account credentials. Native gemini-1.0/1.5 models are fully
    // shut down as of 2026 and will 404 regardless of URL — only
    // 2.5+/3.x model IDs are live. Check docsUrl above if in doubt.
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tag: 'balanced' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tag: 'most capable' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', tag: 'fastest/cheapest' },
    ],
    supportsFiles: true,
    supportsVision: true,

    buildHeaders(apiKey) {
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };
    },

    buildBody({ model, messages, system, maxTokens }) {
      const msgs = [];
      if (system) msgs.push({ role: 'system', content: system });
      
      for (const m of messages) {
        msgs.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: convertBlocksToOpenAI(m.content),
        });
      }
      
      return {
        model,
        messages: msgs,
        stream: true,
        max_tokens: maxTokens || 4096,
      };
    },

    // Same stream shape as OpenAI's chat-completions endpoint.
    parseStreamLine(json) {
      const delta = json.choices?.[0]?.delta;
      if (delta?.content) return { type: 'text', text: delta.content };
      if (json.choices?.[0]?.finish_reason) return { type: 'done' };
      return null;
    },

    normalizeError(status, body) {
      const raw = JSON.stringify(body || {});
      
      if (status === 401 || /oauth2|access token/i.test(raw)) {
        return 'Auth error — this key is being read as a Cloud/OAuth credential, not a plain API key. Get a key from aistudio.google.com/apikey (not Cloud Console) and paste it here.';
      }
      if (status === 404) {
        return 'Model not found — it may be a deprecated/shut-down Gemini model ID (all 1.0 and 1.5 models are fully retired). Use gemini-2.5-flash or another current ID from the docs link above.';
      }
      if (status === 429) {
        return 'Rate limited or out of quota on Gemini. Check your usage in Google AI Studio.';
      }
      
      return body?.error?.message || `Gemini API error (${status})`;
    },
  },
