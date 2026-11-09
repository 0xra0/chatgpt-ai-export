# v1.6.0 — ChatGPT to AI Exporter (Markdown + JSON + Attachments)

Export full ChatGPT conversations into clean, offline-ready Markdown, JSON, or complete ZIP packages with downloaded attachments. Optimized for Violentmonkey on Mozilla Firefox.

### ✨ Highlights
- **Direct API Pagination**: Automatically retrieves long conversations turn-by-turn through ChatGPT's internal conversation API with full message integrity.
- **Attachment Extraction**: Downloads uploaded files, code artifacts, and images directly from OpenAI storage into the ZIP archive (`attachments/`).
- **Offline Markdown Linking**: Rewrites attachment links inside Markdown to point to the local files bundled in the ZIP.
- **Web Reference & Citation Resolution**: Cleans proprietary tokens and builds a dedicated `sources.md` catalog of citation links.
- **DOM Fallback Engine**: Seamlessly falls back to virtual DOM scrolling if the API is restricted or on shared links.
- **Official Account Data Repackaging**: Import and normalize `conversations.json` from official OpenAI account export dumps.
- **Zero Dependencies**: Features pure JavaScript CRC32 and ZIP32 compression engine with `@grant none`.

### 📦 Installation
Click here to install via Violentmonkey:
👉 **[Install chatgpt-ai-export.js](https://raw.githubusercontent.com/0xra/chatgpt-ai-export/main/chatgpt-ai-export.js)**

### 🛡️ Compatibility
- **Violentmonkey** (Recommended) on Firefox 115+
- **Tampermonkey** on Firefox / Chromium browsers
- Tested with latest ChatGPT web interface
