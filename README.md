# ChatGPT to AI Exporter — Portable Snapshot + Attachments

[![Violentmonkey Compatible](https://img.shields.io/badge/Violentmonkey-Compatible-blue?logo=firefox-browser&logoColor=white)](https://violentmonkey.github.io/)
[![Firefox Extension](https://img.shields.io/badge/Firefox-Tested%20%26%20Supported-orange?logo=firefox&logoColor=white)](https://addons.mozilla.org/firefox/addon/violentmonkey/)
[![Version](https://img.shields.io/badge/version-1.6.0-green.svg)](https://github.com/0xra/chatgpt-ai-export/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)](chatgpt-ai-export.js)

A lightweight, privacy-focused **Violentmonkey userscript** tailored for **Mozilla Firefox** that extracts full ChatGPT conversations into clean, portable **Markdown**, structured **JSON**, or self-contained **ZIP archives** complete with original downloaded attachments, code blocks, and source citations.

---

## 📋 Table of Contents

- [Why This Script?](#-why-this-script)
- [Key Features](#-key-features)
- [Requirements](#-requirements)
- [Installation Guide](#-installation-guide)
  - [Method 1: One-Click Installation (Recommended)](#method-1-one-click-installation-recommended)
  - [Method 2: Manual Installation](#method-2-manual-installation)
- [How to Use](#-how-to-use)
  - [1. Floating UI Controls](#1-floating-ui-controls)
  - [2. Exporting the Active Chat](#2-exporting-the-active-chat)
  - [3. Exporting by URL or ID](#3-exporting-by-url-or-id)
  - [4. Including Attachments & Images](#4-including-attachments--images)
  - [5. Importing Official ChatGPT Account Exports](#5-importing-official-chatgpt-account-exports)
- [Export Formats & Structure](#-export-formats--structure)
  - [ZIP Archive Breakdown](#zip-archive-breakdown)
  - [Markdown Output Sample](#markdown-output-sample)
  - [JSON Structure](#json-structure)
- [GitHub Repository Setup (Description, Topics & Release)](#-github-repository-setup)
  - [GitHub Repository Description](#github-repository-description)
  - [GitHub Topics](#github-topics)
  - [GitHub Release: v1.6.0](#github-release-v160)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [Privacy & Security](#-privacy--security)
- [License](#-license)

---

## 💡 Why This Script?

Official ChatGPT account exports are cumbersome: you have to wait hours for an email containing a massive, multi-megabyte `conversations.json` file with confusing message tree structures. Furthermore:
- Most browser extensions scrape only the visible DOM, truncating long conversations due to virtual scrolling.
- Code blocks often lose language tags and indentation.
- Uploaded files, generated charts, and media attachments are left behind as expired or broken links.
- Web search citations turn into unreadable internal tokens (`\uE200...`).

**ChatGPT to AI Exporter** solves these issues by:
1. Interfacing directly with ChatGPT's internal authenticated backend API (`/backend-api/conversations/:id`) to paginate backwards through every single turn without missing messages.
2. Providing an automatic smooth-scroll DOM fallback if the API is restricted or when viewing public shared links (`/share/...`).
3. Downloading uploaded files and media directly from OpenAI's CDN and packing them into an offline-ready ZIP with rewired relative paths.
4. Parsing interactive citations into clean, clickable Markdown references.

---

## ✨ Key Features

- **Multi-Format Exporting**:
  - 📦 **ZIP Bundle**: Combines Markdown, JSON, source catalog (`sources.md`), audit manifest (`export-manifest.json`), and original attachments in one package.
  - 📝 **Markdown (`.md`)**: GitHub-flavored markdown preserving code block languages, nested lists, tables, quotes, and metadata headers.
  - 🗄️ **JSON (`.json`)**: Sanitized, linearized message sequence with timestamps, model slugs, and attachment references.
  - 📄 **Plain Text (`.txt`)**: Minimalist transcript for quick reading or feeding into LLMs.
- **Attachment Downloader**:
  - Automatically fetches original uploaded files and generated media (up to 50 MiB per file, 150 MiB total per export) from trusted OpenAI storage (`files.oaiusercontent.com`).
  - Rewires Markdown attachment references (`[Attached file: data.csv](attachments/file_id--data.csv)`) so everything links locally.
- **Deep Pagination Support**:
  - Traverses cursor-based pagination (`?num_turns=100&before=...`) to capture thousands of messages in a single continuous session.
- **Web Search & Citation Cleaner**:
  - Detects ChatGPT's internal citation tokens (`\uE200...`) and transforms them into standard Markdown hyperlinks.
  - Documents unresolved internal citations in `sources.md`.
- **Zero External Dependencies**:
  - Built-in pure JavaScript **CRC32** and **ZIP32** encoders.
  - No external npm packages, CDNs, or heavy libraries.
- **Privacy-First & Sandboxed**:
  - Uses `@grant none` to run strictly in the content script sandbox.
  - No data is sent to third-party analytics, remote trackers, or external servers.
- **Dark Mode Floating Panel**:
  - Compact, collapsible, bottom-right UI widget that automatically detects active conversation URLs.

---

## 📦 Requirements

- **Browser**: [Mozilla Firefox](https://www.mozilla.org/firefox/) (Desktop or Android Nightly with extension support)
- **Userscript Manager**: [Violentmonkey for Firefox](https://addons.mozilla.org/firefox/addon/violentmonkey/) *(Also compatible with Tampermonkey)*

---

## 🚀 Installation Guide

### Method 1: One-Click Installation (Recommended)

1. Make sure the **[Violentmonkey extension](https://addons.mozilla.org/firefox/addon/violentmonkey/)** is installed and enabled in Firefox.
2. Click the direct raw script link below:
   👉 **[Install chatgpt-ai-export.js](https://raw.githubusercontent.com/0xra/chatgpt-ai-export/main/chatgpt-ai-export.js)**
3. Violentmonkey will automatically open a confirmation tab showing script details and permissions.
4. Click **Confirm installation** (or **Install**).
5. Navigate to [chatgpt.com](https://chatgpt.com/) and refresh the page. You will see the floating export widget in the bottom-right corner!

### Method 2: Manual Installation

1. Open Firefox and click the **Violentmonkey** extension icon in your toolbar.
2. Click the **+** (Create a new script) button to open the script editor.
3. Replace any default template code with the full contents of [`chatgpt-ai-export.js`](chatgpt-ai-export.js).
4. Click **Save & Close** (or press `Ctrl + S`).
5. Open [chatgpt.com](https://chatgpt.com/). The userscript is active and ready.

---

## 🖥️ How to Use

When visiting [chatgpt.com](https://chatgpt.com/) or [chat.openai.com](https://chat.openai.com/), a dark-mode floating widget labeled **ChatGPT → AI Export v1.6** appears at the bottom-right of your screen.

### 1. Floating UI Controls

- **`−` / `+`**: Minimizes or restores the panel.
- **Target URL Box**: Displays the current conversation URL (or lets you paste another chat link).
- **Format Dropdown**: Select between `ZIP`, `Markdown only`, `JSON only`, or `Plain text`.
- **Include original attachments checkbox**: When enabled (default), downloads attachment files directly into the ZIP.
- **Export URL**: Navigates to and exports the conversation specified in the URL box.
- **Export current page**: Captures and downloads the currently active chat.
- **Import JSON for this chat**: Re-packages an official OpenAI data export file.
- **Cancel**: Aborts an ongoing export immediately.

### 2. Exporting the Active Chat

1. Open any ChatGPT conversation in your browser tab.
2. Select your desired format from the dropdown (e.g., **ZIP · Markdown + JSON + Files**).
3. Click **Export current page**.
4. The status label will update in real-time (`Trying authenticated ChatGPT conversation API…` → `Downloading original files…` → `Saved X messages`).
5. Your browser will prompt to save the generated file (e.g., `My-Conversation-Title-6ae51350.zip`).

### 3. Exporting by URL or ID

1. Paste any conversation URL (`https://chatgpt.com/c/UUID` or `https://chatgpt.com/share/UUID`) into the **Target conversation URL** box.
2. Click **Export URL**.
3. If the chat is not currently open, the script will automatically store a pending job, navigate to that conversation, and execute the export on arrival.

### 4. Including Attachments & Images

When exporting to **ZIP**, leave the **Include original attachments** box checked:
- The script inspects message metadata for file pointers (`file_...`).
- Files are verified against strict domain allowlists (`*.oaiusercontent.com` and `chatgpt.com`).
- Files exceeding 50 MiB or archives exceeding 150 MiB are flagged and documented in the manifest to prevent browser tab crashes.
- Inside the exported Markdown, links point directly to the offline file: `[Attached file: sales.xlsx](attachments/file_abc123--sales.xlsx)`.

### 5. Importing Official ChatGPT Account Exports

If you requested your data via **ChatGPT Settings → Data Controls → Export Data**:
1. Paste the target chat URL (`/c/<UUID>`) into the URL box.
2. Click **Import JSON for this chat**.
3. Select your `conversations.json` file.
4. The script isolates the requested chat, normalizes message hierarchy, cleans code blocks, and exports a clean Markdown or ZIP snapshot.

---

## 📁 Export Formats & Structure

### ZIP Archive Breakdown

When choosing the **ZIP** format, the resulting archive is organized as follows:

```text
My-Chat-Title-a1b2c3d4.zip
│
├── My-Chat-Title-a1b2c3d4.md          # Full conversation in GitHub-flavored Markdown
├── My-Chat-Title-a1b2c3d4.json        # Normalized JSON message array
├── sources.md                         # Catalog of resolved web links & internal citations
├── export-manifest.json               # Audit log (timestamp, message counts, file statuses)
└── attachments/                       # Downloaded attachments & generated images
    ├── file_67a8b9c0--dataset.csv
    └── file_f1e2d3c4--diagram.png
```

### Markdown Output Sample

The generated `.md` file includes clean metadata and fenced code blocks:

````markdown
# Architecture Discussion - Microservices

- Source: https://chatgpt.com/c/6ae51350-a0d0-83eb-81ad-48e814d3a990
- Exported: 2026-11-09T18:50:00.000Z
- Capture: authenticated API
- Messages captured: 14

---

## 1. User
*2026-11-09T18:42:10.000Z*

How do I structure service-to-service authentication in Go?

---

## 2. Assistant
*2026-11-09T18:42:25.000Z | model: gpt-4o*

Here is an idiomatic example using mutual TLS (mTLS):

```go
package main

import (
    "crypto/tls"
    "net/http"
)
// ...
```

---
````

### JSON Structure

The `.json` file contains a clean, schema-consistent array:

```json
{
  "title": "Architecture Discussion - Microservices",
  "url": "https://chatgpt.com/c/6ae51350-a0d0-83eb-81ad-48e814d3a990",
  "source": "authenticated API",
  "created_at": "2026-11-09T18:42:00.000Z",
  "updated_at": "2026-11-09T18:45:00.000Z",
  "exported_at": "2026-11-09T18:50:00.000Z",
  "message_count": 14,
  "messages": [
    {
      "id": "aaa111-...",
      "role": "user",
      "text": "How do I structure service-to-service authentication in Go?",
      "created_at": "2026-11-09T18:42:10.000Z",
      "model": null,
      "attachments": [],
      "references": []
    }
  ],
  "verification": {
    "completeness": "API-selected branch",
    "message_ids_available": 14
  }
}
```

---

## 🏷️ GitHub Repository Setup

When configuring your GitHub repository for this project, use the following pre-formatted details:

### GitHub Repository Description

```text
Export ChatGPT conversations to clean Markdown, JSON, and ZIP archives with attachments. A zero-dependency Violentmonkey userscript for Firefox.
```

*(Length: 144 characters — well within GitHub's 350-character limit)*

---

### GitHub Topics

Add these topics under your repository's **About → Topics** setting:

```text
chatgpt, chatgpt-exporter, userscript, violentmonkey, firefox, firefox-extension, markdown, json-export, export-tool, ai-chat, greasemonkey, tampermonkey
```

---

### GitHub Release: v1.6.0

To create the release on GitHub:

#### Option A: Using GitHub Web UI
1. Go to your repository on GitHub and click **Releases → Draft a new release**.
2. Set **Tag version** to `v1.6.0`.
3. Set **Release title** to `v1.6.0 — ChatGPT to AI Exporter (Markdown + JSON + Attachments)`.
4. Copy and paste the release notes below into the description box.
5. Drag and drop `chatgpt-ai-export.js` into the release binaries/assets area.
6. Click **Publish release**.

#### Option B: Using GitHub CLI (`gh`)
```bash
gh release create v1.6.0 chatgpt-ai-export.js \
  --title "v1.6.0 — ChatGPT to AI Exporter (Markdown + JSON + Attachments)" \
  --notes-file RELEASE_NOTES.md
```

#### Release Notes Template

```markdown
# 🚀 v1.6.0 — Portable Snapshot + Attachments

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
```

---

## 🔧 Troubleshooting & FAQ

### 1. The script says "ChatGPT APIs unavailable; switching to browser page"
This occurs when:
- You are viewing a public shared conversation (`/share/...`), which does not provide private API access.
- Cloudflare or ChatGPT rate-limited background API queries.
**Solution**: No action is needed! The script automatically engages the rendered DOM collector, scrolling smoothly from top to bottom to extract visible messages.

### 2. Can I use this with Tampermonkey or Greasemonkey?
Yes! The script uses standard userscript headers and `@grant none`. While optimized and tested on Violentmonkey for Firefox, it works smoothly on Tampermonkey and FireMonkey.

### 3. Why are some attachments marked as `skipped_size_limit`?
To prevent browser memory exhaustion, individual files exceeding **50 MiB** or total archive attachments exceeding **150 MiB** are skipped. The filename and reason are noted in `export-manifest.json`.

### 4. Does it capture generated images and code snippets?
Yes! DALL-E images, uploaded photos, CSVs, and code snippets are parsed and saved into the `attachments/` folder inside the ZIP file.

---

## 🔒 Privacy & Security

- **No Remote Servers**: Conversation data and auth tokens never leave your local browser session.
- **Strict Host Allowlist**: Downloads are restricted exclusively to `chatgpt.com` and `*.oaiusercontent.com`.
- **Token Sanitization**: Authentication tokens are strictly kept in memory and automatically redacted from error logs and output files.
- **No Elevated Privileges**: Uses `@grant none` to ensure the script operates strictly within standard webpage security sandboxes.

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.
