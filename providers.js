// Helper functions for parsing content structures safely
function convertBlocksToOpenAI(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  
  return content.map(block => {
    if (block.type === 'text') return block.text;
    if (block.type === 'image') {
      return {
        type: 'image_url',
        image_url: { url: block.url || block.dataUrl }
      };
    }
    return block;
  });
}

function flattenToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(b => (typeof b === 'string' ? b : b.text || '')).join('\n');
  }
  return String(content || '');
}

window.PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    color: '#4a90c9',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    keyPlaceholder: 'AIza...',
    keyStorageName: 'hub_key_gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tag: 'balanced' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tag: 'most capable' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', tag: 'fastest/cheapest' }
    ],
    supportsFiles: true,
    supportsVision: true,

    buildHeaders(apiKey) {
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };
    },

    buildBody({ model, messages, system, maxTokens }) {
      const msgs = [];
      if (system) msgs.push({ role: 'system', content: system });

      for (const m of messages) {
        msgs.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: convertBlocksToOpenAI(m.content)
        });
      }

      return {
        model,
        messages: msgs,
        stream: true,
        max_tokens: maxTokens || 4096
      };
    },

    parseStreamLine(json) {
      const delta = json.choices?.[0]?.delta;
      if (delta?.content) return { type: 'text', text: delta.content };
      if (json.choices?.[0]?.finish_reason) return { type: 'done' };
      return null;
    },

    normalizeError(status, body) {
      const raw = JSON.stringify(body || {});

      if (status === 401 || /oauth2|access token/i.test(raw)) {
        return 'Auth error — key read as Cloud/OAuth credential. Obtain a key from aistudio.google.com/apikey.';
      }
      if (status === 404) {
        return 'Model not found — select a supported gemini-2.5 model.';
      }
      if (status === 429) {
        return 'Rate limited or out of quota on Gemini. Check Google AI Studio quota limits.';
      }

      return body?.error?.message || `Gemini API error (${status})`;
    }
  },

  openai: {
    id: 'openai',
    label: 'OpenAI',
    color: '#10a37f',
    keyStorageName: 'hub_key_openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    supportsFiles: true,
    models: [
      { id: 'gpt-4o', label: 'GPT-4o', tag: 'Flagship' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', tag: 'Fast' }
    ],
    buildHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    }),
    buildBody: ({ model, messages, system, maxTokens }) => {
      const msgs = [];
      if (system) msgs.push({ role: 'system', content: system });
      messages.forEach(m => msgs.push({ role: m.role, content: convertBlocksToOpenAI(m.content) }));
      return { model, messages: msgs, max_tokens: maxTokens || 2048, stream: true };
    },
    parseStreamLine: (json) => {
      const delta = json.choices?.[0]?.delta?.content;
      return delta ? { type: 'text', text: delta } : null;
    },
    normalizeError: (status, err) => err?.error?.message || `HTTP ${status}`
  },

  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    color: '#d97706',
    keyStorageName: 'hub_key_anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    supportsFiles: true,
    models: [
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', tag: 'Recommended' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', tag: 'Fast' }
    ],
    buildHeaders: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'dangerously-allow-browser': 'true'
    }),
    buildBody: ({ model, messages, system, maxTokens }) => ({
      model,
      messages: messages.map(m => ({ role: m.role, content: flattenToText(m.content) })),
      system,
      max_tokens: maxTokens || 2048,
      stream: true
    }),
    parseStreamLine: (json) => {
      if (json.type === 'content_block_delta' && json.delta?.text) {
        return { type: 'text', text: json.delta.text };
      }
      return null;
    },
    normalizeError: (status, err) => err?.error?.message || `HTTP ${status}`
  }
};
