/* ============================================================
   app.js — Hub
   All state lives in localStorage + memory. No server, no
   analytics, no external calls except directly to whichever
   provider you pick and gave a key for.
   ============================================================ */

(function(){
  'use strict';

  // ---------------- state ----------------
  const state = {
    chats: [],            // [{id, title, providerId, modelId, messages:[]}]
    activeChatId: null,
    customProviders: [],  // user-added OpenAI-compatible endpoints
    tools: {
      codeExec: true,
      fileAnalysis: true,
      webSearch: false,
    },
    pendingAttachments: [], // files staged before send
    streaming: false,
  };

  const els = {};
  function cacheEls(){
    ['sidebar','chatList','newChatBtn','settingsBtn','modelPicker','modelPickerBtn',
     'activeModelLabel','activeProviderDot','modelDropdown','toolsToggleBtn','toolsBar',
     'statusChip','statusText','toolCodeExec','toolFileAnalysis','toolWebSearch',
     'messageArea','emptyState','emptySuggestions','emptyStateSettingsLink','messages',
     'composerWrap','attachmentTray','composer','attachBtn','fileInput','composerInput',
     'sendBtn','tokenHint','settingsModal','closeSettingsBtn','providerList',
     'addCustomProviderBtn','toastHost'
    ].forEach(id => els[id] = document.getElementById(id));
  }

  // ---------------- persistence ----------------
  const LS_CHATS = 'hub_chats_v1';
  const LS_CUSTOM_PROVIDERS = 'hub_custom_providers_v1';
  const LS_TOOLS = 'hub_tools_v1';
  const LS_LAST_MODEL = 'hub_last_model_v1';

  function loadState(){
    try {
      const chats = JSON.parse(localStorage.getItem(LS_CHATS) || '[]');
      state.chats = Array.isArray(chats) ? chats : [];
    } catch { state.chats = []; }

    try {
      const cp = JSON.parse(localStorage.getItem(LS_CUSTOM_PROVIDERS) || '[]');
      state.customProviders = Array.isArray(cp) ? cp : [];
    } catch { state.customProviders = []; }

    try {
      const t = JSON.parse(localStorage.getItem(LS_TOOLS) || 'null');
      if (t) state.tools = Object.assign(state.tools, t);
    } catch {}
  }

  function saveChats(){
    // Trim to last 60 chats to keep localStorage from growing unbounded
    const trimmed = state.chats.slice(-60);
    try {
      localStorage.setItem(LS_CHATS, JSON.stringify(trimmed));
    } catch (e) {
      // Most likely QuotaExceededError — localStorage is typically
      // capped around 5-10MB per origin, and attached files (stored
      // as base64) count against that. Rather than fail silently and
      // lose history, drop attachment payloads from OLDER messages
      // (keep the visible text) and retry once before giving up.
      const stripped = trimmed.map(c => ({
        ...c,
        messages: c.messages.map(m => {
          if (!Array.isArray(m.content)) return m;
          return {
            ...m,
            content: m.content.map(block =>
              (block.type === 'image' || block.type === 'document')
                ? { type: 'text', text: `[attachment: ${block.filename || 'file'} — removed from local storage to free space; still visible above in this session]` }
                : block
            ),
          };
        }),
      }));
      try {
        localStorage.setItem(LS_CHATS, JSON.stringify(stripped));
        toast('Local storage was nearly full — older file attachments were trimmed from saved history (this session still shows them).', true);
      } catch (e2) {
        toast('Could not save chat history — local storage is full. Consider clearing old chats.', true);
      }
    }
  }
  function saveCustomProviders(){
    localStorage.setItem(LS_CUSTOM_PROVIDERS, JSON.stringify(state.customProviders));
  }
  function saveTools(){
    localStorage.setItem(LS_TOOLS, JSON.stringify(state.tools));
  }

  function getAllProviders(){
    const custom = state.customProviders.map(buildCustomProvider);
    return Object.assign({}, PROVIDERS, Object.fromEntries(custom.map(p => [p.id, p])));
  }

  function getKey(provider){
    return localStorage.getItem(provider.keyStorageName) || '';
  }
  function setKey(provider, val){
    if (val) localStorage.setItem(provider.keyStorageName, val);
    else localStorage.removeItem(provider.keyStorageName);
  }

  // ---------------- toast ----------------
  function toast(msg, isErr){
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    els.toastHost.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  // ---------------- chats ----------------
  function newChat(providerId, modelId){
    const last = getLastModelChoice();
    const chat = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      title: 'New chat',
      providerId: providerId || last.providerId || null,
      modelId: modelId || last.modelId || null,
      messages: [],
      createdAt: Date.now(),
    };
    state.chats.push(chat);
    state.activeChatId = chat.id;
    saveChats();
    renderChatList();
    renderActiveChat();
  }

  function getActiveChat(){
    return state.chats.find(c => c.id === state.activeChatId) || null;
  }

  function getLastModelChoice(){
    try {
      return JSON.parse(localStorage.getItem(LS_LAST_MODEL) || '{}');
    } catch { return {}; }
  }
  function setLastModelChoice(providerId, modelId){
    localStorage.setItem(LS_LAST_MODEL, JSON.stringify({ providerId, modelId }));
  }

  function deriveTitle(chat){
    const firstUser = chat.messages.find(m => m.role === 'user');
    if (!firstUser) return 'New chat';
    const text = flattenToText(firstUser.content);
    return text.slice(0, 42) + (text.length > 42 ? '…' : '');
  }

  function flattenToText(content){
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.filter(b => b.type === 'text').map(b => b.text).join(' ');
    return '';
  }

  // ---------------- render: sidebar ----------------
  function renderChatList(){
    els.chatList.innerHTML = '';
    if (state.chats.length === 0){
      const hint = document.createElement('div');
      hint.className = 'chat-empty-hint';
      hint.textContent = 'Your conversations will show up here once you send a message.';
      els.chatList.appendChild(hint);
      return;
    }
    const sorted = [...state.chats].sort((a,b) => (b.updatedAt||b.createdAt) - (a.updatedAt||a.createdAt));
    for (const chat of sorted){
      const item = document.createElement('div');
      item.className = 'chat-item' + (chat.id === state.activeChatId ? ' active' : '');
      item.tabIndex = 0;
      const providers = getAllProviders();
      const p = providers[chat.providerId];
      item.innerHTML = `<div>${escapeHtml(chat.title || 'New chat')}</div>` +
        (p ? `<div class="chat-item-meta">${escapeHtml(p.label)}</div>` : '');
      item.addEventListener('click', () => {
        state.activeChatId = chat.id;
        renderChatList();
        renderActiveChat();
      });
      els.chatList.appendChild(item);
    }
  }

  // ---------------- render: model picker ----------------
  function renderModelPickerLabel(){
    const chat = getActiveChat();
    const providers = getAllProviders();
    if (!chat || !chat.providerId || !chat.modelId){
      els.activeModelLabel.textContent = 'Select a model';
      els.activeProviderDot.style.background = 'var(--text-2)';
      return;
    }
    const p = providers[chat.providerId];
    if (!p){ els.activeModelLabel.textContent = 'Select a model'; return; }
    const m = p.models.find(mm => mm.id === chat.modelId);
    els.activeModelLabel.textContent = m ? m.label : chat.modelId;
    els.activeProviderDot.style.background = p.color;
  }

  function renderModelDropdown(){
    const providers = getAllProviders();
    const chat = getActiveChat();
    els.modelDropdown.innerHTML = '';

    const order = ['anthropic','openai', ...state.customProviders.map(c=>c.id)];
    let anyModel = false;

    for (const pid of order){
      const p = providers[pid];
      if (!p) continue;
      const hasKey = !!getKey(p);
      const label = document.createElement('div');
      label.className = 'dropdown-group-label';
      label.textContent = p.label;
      els.modelDropdown.appendChild(label);

      if (p.models.length === 0){
        const empty = document.createElement('div');
        empty.className = 'dropdown-empty';
        empty.textContent = p.isCustom ? 'No model IDs configured for this endpoint yet.' : 'No models listed.';
        els.modelDropdown.appendChild(empty);
        continue;
      }

      for (const m of p.models){
        anyModel = true;
        const item = document.createElement('div');
        item.className = 'dropdown-item' + (chat && chat.providerId===pid && chat.modelId===m.id ? ' selected' : '');
        item.innerHTML = `
          <span class="provider-dot" style="background:${p.color}"></span>
          <span class="dropdown-item-text">
            <span class="dropdown-item-name">${escapeHtml(m.label)}</span>
            <span class="dropdown-item-id">${escapeHtml(m.id)}</span>
          </span>
          <span class="dropdown-item-badge ${hasKey ? '' : 'no-key'}">${hasKey ? escapeHtml(m.tag||'') : 'no key'}</span>
        `;
        item.addEventListener('click', () => {
          selectModel(pid, m.id);
          closeModelDropdown();
        });
        els.modelDropdown.appendChild(item);
      }
    }

    const footer = document.createElement('button');
    footer.className = 'dropdown-footer-btn';
    footer.textContent = '+ Manage providers & keys';
    footer.addEventListener('click', () => { closeModelDropdown(); openSettings(); });
    els.modelDropdown.appendChild(footer);
  }

  function selectModel(providerId, modelId){
    let chat = getActiveChat();
    if (!chat){ newChat(providerId, modelId); chat = getActiveChat(); }
    chat.providerId = providerId;
    chat.modelId = modelId;
    setLastModelChoice(providerId, modelId);
    saveChats();
    renderModelPickerLabel();
    renderChatList();
    updateSendEnabled();
  }

  function openModelDropdown(){ els.modelDropdown.classList.remove('hidden'); renderModelDropdown(); }
  function closeModelDropdown(){ els.modelDropdown.classList.add('hidden'); }

  // ---------------- render: messages ----------------
  function renderActiveChat(){
    const chat = getActiveChat();
    renderModelPickerLabel();
    updateSendEnabled();

    if (!chat || chat.messages.length === 0){
      els.emptyState.classList.remove('hidden');
      els.messages.classList.add('hidden');
      renderEmptySuggestions();
      return;
    }
    els.emptyState.classList.add('hidden');
    els.messages.classList.remove('hidden');
    els.messages.innerHTML = '';
    for (const msg of chat.messages){
      els.messages.appendChild(renderMessageEl(msg));
    }
    scrollToBottom();
  }

  function renderEmptySuggestions(){
    const suggestions = [
      'Explain a concept from my Google Data Analytics course',
      'Write and run a quick Python calculation',
      'Summarize a file I attach',
    ];
    els.emptySuggestions.innerHTML = '';
    for (const s of suggestions){
      const btn = document.createElement('button');
      btn.className = 'suggestion-chip';
      btn.textContent = s;
      btn.addEventListener('click', () => {
        els.composerInput.value = s;
        autoGrowTextarea();
        els.composerInput.focus();
      });
      els.emptySuggestions.appendChild(btn);
    }
  }

  function renderMessageEl(msg){
    const wrap = document.createElement('div');
    wrap.className = `msg role-${msg.role}` + (msg.streaming ? ' streaming' : '');
    wrap.dataset.msgId = msg.id;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = msg.role === 'user' ? 'You' : 'AI';
    if (msg.role === 'assistant'){
      const providers = getAllProviders();
      const p = providers[msg.providerId];
      if (p) avatar.style.color = p.color;
    }
    wrap.appendChild(avatar);

    const body = document.createElement('div');
    body.className = 'msg-body';

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const author = document.createElement('span');
    author.className = 'msg-author';
    author.textContent = msg.role === 'user' ? 'You' : 'Assistant';
    meta.appendChild(author);
    if (msg.role === 'assistant' && msg.modelLabel){
      const tag = document.createElement('span');
      tag.className = 'msg-model-tag';
      tag.textContent = msg.modelLabel;
      meta.appendChild(tag);
    }
    body.appendChild(meta);

    if (msg.attachments && msg.attachments.length){
      const attWrap = document.createElement('div');
      attWrap.className = 'msg-attachments';
      for (const a of msg.attachments){
        const chip = document.createElement('span');
        chip.className = 'msg-attachment-chip';
        chip.textContent = `📎 ${a.name}`;
        attWrap.appendChild(chip);
      }
      body.appendChild(attWrap);
    }

    if (msg.toolLog){
      const toolLog = document.createElement('div');
      toolLog.className = 'msg-tool-log';
      toolLog.innerHTML = `<div class="tool-log-title">${escapeHtml(msg.toolLog.title)}</div>${escapeHtml(msg.toolLog.detail||'')}`;
      body.appendChild(toolLog);
    }

    if (msg.error){
      const errBox = document.createElement('div');
      errBox.className = 'msg-error-box';
      errBox.innerHTML = `<div class="err-title">Request failed</div>${escapeHtml(msg.error)}`;
      body.appendChild(errBox);
    } else {
      const content = document.createElement('div');
      content.className = 'msg-content';
      content.innerHTML = renderMarkdownLite(flattenToText(msg.content));
      body.appendChild(content);
    }

    if (msg.codeBlocks && msg.codeBlocks.length){
      for (const cb of msg.codeBlocks){
        body.appendChild(renderCodeExecBlock(cb));
      }
    }

    wrap.appendChild(body);
    return wrap;
  }

  function renderCodeExecBlock(cb){
    const box = document.createElement('div');
    box.className = 'code-exec-block';
    box.innerHTML = `
      <div class="code-exec-head"><span>Ran ${escapeHtml(cb.lang)}</span><span>${cb.durationMs ? cb.durationMs+'ms' : ''}</span></div>
      <div class="code-exec-output ${cb.isError ? 'err' : ''}">${escapeHtml(cb.output || '(no output)')}</div>
    `;
    return box;
  }

  // Deliberately minimal — enough for code fences, bold, links,
  // lists — not a full markdown engine. Keeps the app dependency-free.
  function renderMarkdownLite(text){
    if (!text) return '';
    let escaped = escapeHtml(text);

    // fenced code blocks
    escaped = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${code}</code></pre>`;
    });
    // inline code
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
    // bold
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // links
    escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // paragraphs (double newline)
    const parts = escaped.split(/\n\n+/).map(p => {
      if (p.startsWith('<pre>')) return p;
      return `<p>${p.replace(/\n/g,'<br>')}</p>`;
    });
    return parts.join('');
  }

  function escapeHtml(s){
    const div = document.createElement('div');
    div.textContent = s ?? '';
    return div.innerHTML;
  }

  function scrollToBottom(){
    els.messageArea.scrollTop = els.messageArea.scrollHeight;
  }

  // ---------------- status ----------------
  function setStatus(kind, text){
    els.statusChip.className = 'status-chip status-' + kind;
    els.statusText.textContent = text;
  }

  // ---------------- composer ----------------
  function autoGrowTextarea(){
    els.composerInput.style.height = 'auto';
    els.composerInput.style.height = Math.min(els.composerInput.scrollHeight, 200) + 'px';
    updateSendEnabled();
  }

  function updateSendEnabled(){
    const chat = getActiveChat();
    const hasModel = !!(chat && chat.providerId && chat.modelId);
    const hasText = els.composerInput.value.trim().length > 0 || state.pendingAttachments.length > 0;
    els.sendBtn.disabled = !(hasModel && hasText && !state.streaming);
  }

  // ---------------- attachments ----------------
  function renderAttachmentTray(){
    if (state.pendingAttachments.length === 0){
      els.attachmentTray.classList.add('hidden');
      els.attachmentTray.innerHTML = '';
      return;
    }
    els.attachmentTray.classList.remove('hidden');
    els.attachmentTray.innerHTML = '';
    state.pendingAttachments.forEach((att, idx) => {
      const item = document.createElement('div');
      item.className = 'attachment-item';
      item.innerHTML = `<span>📎 ${escapeHtml(att.name)}</span>`;
      const rm = document.createElement('button');
      rm.className = 'att-remove';
      rm.innerHTML = '×';
      rm.addEventListener('click', () => {
        state.pendingAttachments.splice(idx, 1);
        renderAttachmentTray();
        updateSendEnabled();
      });
      item.appendChild(rm);
      els.attachmentTray.appendChild(item);
    });
  }

  async function handleFiles(fileList){
    if (!state.tools.fileAnalysis){
      toast('File analysis is off — enable it in Tools to attach files.', true);
      return;
    }
    for (const file of fileList){
      if (file.size > 15 * 1024 * 1024){
        toast(`${file.name} is over 15MB — skipped.`, true);
        continue;
      }
      const isImage = file.type.startsWith('image/');
      const isText = file.type.startsWith('text/') || /\.(md|csv|json|txt)$/i.test(file.name);
      try {
        if (isImage){
          const dataUrl = await readFileAsDataURL(file);
          state.pendingAttachments.push({ name: file.name, kind:'image', mediaType: file.type, dataUrl });
        } else if (isText){
          const text = await readFileAsText(file);
          state.pendingAttachments.push({ name: file.name, kind:'text', text });
        } else if (file.type === 'application/pdf'){
          const dataUrl = await readFileAsDataURL(file);
          state.pendingAttachments.push({ name: file.name, kind:'pdf', mediaType: file.type, dataUrl });
        } else {
          toast(`${file.name}: unsupported type for inline analysis — try PDF, image, or text.`, true);
          continue;
        }
      } catch (e){
        toast(`Couldn't read ${file.name}.`, true);
      }
    }
    renderAttachmentTray();
    updateSendEnabled();
  }

  function readFileAsDataURL(file){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  function readFileAsText(file){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });
  }

  function attachmentsToContentBlocks(atts, providerId){
    // Anthropic-style content blocks; OpenAI adapter flattens these.
    const blocks = [];
    for (const a of atts){
      if (a.kind === 'image'){
        const base64 = a.dataUrl.split(',')[1];
        blocks.push({ type: 'image', source: { type:'base64', media_type:a.mediaType, data: base64 } });
      } else if (a.kind === 'pdf'){
        const base64 = a.dataUrl.split(',')[1];
        blocks.push({ type: 'document', source: { type:'base64', media_type:'application/pdf', data: base64 }, filename: a.name });
      } else if (a.kind === 'text'){
        blocks.push({ type: 'text', text: `[Attached file: ${a.name}]\n\n${a.text}` });
      }
    }
    return blocks;
  }

  // ---------------- code execution (sandboxed) ----------------
  // Runs JS in a same-origin sandboxed iframe with no `allow-same-origin`,
  // so it cannot touch this page's DOM, localStorage, or cookies.
  // "Python" support is JS-only unless a WASM runtime is wired in —
  // we detect ```python fences and run them through a tiny shim that
  // supports basic print()/arithmetic so simple calculator-style asks
  // still work without downloading Pyodide (which needs a CDN this
  // environment may not allow). This is intentionally limited; see
  // README notes in the chat for the CDN-based upgrade path.
  function extractCodeBlocks(text){
    const out = [];
    const re = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    while ((match = re.exec(text))){
      out.push({ lang: (match[1]||'').toLowerCase() || 'text', code: match[2] });
    }
    return out;
  }

  function runJsSandboxed(code){
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      // sandbox WITHOUT allow-same-origin: script runs, but the iframe
      // gets a fresh opaque origin with no access to our storage/DOM.
      iframe.setAttribute('sandbox', 'allow-scripts');
      document.body.appendChild(iframe);

      const timeout = setTimeout(() => {
        cleanup();
        resolve({ output: 'Execution timed out (5s limit).', isError: true });
      }, 5000);

      function cleanup(){
        clearTimeout(timeout);
        window.removeEventListener('message', onMsg);
        iframe.remove();
      }

      function onMsg(e){
        if (e.source !== iframe.contentWindow) return;
        cleanup();
        if (e.data.ok) resolve({ output: e.data.log.join('\n'), isError: false });
        else resolve({ output: e.data.error, isError: true });
      }
      window.addEventListener('message', onMsg);

      const runnerHtml = `<script>
        const log = [];
        const origLog = console.log;
        console.log = (...args) => { log.push(args.map(a => typeof a==='object'?JSON.stringify(a):String(a)).join(' ')); };
        try {
          const result = (function(){ ${code} })();
          if (result !== undefined) log.push(String(result));
          parent.postMessage({ ok:true, log }, '*');
        } catch (err) {
          parent.postMessage({ ok:false, error: String(err && err.message || err) }, '*');
        }
      <\/script>`;
      iframe.srcdoc = runnerHtml;
    });
  }

  // Extremely small arithmetic/print shim for python-fenced blocks so
  // "calculate X" style asks work offline. Not a real interpreter.
  function runPythonLite(code){
    try {
      const printMatches = [...code.matchAll(/print\((.+)\)/g)];
      if (printMatches.length === 0){
        return { output: 'No print() statements found — Python execution here only supports simple print()/arithmetic. For full Python, ask the model to use its own code tool if the provider supports one.', isError: true };
      }
      const out = [];
      // very naive: eval the inner expression as JS after light translation
      for (const m of printMatches){
        let expr = m[1].trim();
        expr = expr.replace(/\*\*/g, '**'); // placeholder, handled below
        // convert ** to Math.pow via Function eval trick
        const safeExpr = expr.replace(/(\d+(?:\.\d+)?)\s*\*\*\s*(\d+(?:\.\d+)?)/g, 'Math.pow($1,$2)');
        try {
          // eslint-disable-next-line no-new-func
          const val = Function(`"use strict"; return (${safeExpr});`)();
          out.push(String(val));
        } catch {
          out.push(`<could not evaluate: ${expr}>`);
        }
      }
      return { output: out.join('\n'), isError: false };
    } catch (e){
      return { output: String(e), isError: true };
    }
  }

  async function runCodeBlocksForMessage(msg){
    if (!state.tools.codeExec) return;
    const text = flattenToText(msg.content);
    const blocks = extractCodeBlocks(text);
    if (blocks.length === 0) return;
    msg.codeBlocks = [];
    for (const b of blocks){
      const start = performance.now();
      let result;
      if (b.lang === 'js' || b.lang === 'javascript'){
        result = await runJsSandboxed(b.code);
      } else if (b.lang === 'python' || b.lang === 'py'){
        result = runPythonLite(b.code);
      } else {
        continue; // don't attempt to execute unknown/other languages
      }
      msg.codeBlocks.push({
        lang: b.lang,
        output: result.output,
        isError: result.isError,
        durationMs: Math.round(performance.now() - start),
      });
    }
  }

  // ---------------- sending / streaming ----------------
  async function sendMessage(){
    const chat = getActiveChat();
    if (!chat || !chat.providerId || !chat.modelId) return;
    const providers = getAllProviders();
    const provider = providers[chat.providerId];
    const apiKey = getKey(provider);

    if (!apiKey){
      toast(`No API key set for ${provider.label}. Add one in Providers & keys.`, true);
      openSettings();
      return;
    }

    const text = els.composerInput.value.trim();
    const attachments = state.pendingAttachments.slice();
    if (!text && attachments.length === 0) return;

    // build user message content blocks
    let userContent;
    if (attachments.length > 0 && provider.supportsFiles){
      userContent = [...attachmentsToContentBlocks(attachments, provider.id)];
      if (text) userContent.push({ type: 'text', text });
    } else {
      userContent = text || '(attached files — this provider does not support file input, sending text only)';
    }

    const userMsg = {
      id: 'm_' + Date.now() + '_u',
      role: 'user',
      content: userContent,
      attachments: attachments.map(a => ({ name: a.name })),
    };
    chat.messages.push(userMsg);
    if (chat.title === 'New chat') chat.title = deriveTitle(chat);
    chat.updatedAt = Date.now();

    // reset composer
    els.composerInput.value = '';
    autoGrowTextarea();
    state.pendingAttachments = [];
    renderAttachmentTray();
    renderActiveChat();
    saveChats();
    renderChatList();

    // assistant placeholder
    const asstMsg = {
      id: 'm_' + Date.now() + '_a',
      role: 'assistant',
      content: '',
      streaming: true,
      providerId: provider.id,
      modelLabel: (provider.models.find(m=>m.id===chat.modelId)||{}).label || chat.modelId,
    };
    chat.messages.push(asstMsg);
    renderActiveChat();

    state.streaming = true;
    setStatus('streaming', 'Streaming…');
    updateSendEnabled();

    try {
      await streamFromProvider(provider, apiKey, chat, asstMsg);
      asstMsg.streaming = false;
      await runCodeBlocksForMessage(asstMsg);
      setStatus('idle', 'Ready');
    } catch (err){
      asstMsg.streaming = false;
      asstMsg.error = err.message || String(err);
      setStatus('error', 'Error');
      toast(asstMsg.error, true);
    } finally {
      state.streaming = false;
      updateSendEnabled();
      chat.updatedAt = Date.now();
      saveChats();
      renderActiveChat();
    }
  }

  async function streamFromProvider(provider, apiKey, chat, asstMsg){
    const historyMessages = chat.messages
      .filter(m => m.id !== asstMsg.id)
      .map(m => ({ role: m.role, content: m.content }));

    const body = provider.buildBody({
      model: chat.modelId,
      messages: historyMessages,
      system: buildSystemPreamble(),
      maxTokens: 4096,
    });

    const resp = await fetch(provider.endpoint, {
      method: 'POST',
      headers: provider.buildHeaders(apiKey),
      body: JSON.stringify(body),
    });

    if (!resp.ok){
      let errBody = null;
      try { errBody = await resp.json(); } catch {}
      throw new Error(provider.normalizeError(resp.status, errBody));
    }
    if (!resp.body){
      throw new Error('Streaming not supported by this browser/response.');
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true){
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line for next chunk

      for (const line of lines){
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        const parsed = provider.parseStreamLine(json);
        if (!parsed) continue;
        if (parsed.type === 'text'){
          asstMsg.content = (asstMsg.content || '') + parsed.text;
          patchStreamingMessageEl(asstMsg);
        } else if (parsed.type === 'error'){
          throw new Error(parsed.message);
        }
      }
    }
  }

  function buildSystemPreamble(){
    return 'You are a helpful assistant running inside a local chat client. Format responses in plain markdown (code fences, **bold**, links) — no special tool-call syntax.';
  }

  // Efficient in-place update while streaming, instead of a full re-render
  function patchStreamingMessageEl(msg){
    const el = els.messages.querySelector(`[data-msg-id="${msg.id}"] .msg-content`);
    if (el){
      el.innerHTML = renderMarkdownLite(flattenToText(msg.content));
      scrollToBottom();
    } else {
      renderActiveChat();
    }
  }

  // ---------------- settings modal ----------------
  function openSettings(){
    renderProviderList();
    els.settingsModal.classList.remove('hidden');
  }
  function closeSettings(){
    els.settingsModal.classList.add('hidden');
    renderModelPickerLabel();
    updateSendEnabled();
  }

  function renderProviderList(){
    const providers = getAllProviders();
    els.providerList.innerHTML = '';
    const order = ['anthropic','openai'];

    for (const pid of order){
      const p = providers[pid];
      els.providerList.appendChild(buildProviderCard(p));
    }
    for (const cp of state.customProviders){
      const p = providers[cp.id];
      els.providerList.appendChild(buildProviderCard(p, cp));
    }
  }

  function buildProviderCard(p, customCfg){
    const card = document.createElement('div');
    card.className = 'provider-card';
    const hasKey = !!getKey(p);

    const head = document.createElement('div');
    head.className = 'provider-card-head';
    head.innerHTML = `
      <span class="provider-icon" style="background:${p.color}"></span>
      <span class="provider-name">${escapeHtml(p.label)}</span>
      <span class="provider-status ${hasKey ? 'connected' : ''}">${hasKey ? 'connected' : 'not connected'}</span>
    `;
    card.appendChild(head);

    if (customCfg){
      const fields = document.createElement('div');
      fields.className = 'custom-provider-fields';
      fields.innerHTML = `
        <input type="text" value="${escapeHtml(customCfg.label)}" data-field="label" placeholder="Display name">
        <input type="text" value="${escapeHtml(customCfg.endpoint)}" data-field="endpoint" placeholder="https://.../v1/chat/completions">
        <input type="text" value="${escapeHtml(customCfg.modelIds||'')}" data-field="modelIds" placeholder="model-id-1, model-id-2">
      `;
      fields.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('change', () => {
          customCfg[inp.dataset.field] = inp.value;
          saveCustomProviders();
          renderModelDropdown();
        });
      });
      card.appendChild(fields);

      const rm = document.createElement('button');
      rm.className = 'remove-custom-btn';
      rm.textContent = 'Remove this provider';
      rm.addEventListener('click', () => {
        state.customProviders = state.customProviders.filter(c => c.id !== customCfg.id);
        saveCustomProviders();
        renderProviderList();
        renderModelDropdown();
      });
      card.appendChild(rm);
    }

    const keyRow = document.createElement('div');
    keyRow.className = 'key-row';
    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'key-input';
    input.placeholder = p.keyPlaceholder;
    input.value = getKey(p);
    keyRow.appendChild(input);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'key-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      setKey(p, input.value.trim());
      toast(input.value.trim() ? `${p.label} key saved.` : `${p.label} key cleared.`);
      renderProviderList();
      renderModelDropdown();
      renderModelPickerLabel();
    });
    keyRow.appendChild(saveBtn);

    if (getKey(p)){
      const clearBtn = document.createElement('button');
      clearBtn.className = 'key-clear-btn';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', () => {
        setKey(p, '');
        input.value = '';
        toast(`${p.label} key cleared.`);
        renderProviderList();
        renderModelDropdown();
      });
      keyRow.appendChild(clearBtn);
    }
    card.appendChild(keyRow);

    if (p.docsUrl){
      const link = document.createElement('div');
      link.className = 'provider-link';
      link.innerHTML = `Get a key / confirm current model IDs: <a href="${p.docsUrl}" target="_blank" rel="noopener">${p.docsUrl}</a>`;
      card.appendChild(link);
    }
    if (!customCfg){
      const count = document.createElement('div');
      count.className = 'provider-model-count';
      count.textContent = `${p.models.length} model${p.models.length===1?'':'s'} listed — check the docs link above, since exact IDs change over time.`;
      card.appendChild(count);
    }

    return card;
  }

  function addCustomProvider(){
    const id = 'custom_' + Date.now().toString(36);
    state.customProviders.push({
      id, label: 'New endpoint', endpoint: '', modelIds: '',
    });
    saveCustomProviders();
    renderProviderList();
  }

  // ---------------- event wiring ----------------
  function wireEvents(){
    els.newChatBtn.addEventListener('click', () => newChat());

    els.modelPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (els.modelDropdown.classList.contains('hidden')) openModelDropdown();
      else closeModelDropdown();
    });
    document.addEventListener('click', (e) => {
      if (!els.modelPicker.contains(e.target)) closeModelDropdown();
    });

    els.toolsToggleBtn.addEventListener('click', () => {
      els.toolsBar.classList.toggle('hidden');
      els.toolsToggleBtn.classList.toggle('active');
    });

    els.toolCodeExec.addEventListener('change', () => {
      state.tools.codeExec = els.toolCodeExec.checked;
      saveTools();
    });
    els.toolFileAnalysis.addEventListener('change', () => {
      state.tools.fileAnalysis = els.toolFileAnalysis.checked;
      saveTools();
    });

    els.settingsBtn.addEventListener('click', openSettings);
    els.emptyStateSettingsLink.addEventListener('click', openSettings);
    els.closeSettingsBtn.addEventListener('click', closeSettings);
    els.settingsModal.addEventListener('click', (e) => {
      if (e.target === els.settingsModal) closeSettings();
    });
    els.addCustomProviderBtn.addEventListener('click', addCustomProvider);

    els.attachBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', (e) => {
      handleFiles(e.target.files);
      els.fileInput.value = '';
    });

    // drag & drop onto composer
    els.composer.addEventListener('dragover', (e) => { e.preventDefault(); });
    els.composer.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });

    els.composerInput.addEventListener('input', autoGrowTextarea);
    els.composerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        if (!els.sendBtn.disabled) sendMessage();
      }
    });
    els.sendBtn.addEventListener('click', sendMessage);

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n'){
        e.preventDefault();
        newChat();
      }
      if (e.key === 'Escape'){
        closeModelDropdown();
        if (!els.settingsModal.classList.contains('hidden')) closeSettings();
      }
    });
  }

  // ---------------- init ----------------
  function init(){
    cacheEls();
    loadState();
    els.toolCodeExec.checked = state.tools.codeExec;
    els.toolFileAnalysis.checked = state.tools.fileAnalysis;
    wireEvents();

    if (state.chats.length > 0){
      state.activeChatId = [...state.chats].sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt))[0].id;
    }
    renderChatList();
    renderActiveChat();

    // Nudge toward settings if nothing is connected yet
    const providers = getAllProviders();
    const anyKey = Object.values(providers).some(p => getKey(p));
    if (!anyKey){
      setTimeout(() => toast('Add an API key in Providers & keys to start chatting.'), 500);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
