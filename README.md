# Hub — local multi-model chat

A single local web app to chat with Claude, GPT-6 Astra, or any
OpenAI-compatible API, side by side, with code execution and file
analysis built in.

## Run it

Double-click `index.html`, or open it directly in any browser. No
install, no server, no build step. Everything — chat history, your
API keys, settings — lives only in this browser's local storage on
this machine.

## Get API keys (required before you can chat)

Neither key below is included with a ChatGPT Plus or Claude Pro
subscription — API access is billed separately, per token used.

- **Anthropic (Claude):** console.anthropic.com → Settings → API
  Keys. You'll need to add a payment method.
- **OpenAI (GPT-6 Astra):** platform.openai.com → API Keys. Also
  needs billing set up. GPT-6 Astra is currently rolling out
  gradually and is priced well above most other models ($10/M input,
  $50/M output tokens as of this writing) — worth watching your
  usage, especially while testing.

Once you have a key, open **Providers & keys** (bottom of the
sidebar, or the prompt that appears when you pick a model with no
key set) and paste it in. Keys are saved to this browser only and
sent directly from your machine to the provider you're using —
nothing passes through any server of mine.

## What's actually built in

- **Multi-provider chat** — Claude and OpenAI adapters ship built
  in; add any other OpenAI-compatible endpoint (OpenRouter, a local
  Ollama/LM Studio server, Groq, etc.) via "+ Add custom endpoint"
  in Providers & keys.
- **Streaming responses** — replies appear token-by-token as they're
  generated, not all at once.
- **File analysis** — attach PDFs, images, or text files. Claude
  models read PDFs natively; OpenAI's chat-completions API does not
  accept inline PDF bytes the way Anthropic's does, so a PDF sent to
  an OpenAI model is swapped for a note telling you to switch to
  Claude for that file (rather than silently failing).
- **Code execution, with a real caveat:**
  - **JavaScript** fences in a response run for real, in a sandboxed
    iframe that cannot see this page's storage, cookies, or DOM.
  - **Python** fences run through a tiny hand-built shim that only
    understands `print()` and basic arithmetic — it is NOT a real
    Python interpreter. It exists so quick calculator-style requests
    work without any download. For actual Python execution (pandas,
    numpy, real scripts), the honest options are: run it in a real
    environment, or wire in [Pyodide](https://pyodide.org) — a
    WASM Python runtime — which needs loading a script from a CDN.
    I didn't wire that in by default since it adds an external
    dependency and a real download (tens of MB) the first time it
    runs; if you want it, that's a clearly scoped follow-up.
- **Multiple conversations** — saved in the sidebar, switch anytime.

## Known limitations, stated plainly

- **Model lists will go stale.** `providers.js` hardcodes model IDs
  as of build time (Sept 2026). Model names change often — each
  provider card in Settings links to that provider's live docs page
  so you can confirm the exact current ID string before relying on
  it, especially for something like `gpt-6-astra` which is still in
  gradual rollout.
- **No true web search.** I left this out of the first build since
  it needs a third API key and separate billing (e.g. Brave Search).
  The toggle exists in the Tools bar but is disabled with a note
  explaining why — happy to wire it in once you've got the other two
  working and want it.
- **Custom tools** (calculator functions, lookups against your own
  data) aren't built yet — that's a "once you know what you specifically
  want" feature rather than something generic to guess at.
- **localStorage has a real ceiling**, typically 5–10MB per browser.
  Attached images/PDFs are the main thing that eats into that. If
  you hit the limit, the app now trims older attachments from saved
  history automatically (keeping the visible text) rather than
  silently losing your chats — you'll see a toast if that happens.

## File map

- `index.html` — structure
- `style.css` — all styling
- `providers.js` — provider registry + request/response adapters
  (this is the file to edit if you want to add a new provider by
  hand, rather than the generic custom-endpoint option)
- `app.js` — everything else: state, streaming, tools, UI wiring
