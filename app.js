input.type = 'password';
    input.placeholder = `Enter ${p.label} API Key`;
    input.value = getKey(p);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-key-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      setKey(p, input.value.trim());
      renderProviderList();
      renderModelDropdown();
      renderModelPickerLabel();
      toast(`${p.label} API key updated.`);
    });

    keyRow.appendChild(input);
    keyRow.appendChild(saveBtn);
    card.appendChild(keyRow);

    return card;
  }

  function buildCustomProvider(cfg){
    const modelList = (cfg.modelIds || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(id => ({ id, label: id, tag: 'custom' }));

    return {
      id: cfg.id,
      label: cfg.label || 'Custom Provider',
      color: '#8e8e93',
      keyStorageName: 'hub_key_' + cfg.id,
      endpoint: cfg.endpoint,
      models: modelList,
      supportsFiles: false,
      isCustom: true,
      buildHeaders: (key) => ({
        'Content-Type': 'application/json',
        ...(key ? { 'Authorization': `Bearer ${key}` } : {})
      }),
      buildBody: ({ model, messages, maxTokens }) => ({
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: flattenToText(m.content)
        })),
        max_tokens: maxTokens,
        stream: true
      }),
      parseStreamLine: (json) => {
        const delta = json.choices?.[0]?.delta?.content;
        return delta ? { type: 'text', text: delta } : null;
      },
      normalizeError: (status, err) => err?.error?.message || `HTTP ${status}`
    };
  }

  // ---------------- static providers definition ----------------
  const PROVIDERS = {
    anthropic: {
      id: 'anthropic',
      label: 'Anthropic',
      color: '#d97706',
      keyStorageName: 'hub_key_anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      supportsFiles: true,
      models: [
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', tag: 'Recommended' },
        { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', tag: 'Fast' },
        { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus', tag: 'Powerful' }
      ],
      buildHeaders: (key) => ({
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'dangerously-allow-browser': 'true'
      }),
      buildBody: ({ model, messages, system, maxTokens }) => ({
        model,
        messages,
        system,
        max_tokens: maxTokens,
        stream: true
      }),
      parseStreamLine: (json) => {
        if (json.type === 'content_block_delta' && json.delta?.text) {
          return { type: 'text', text: json.delta.text };
        }
        if (json.type === 'error') {
          return { type: 'error', message: json.error?.message || 'Anthropic API error' };
        }
        return null;
      },
      normalizeError: (status, err) => err?.error?.message || `Anthropic API error (HTTP ${status})`
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
        { id: 'gpt-4o-mini', label: 'GPT-4o mini', tag: 'Fast' },
        { id: 'o1-mini', label: 'o1-mini', tag: 'Reasoning' }
      ],
      buildHeaders: (key) => ({
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }),
      buildBody: ({ model, messages, system, maxTokens }) => {
        const formattedMsgs = [];
        if (system) formattedMsgs.push({ role: 'system', content: system });
        for (const m of messages) {
          formattedMsgs.push({
            role: m.role,
            content: flattenToText(m.content)
          });
        }
        return {
          model,
          messages: formattedMsgs,
          max_tokens: maxTokens,
          stream: true
        };
      },
      parseStreamLine: (json) => {
        const delta = json.choices?.[0]?.delta?.content;
        return delta ? { type: 'text', text: delta } : null;
      },
      normalizeError: (status, err) => err?.error?.message || `OpenAI API error (HTTP ${status})`
    }
  };

  // ---------------- event bindings & init ----------------
  function bindEvents(){
    els.newChatBtn?.addEventListener('click', () => newChat());
    els.settingsBtn?.addEventListener('click', openSettings);
    els.closeSettingsBtn?.addEventListener('click', closeSettings);

    els.modelPickerBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (els.modelDropdown.classList.contains('hidden')) openModelDropdown();
      else closeModelDropdown();
    });

    document.addEventListener('click', (e) => {
      if (!els.modelPicker?.contains(e.target)) closeModelDropdown();
    });

    els.toolsToggleBtn?.addEventListener('click', () => {
      els.toolsBar.classList.toggle('hidden');
    });

    els.toolCodeExec?.addEventListener('change', (e) => {
      state.tools.codeExec = e.target.checked;
      saveTools();
    });
    els.toolFileAnalysis?.addEventListener('change', (e) => {
      state.tools.fileAnalysis = e.target.checked;
      saveTools();
    });
    els.toolWebSearch?.addEventListener('change', (e) => {
      state.tools.webSearch = e.target.checked;
      saveTools();
    });

    els.composerInput?.addEventListener('input', autoGrowTextarea);
    els.composerInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        sendMessage();
      }
    });

    els.sendBtn?.addEventListener('click', sendMessage);

    els.attachBtn?.addEventListener('click', () => els.fileInput?.click());
    els.fileInput?.addEventListener('change', (e) => {
      if (e.target.files?.length) {
        handleFiles(Array.from(e.target.files));
        e.target.value = '';
      }
    });

    els.addCustomProviderBtn?.addEventListener('click', () => {
      const id = 'custom_' + Date.now();
      state.customProviders.push({
        id,
        label: 'New Provider',
        endpoint: 'https://',
        modelIds: 'gpt-3.5-turbo'
      });
      saveCustomProviders();
      renderProviderList();
      renderModelDropdown();
    });

    els.emptyStateSettingsLink?.addEventListener('click', (e) => {
      e.preventDefault();
      openSettings();
    });
  }

  function init(){
    cacheEls();
    loadState();

    if (els.toolCodeExec) els.toolCodeExec.checked = state.tools.codeExec;
    if (els.toolFileAnalysis) els.toolFileAnalysis.checked = state.tools.fileAnalysis;
    if (els.toolWebSearch) els.toolWebSearch.checked = state.tools.webSearch;

    bindEvents();

    if (state.chats.length === 0){
      newChat();
    } else {
      state.activeChatId = state.chats[state.chats.length - 1].id;
      renderChatList();
      renderActiveChat();
    }

    setStatus('idle', 'Ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
