
// ==UserScript==
// @name         ChatGPT to AI Exporter — Portable Snapshot + Attachments
// @namespace    https://github.com/0xra/chatgpt-ai-export
// @version      1.6.0
// @description  Export ChatGPT conversations to clean Markdown, JSON, and ZIP with original attachments. Optimized for Violentmonkey on Firefox.
// @author       0xra
// @license      MIT
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @icon         https://chatgpt.com/favicon.ico
// @homepageURL  https://github.com/0xra/chatgpt-ai-export
// @supportURL   https://github.com/0xra/chatgpt-ai-export/issues
// @downloadURL  https://raw.githubusercontent.com/0xra/chatgpt-ai-export/main/chatgpt-ai-export.js
// @updateURL    https://raw.githubusercontent.com/0xra/chatgpt-ai-export/main/chatgpt-ai-export.js
// @grant        none
// @run-at       document-idle
// @inject-into  content
// @noframes
// ==/UserScript==
(() => {
  'use strict';
  const ID = 'chatgpt-ai-export-160';
  if (document.getElementById(ID)) return;
  const KEY = 'chatgpt-ai-export-160-pending';
  const DEFAULT = '';
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => new Date().toISOString();
  const encoder = new TextEncoder();
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
  let busy = false, cancel = false, token = null;
  const fileName = s => String(s || 'ChatGPT-conversation')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90);

  function links(value) {
    const re = new RegExp('(?:https?:\\/\\/)?(?:www\\.)?(?:chatgpt\\.com|chat\\.openai\\.com)\\/(share|c)\\/(' + UUID + ')(?![0-9a-f-])', 'gi');
    const seen = new Set(), result = [];
    for (const match of String(value || '').matchAll(re)) {
      const type = match[1].toLowerCase(), id = match[2].toLowerCase();
      const url = `https://chatgpt.com/${type}/${id}`;
      if (!seen.has(url)) { seen.add(url); result.push({ id, type, url }); }
    }
    if (!result.length && new RegExp('^' + UUID + '$', 'i').test(String(value).trim())) {
      const id = String(value).trim().toLowerCase();
      result.push({ id, type: 'c', url: `https://chatgpt.com/c/${id}` });
    }
    return result.sort((a, b) => (a.type === 'share' ? 0 : 1) - (b.type === 'share' ? 0 : 1));
  }
  const current = () => links(location.href)[0] || null;
  const check = () => { if (cancel) throw new Error('Stopped by user'); };
  function timestamp(value) {
    if (value == null) return null;
    const d = new Date(typeof value === 'number' && value < 1e11 ? value * 1000 : value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  function fileId(value) {
    const candidate = String(value || '');
    const hit = candidate.match(/(?:^|:\/\/|\/)(file_[A-Za-z0-9_-]{8,})(?:$|[?#/])/);
    return hit ? hit[1] : null;
  }
  function basename(name) {
    const value = String(name || 'Attachment').replace(/\\/g, '/').split('/').pop();
    const safe = value.replace(/[\x00-\x1f\x7f<>:"|?*\/\\]/g, '_')
      .replace(/\s+/g, '_').replace(/^\.+/, '_').slice(0, 95);
    return safe || 'Attachment';
  }
  function safePublicUrl(raw) {
    try {
      const u = new URL(String(raw));
      if (!['http:', 'https:'].includes(u.protocol)) return null;
      if (u.hostname === 'chatgpt.com' && u.pathname.startsWith('/backend-api/')) return null;
      for (const key of u.searchParams.keys()) {
        if (/token|signature|sig|auth|credential|password|secret|key|policy/i.test(key)) return null;
      }
      return u.href;
    } catch { return null; }
  }
  function collectReferences(message, meta) {
    const found = [], keys = new Set();
    const sources = [meta.content_references, meta.citations, meta.sources,
      message.content?.references, message.content?.citations];
    for (const group of sources) {
      if (!Array.isArray(group)) continue;
      for (const r of group.slice(0, 200)) {
        if (!r || typeof r !== 'object') continue;
        const url = safePublicUrl(r.url || r.source_url || r.web_url || r.link ||
          r.metadata?.url || r.source?.url);
        const ref = String(r.ref || r.ref_id || r.reference_id || r.citation_id ||
          r.source_id || r.id || '').slice(0, 120);
        const matched = String(r.matched_text || '').slice(0, 300);
        const title = String(r.title || r.source_title || r.name || r.source?.title || '').slice(0, 200);
        if (!ref && !matched && !url) continue;
        const key = ref + '|' + matched + '|' + url;
        if (keys.has(key)) continue;
        keys.add(key);
        found.push({ ref: ref || null, matched_text: matched || null,
          title: title || null, url: url || null });
      }
    }
    return found;
  }
  function metadataAttachments(meta, content) {
    const result = [], byId = new Map(), nameKeys = new Set();
    function add(name, mime, candidateId, size, origin) {
      const id = fileId(candidateId);
      const safeName = basename(name || (origin === 'image' ? 'image.png' : 'Attachment'));
      const key = id || `${origin}:${safeName}`;
      if (id && byId.has(id)) {
        const old = byId.get(id);
        if (old.name === 'Attachment' && safeName !== 'Attachment') old.name = safeName;
        if (!old.type && mime) old.type = mime;
        return;
      }
      if (!id && nameKeys.has(key)) return;
      const att = { name: safeName, type: mime || null, file_id: id,
        size_bytes: Number.isFinite(Number(size)) && Number(size) >= 0 ? Number(size) : null,
        path: null, status: 'not_attempted', error: null };
      result.push(att);
      if (id) byId.set(id, att); else nameKeys.add(key);
    }
    for (const entry of Array.isArray(meta.attachments) ? meta.attachments : []) {
      if (!entry || typeof entry !== 'object') continue;
      add(entry.name || entry.filename || entry.file_name,
        entry.mime_type || entry.type, entry.file_id || entry.id || entry.asset_pointer,
        entry.size_bytes || entry.size, 'metadata');
    }
    for (const part of Array.isArray(content?.parts) ? content.parts : []) {
      if (!part || typeof part !== 'object') continue;
      const ptr = part.asset_pointer || part.file_id || part.id || part.metadata?.asset_pointer;
      const type = String(part.content_type || part.type || '');
      if (!ptr && !/(image|audio|video|attachment)/i.test(type)) continue;
      const ext = /image/i.test(type) ? '.png' : /audio/i.test(type) ? '.bin' :
        /video/i.test(type) ? '.mp4' : '.bin';
      add(part.name || part.filename || part.file_name ||
        (fileId(ptr) ? `${fileId(ptr)}${ext}` : `unidentified_${type || 'media'}${ext}`),
        part.mime_type || null, ptr, part.size_bytes, /image/i.test(type) ? 'image' : 'media');
    }
    return result;
  }

  function contentText(content) {
    if (typeof content === 'string') return content;
    if (!content || typeof content !== 'object') return '';
    if (content.content_type === 'code') return `\`\`\`${content.language || ''}\n${content.text || ''}\n\`\`\``;
    if (Array.isArray(content.parts)) return content.parts.map(p => {
      if (typeof p === 'string') return p;
      if (!p || typeof p !== 'object') return '';
      if (typeof p.text === 'string') return p.text;
      if (typeof p.transcript === 'string') return p.transcript;
      if (typeof p.caption === 'string') return p.caption;
      return `[${p.content_type || p.type || 'Media'} attachment; contents not included]`;
    }).filter(Boolean).join('\n\n');
    return typeof content.text === 'string' ? content.text : '';
  }
  function messageOf(node) {
    const m = node?.message || node;
    if (!m) return null;
    const role = m.author?.role || m.role;
    if (!['user', 'assistant'].includes(role)) return null;
    const meta = m.metadata || {};
    if (meta.is_visually_hidden_from_conversation ||
        ['analysis', 'justify', 'confidence', 'summary', 'delegate_summary'].includes(meta.channel || m.channel) ||
        (m.recipient && !['all', 'user'].includes(m.recipient))) return null;
    const attachments = metadataAttachments(meta, m.content);
    const txt = [contentText(m.content), ...attachments.map(a => `[Attached file: ${a.name}]`)]
      .filter(Boolean).join('\n\n').trim();
    if (!txt) return null;
    return { id: m.id || node?.id || null, role, text: txt,
      created_at: timestamp(m.create_time), model: meta.model_slug || null,
      attachments, references: collectReferences(m, meta), _format: 'markdown' };
  }
  function normalize(raw, link, source) {
    let input = raw.messages || raw.linear_conversation;
    if (!Array.isArray(input) && raw.mapping) {
      const mapping = raw.mapping;
      let at = raw.current_node;
      if (!mapping[at]) {
        let longest = [];
        for (const [id, node] of Object.entries(mapping)) {
          if (node?.children?.length) continue;
          const path = [], visited = new Set(); let cursor = id;
          while (cursor && mapping[cursor] && !visited.has(cursor)) {
            path.push(cursor); visited.add(cursor); cursor = mapping[cursor].parent;
          }
          if (path.length > longest.length) longest = path;
        }
        input = longest.reverse().map(id => mapping[id]?.message);
      } else {
        const path = [], visited = new Set();
        while (at && mapping[at] && !visited.has(at)) {
          path.push(at); visited.add(at); at = mapping[at].parent;
        }
        if (at && visited.has(at)) throw new Error('Message graph contains a cycle');
        input = path.reverse().map(id => mapping[id]?.message);
      }
    }
    if (!Array.isArray(input)) throw new Error('Unsupported conversation API format');
    const seen = new Set(), messages = [];
    for (const node of input) {
      const msg = messageOf(node);
      if (!msg) continue;
      if (msg.id && seen.has(msg.id)) continue;
      if (msg.id) seen.add(msg.id);
      messages.push(msg);
    }
    return { title: raw.title || 'ChatGPT conversation', url: link.url, source,
      created_at: timestamp(raw.create_time), updated_at: timestamp(raw.update_time),
      exported_at: now(), message_count: messages.length, messages,
      verification: { completeness: 'API-selected branch', message_ids_available: messages.filter(m => m.id).length } };
  }
  function apiURL(path) {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin ||
        !(url.pathname.startsWith('/backend-api/') || url.pathname === '/api/auth/session'))
      throw new Error('Unexpected API address');
    return url.href;
  }
  async function getToken() {
    if (token) return token;
    try {
      const res = await fetch(apiURL('/api/auth/session'), { credentials: 'include' });
      if (res.ok) token = (await res.json()).accessToken || null;
    } catch {}
    return token;
  }
  async function api(path) {
    const bearer = await getToken();
    const headers = { Accept: 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const res = await fetch(apiURL(path), { credentials: 'include', headers });
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status} ${new URL(apiURL(path)).pathname}`);
      error.status = res.status; throw error;
    }
    if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('API did not return JSON');
    return res.json();
  }
  async function apiBackoff(path) {
    for (let i = 0; i < 3; i++) {
      check();
      try { return await api(path); } catch (e) {
        if (![429, 500, 502, 503, 504].includes(e.status) || i === 2) throw e;
        await sleep((i + 1) * 1500);
      }
    }
  }
  async function privateChat(link) {
    let newerError;
    try {
      const base = `/backend-api/conversations/${link.id}`;
      const first = await apiBackoff(`${base}?num_turns=100`);
      if (Array.isArray(first.messages)) {
        const pages = [first.messages];
        let cursor = first.page_info?.start_cursor;
        let more = first.page_info?.has_previous_page === true;
        const seen = new Set();
        while (more) {
          check();
          if (!cursor || seen.has(cursor) || seen.size > 500)
            throw new Error('Message pagination incomplete');
          seen.add(cursor); status(`Retrieving older messages (page ${seen.size + 1})…`);
          const next = await apiBackoff(`${base}?num_turns=100&before=${encodeURIComponent(cursor)}`);
          if (!Array.isArray(next.messages) || !next.messages.length)
            throw new Error('Empty API page when more messages were expected');
          pages.unshift(next.messages);
          cursor = next.page_info?.start_cursor;
          more = next.page_info?.has_previous_page === true;
        }
        const chat = normalize({ ...first, messages: pages.flat() }, link, 'authenticated API');
        if (!first.page_info && first.messages.length >= 100) {
          chat.warning = 'API returned at least 100 messages but provided no pagination metadata; older messages might be missing.';
          chat.verification.completeness = 'UNVERIFIED — pagination metadata missing';
        }
        return chat;
      }
      if (first.mapping) return normalize(first, link, 'authenticated API');
      throw new Error('Unknown API response');
    } catch (error) { newerError = error; }
    try {
      const legacy = await apiBackoff(`/backend-api/conversation/${link.id}`);
      return normalize(legacy, link, 'authenticated legacy API');
    } catch (error) {
      throw new Error(`ChatGPT APIs unavailable (${newerError.message}; ${error.message})`);
    }
  }

  function toMarkdown(element) {
    const children = node => [...node.childNodes].map(render).join('');
    const raw = node => (node.textContent || '').replace(/\r\n?/g, '\n');
    const fence = text => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));
    function list(node, level = 0) {
      let out = '', number = Number(node.getAttribute('start') || 1);
      const ordered = node.tagName.toLowerCase() === 'ol';
      for (const li of [...node.children].filter(x => x.tagName?.toLowerCase() === 'li')) {
        const nested = [...li.children].filter(x => /^(ol|ul)$/i.test(x.tagName));
        const content = [...li.childNodes].filter(x => !nested.includes(x)).map(render).join('').trim();
        const prefix = `${'  '.repeat(level)}${ordered ? `${number++}.` : '-'} `;
        out += prefix + content.replace(/\n/g, '\n' + '  '.repeat(level + 1)) + '\n';
        for (const nestedList of nested) out += list(nestedList, level + 1);
      }
      return out;
    }
    function render(node) {
      if (node.nodeType === 3) return node.nodeValue || '';
      if (node.nodeType !== 1) return '';
      const tag = node.tagName.toLowerCase();
      if (['button','svg','script','style','noscript','textarea','input'].includes(tag) ||
          node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden')) return '';
      if (tag === 'pre') {
        const code = node.querySelector('code') || node;
        const text = raw(code).replace(/\n$/, '');
        const lang = String(code.className || '').match(/(?:language|lang)-([\w+#.-]+)/)?.[1] || '';
        const ticks = fence(text);
        return `\n\n${ticks}${lang}\n${text}\n${ticks}\n\n`;
      }
      if (tag === 'code') {
        const text = raw(node);
        const ticks = '`'.repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)));
        return ticks + text + ticks;
      }
      if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(+tag[1])} ${children(node).trim()}\n\n`;
      if (tag === 'p') return children(node) + '\n\n';
      if (tag === 'br') return '\n';
      if (['strong','b'].includes(tag)) return `**${children(node)}**`;
      if (['em','i'].includes(tag)) return `*${children(node)}*`;
      if (['s','del'].includes(tag)) return `~~${children(node)}~~`;
      if (tag === 'blockquote') return '\n\n> ' + children(node).trim().replace(/\n/g, '\n> ') + '\n\n';
      if (tag === 'ul' || tag === 'ol') return '\n' + list(node) + '\n';
      if (tag === 'li') return children(node);
      if (tag === 'hr') return '\n\n---\n\n';
      if (tag === 'img') return `[Image: ${node.getAttribute('alt') || 'attachment'}]`;
      if (tag === 'a') {
        const h = node.getAttribute('href') || '';
        if (!/^https?:\/\//i.test(h)) return children(node);
        return `[${children(node).trim() || h}](${h.replace(/\)/g, '%29')})`;
      }
      if (tag === 'table') {
        const rows = [...node.querySelectorAll('tr')].map(tr =>
          [...tr.querySelectorAll('th,td')].map(td => raw(td).trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>')));
        if (!rows.length) return '';
        const cols = Math.max(...rows.map(row => row.length));
        const line = items => '| ' + Array.from({ length: cols }, (_, i) => items[i] || '').join(' | ') + ' |\n';
        return '\n\n' + line(rows[0]) + line(Array(cols).fill('---')) + rows.slice(1).map(line).join('') + '\n';
      }
      return children(node);
    }
    return children(element).replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  }
  function units() {
    const modern = [...document.querySelectorAll('[data-content-search-unit-key]')]
      .filter(el => /:(user|assistant)$/.test(el.getAttribute('data-content-search-unit-key') || ''));
    if (modern.length) return modern.map(el => ({ el,
      role: el.getAttribute('data-content-search-unit-key').split(':').pop(),
      key: 'new:' + el.getAttribute('data-content-search-unit-key') }));
    const legacy = [...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')];
    if (legacy.length) return legacy.map(el => ({ el,
      role: el.getAttribute('data-message-author-role'),
      key: el.getAttribute('data-message-id') ? 'msg:' + el.getAttribute('data-message-id') : null }));
    return [...document.querySelectorAll('[data-turn-key]')]
      .filter(el => !el.parentElement?.closest('[data-turn-key]'))
      .map(el => ({ el, role: el.querySelector('[data-user-message-bubble="true"]') ? 'user' : 'assistant',
        key: 'turn:' + el.getAttribute('data-turn-key') }));
  }
  function readUnit(unit, allUnits) {
    const el = unit.el;
    const turn = el.closest('[data-testid^="conversation-turn-"], [data-turn-id], [data-turn-index]');
    const ordinalText = turn?.getAttribute('data-testid')?.match(/^conversation-turn-(\d+)$/)?.[1] ||
      turn?.getAttribute('data-turn-index') || null;
    const ordinal = ordinalText !== null && /^\d+$/.test(ordinalText) ? Number(ordinalText) : null;
    const sameTurn = turn ? allUnits.filter(u => turn.contains(u.el)) : [];
    const slot = sameTurn.findIndex(u => u.el === el);
    const stable = unit.key || (turn && (turn.getAttribute('data-turn-id') || ordinalText) ?
      `turn:${turn.getAttribute('data-turn-id') || ordinalText}:${unit.role}:${slot}` : null);
    let elements, format;
    if (unit.role === 'user') {
      elements = [el.querySelector('[data-testid="collapsible-user-message-content"], [data-user-message-bubble="true"], .whitespace-pre-wrap') || el];
      format = 'plain';
    } else {
      const contentSelectors = '.markdown, .prose, [data-testid="markdown-content"], [data-message-content]';
      elements = [...el.querySelectorAll(contentSelectors)]
        .filter(n => !n.parentElement?.closest(contentSelectors));
      if (!elements.length) elements = [el];
      format = 'markdown';
    }
    let text = elements.map(node => {
      if (unit.role === 'user' && (node.classList.contains('whitespace-pre-wrap') || node.hasAttribute('data-user-message-bubble'))) {
        return (node.innerText || node.textContent || '').replace(/\r\n?/g, '\n').trim();
      }
      return toMarkdown(node);
    }).filter(Boolean).join('\n\n').trim();
    if (unit.role === 'assistant') text = text.replace(/^ChatGPT said:\s*\n+/i, '');
    if (!text) return null;
    return { stable, ordinal, slot, message: {
      id: el.getAttribute('data-message-id') || null,
      role: unit.role, text, created_at: null,
      model: el.getAttribute('data-message-model-slug') || null,
      attachments: [], _format: format
    } };
  }
  function scrollArea() {
    const sample = units()[0]?.el;
    for (let el = sample?.parentElement; el; el = el.parentElement) {
      const styles = getComputedStyle(el);
      if (/(scroll|auto)/.test(styles.overflowY) && el.scrollHeight > el.clientHeight + 40) return el;
    }
    return document.scrollingElement || document.documentElement;
  }
  function fingerprint(text) {
    let hash = 2166136261;
    for (const char of text) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16);
  }
  async function pageChat(link) {
    if (current()?.url !== link.url) throw new Error('The selected chat must be open in this browser tab');
    for (let i = 0; i < 40 && !units().length; i++) await sleep(175);
    if (!units().length) throw new Error('No conversation messages are displayed');
    const area = scrollArea(), previous = area.scrollTop;
    const ordered = [], saved = new Map(), autoKeys = new Set();
    const orderInfo = new Set();
    let firstViewport = 0, lastViewport = 0, observedGaps = [];
    function collect() {
      const allUnits = units();
      const visible = allUnits.map(u => readUnit(u, allUnits)).filter(Boolean).map(x => ({
        ...x, key: x.stable || `fallback:${x.message.role}:${fingerprint(x.message.text)}`
      }));
      if (visible.length) { if (!firstViewport) firstViewport = visible.length; lastViewport = visible.length; }
      for (const item of visible) {
        if (!item.stable) autoKeys.add(item.key);
        if (item.ordinal !== null) orderInfo.add(item.ordinal);
        if (saved.has(item.key)) {
          const old = saved.get(item.key);
          if (item.message.text.length > old.message.text.length) old.message = item.message;
        }
      }
      for (let i = 0; i < visible.length; i++) {
        const item = visible[i];
        if (saved.has(item.key)) continue;
        let insertion = -1;
        for (let j = i - 1; j >= 0; j--) if (saved.has(visible[j].key)) {
          insertion = ordered.indexOf(saved.get(visible[j].key)) + 1;
          break;
        }
        if (insertion < 0) for (let j = i + 1; j < visible.length; j++) {
          if (saved.has(visible[j].key)) {
            insertion = ordered.indexOf(saved.get(visible[j].key)); break;
          }
        }
        if (insertion < 0) insertion = ordered.length;
        ordered.splice(insertion, 0, item);
        saved.set(item.key, item);
      }
      return visible.length;
    }
    try {
      let stableTop = 0, previousTopCount = -1;
      for (let i = 0; i < 1600 && stableTop < 12; i++) {
        check();
        area.scrollTop = Math.max(0, area.scrollTop - Math.max(250, area.clientHeight * .7));
        await sleep(115);
        if (area.scrollTop <= 2) {
          const n = units().length;
          if (n === previousTopCount) stableTop++; else stableTop = 0;
          previousTopCount = n;
        } else stableTop = 0;
        if (i % 50 === 0) status('Moving to the beginning of the conversation…');
      }
      collect();
      let stableBottom = 0, oldCount = saved.size;
      for (let i = 0; i < 6000 && stableBottom < 14; i++) {
        check();
        area.scrollTop += Math.max(200, area.clientHeight * .45);
        await sleep(125);
        collect();
        const atEnd = area.scrollTop >= area.scrollHeight - area.clientHeight - 4;
        if (atEnd && saved.size === oldCount) stableBottom++; else stableBottom = 0;
        oldCount = saved.size;
        if (i % 20 === 0) status(`Capturing conversation in reading order: ${saved.size} messages…`);
      }
      collect();
    } finally { area.scrollTop = previous; }
    if (!ordered.length) throw new Error('No readable messages were captured');
    const known = ordered.filter(x => x.ordinal !== null);
    if (known.length >= Math.ceil(ordered.length * .8)) ordered.sort((a, b) => {
      if (a.ordinal === null && b.ordinal === null) return 0;
      if (a.ordinal === null) return 1;
      if (b.ordinal === null) return -1;
      return a.ordinal - b.ordinal || a.slot - b.slot;
    });
    const numbers = [...orderInfo].sort((a, b) => a - b);
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] > numbers[i - 1] + 1) {
        observedGaps.push([numbers[i - 1] + 1, numbers[i] - 1]);
      }
    }
    const warnings = [
      'This is a rendered-page capture; the complete ChatGPT history cannot be verified from the page.',
    ];
    if (observedGaps.length) warnings.push('Missing turn indices were detected in the rendered DOM.');
    if (autoKeys.size) warnings.push(`${autoKeys.size} messages lacked stable DOM IDs and used text fingerprints.`);
    return {
      title: document.title.replace(/\s*[-–|]\s*ChatGPT.*$/i, '').trim() || 'ChatGPT conversation',
      url: link.url, exported_at: now(), source: 'rendered page',
      warning: warnings.join(' '), message_count: ordered.length,
      messages: ordered.map(x => x.message),
      verification: {
        completeness: 'UNVERIFIED — page may have unloaded messages',
        first_viewport_count: firstViewport, last_viewport_count: lastViewport,
        observed_turn_number_count: numbers.length,
        turn_index_range: numbers.length ? [numbers[0], numbers[numbers.length - 1]] : null,
        missing_turn_index_ranges: observedGaps,
        weak_identity_count: autoKeys.size
      }
    };
  }
  async function capture(link) {
    if (link.type === 'c') {
      try {
        status('Trying authenticated ChatGPT conversation API…');
        const result = await privateChat(link);
        if (!result.messages.length) throw new Error('API returned no readable messages');
        return result;
      } catch (error) {
        console.info('[ChatGPT Export] API unavailable; switching to browser page:', error);
      }
    }
    status('Reading the opened conversation from the page…');
    return pageChat(link);
  }

  function compactError(error) {
    const code = error?.status ? `HTTP ${error.status}` : '';
    return (code || String(error?.message || error || 'Unknown error')).slice(0, 180)
      .replace(/(sig|token|accessToken|password)=[^&\s]+/gi, '$1=[redacted]');
  }
  function trustedFileURL(raw) {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Unsafe download URL');
    const approved = u.origin === location.origin ||
      u.hostname === 'files.oaiusercontent.com' || u.hostname.endsWith('.oaiusercontent.com');
    if (!approved) throw new Error('Download host was not on the allowlist');
    return u;
  }
  function zipPathFor(att) {
    return `attachments/${att.file_id}--${basename(att.name)}`;
  }
  async function downloadAttachments(chat, include) {
    const added = [], unique = new Map();
    let totalBytes = 0;
    for (const [index, msg] of chat.messages.entries()) {
      for (const att of msg.attachments || []) {
        att.name = basename(att.name);
        att.file_id = fileId(att.file_id || att.id || att.asset_pointer);
        att.path = null;
        if (!include) { att.status = 'not_requested'; continue; }
        if (!att.file_id) { att.status = 'missing_file_id'; continue; }
        if (!unique.has(att.file_id)) unique.set(att.file_id, []);
        unique.get(att.file_id).push({ att, message_index: index + 1 });
      }
    }
    if (!include) return { added, files: [], totalBytes: 0 };
    const refs = [...unique];
    for (let i = 0; i < refs.length; i++) {
      check();
      const [id, usages] = refs[i], item = usages[0].att;
      status(`Downloading original files: ${i + 1}/${refs.length} — ${item.name}`);
      const update = (status, error = null, path = null, size = null) => {
        for (const ref of usages) {
          ref.att.status = status; ref.att.error = error;
          ref.att.path = path;
          if (size != null) ref.att.size_bytes = size;
        }
      };
      if (item.size_bytes != null && item.size_bytes > MAX_FILE_BYTES) {
        update('skipped_size_limit', 'File exceeds the 50 MiB limit'); continue;
      }
      try {
        const meta = await api(`/backend-api/files/download/${encodeURIComponent(id)}?conversation_id=${encodeURIComponent(links(chat.url)[0]?.id || '')}&inline=false`);
        if (!meta || typeof meta.download_url !== 'string') throw new Error('No download URL returned');
        const expected = Number(meta.file_size_bytes);
        if (Number.isFinite(expected) && expected > MAX_FILE_BYTES)
          throw new Error('File exceeds the 50 MiB limit');
        if (Number.isFinite(expected) && expected + totalBytes > MAX_TOTAL_BYTES)
          throw new Error('Total attachments exceed the 150 MiB limit');
        const url = trustedFileURL(meta.download_url);
        const response = await fetch(url.href, {
          credentials: url.origin === location.origin ? 'include' : 'omit',
          headers: { Accept: '*/*' }
        });
        if (!response.ok) throw new Error(`File download returned HTTP ${response.status}`);
        const stated = Number(response.headers.get('content-length'));
        if (Number.isFinite(stated) && stated > MAX_FILE_BYTES)
          throw new Error('File exceeds the 50 MiB limit');
        const content = new Uint8Array(await response.arrayBuffer());
        if (!content.length) throw new Error('Empty file received');
        if (content.length > MAX_FILE_BYTES || content.length + totalBytes > MAX_TOTAL_BYTES)
          throw new Error('File exceeds the configured size limits');
        if ((response.headers.get('content-type') || '').includes('text/html') &&
            /^\s*<!?doctype html|^\s*<html/i.test(new TextDecoder().decode(content.subarray(0, 160))))
          throw new Error('Received a login or HTML page, not file bytes');
        const path = zipPathFor(item);
        added.push({ name: path, data: content });
        totalBytes += content.length;
        update('included', null, path, content.length);
      } catch (error) {
        const reason = compactError(error);
        update(/limit/i.test(reason) ? 'skipped_size_limit' : 'failed', reason);
      }
      if (i < refs.length - 1) await sleep(150);
    }
    const files = chat.messages.flatMap((m, i) => (m.attachments || []).map(a => ({
      message_index: i + 1, name: a.name, file_id: a.file_id,
      path: a.path, size_bytes: a.size_bytes, status: a.status, error: a.error
    })));
    return { added, files, totalBytes };
  }
  function fileLink(path) {
    return path.split('/').map(encodeURIComponent).join('/');
  }
  function portableText(text, message, catalog, fileIndex) {
    const references = message.references || [];
    function linkForRef(ref, label) {
      const match = references.find(r => r.ref === ref || r.matched_text === ref) ||
        catalog.find(r => r.ref === ref);
      if (match?.url) return `[${label || match.title || 'Source'}](${match.url})`;
      catalog.unresolved.add(ref);
      return `[ChatGPT source: ${ref}; original URL unavailable]`;
    }
    let out = String(text || '');
    out = out.replace(/\uE200genui\uE202([\s\S]*?)\uE201/g, (_, payload) => {
      try {
        const parsed = JSON.parse(payload);
        const ref = parsed?.citation?.ref;
        if (ref) return linkForRef(String(ref), 'Source');
      } catch {}
      return '[ChatGPT interactive reference; not portable]';
    });
    out = out.replace(/\uE200(?:cite|filecite)\uE202([\s\S]*?)\uE201/g, (_, ids) =>
      ids.split('\uE202').filter(Boolean).map(id => linkForRef(id.trim(), 'Source')).join(' '));
    out = out.replace(/\uE200[^\uE201]*\uE201/g, '[ChatGPT-specific marker omitted]');
    for (const ref of references) {
      if (ref.url && ref.matched_text && out.includes(ref.matched_text))
        out = out.split(ref.matched_text).join(`[${ref.title || 'Source'}](${ref.url})`);
    }
    out = out.replace(/\[([^\]\n]+)\]\(sandbox:([^\s)]+)(?:\s+[^)]*)?\)/g, (_, label, path) => {
      let decoded = path.split('/').pop();
      try { decoded = decodeURIComponent(decoded); } catch {}
      const name = basename(decoded);
      const matching = fileIndex.filter(a => a.name === name && a.status === 'included');
      if (matching.length === 1) return `[${label}](${fileLink(matching[0].path)})`;
      return `${label} [ChatGPT-only file link; original bytes not included]`;
    });
    for (const att of message.attachments || []) {
      if (att.status === 'included' && att.path) {
        const plain = `[Attached file: ${att.name}]`;
        const linked = `[Attached file: ${att.name}](${fileLink(att.path)})`;
        out = out.split(plain).join(linked);
      }
    }
    return out;
  }
  function makePortable(chat, report) {
    const index = chat.messages.flatMap(m => m.attachments || []);
    const catalog = [];
    catalog.unresolved = new Set();
    for (const m of chat.messages) for (const r of m.references || []) {
      if (r.url && !catalog.some(entry => entry.url === r.url && entry.ref === r.ref)) catalog.push(r);
    }
    const result = { ...chat, messages: chat.messages.map(m => ({ ...m,
      text: portableText(m.text, m, catalog, index),
      attachments: m.attachments || [], references: m.references || []
    })) };
    const unresolved = [...catalog.unresolved].sort();
    const sources = ['# Portable source references', '',
      'Source links appear in the transcript where the API supplied public URLs.',
      'Internal ChatGPT source IDs without URLs cannot be reconstructed.', ''];
    for (const entry of catalog) sources.push(`- ${entry.title || entry.ref || 'Source'}: ${entry.url}`);
    if (unresolved.length) {
      sources.push('', '## Unresolved ChatGPT-only references', '');
      for (const ref of unresolved) sources.push(`- ${ref}`);
    }
    return { chat: result, sourceFile: sources.join('\n') + '\n', unresolved,
      resolved_count: catalog.length, attachments: report };
  }

  function renderConversation(chat) {
    const out = [`# ${chat.title}`, '',
      `- Source: ${chat.url}`, `- Exported: ${chat.exported_at}`,
      `- Capture: ${chat.source}`, `- Messages captured: ${chat.messages.length}`,
      ...(chat.warning ? [`- **WARNING:** ${chat.warning}`] : []), '', '---', ''];
    for (const [i, m] of chat.messages.entries()) {
      out.push(`## ${i + 1}. ${m.role === 'user' ? 'User' : 'Assistant'}`, '');
      const meta = [m.created_at, m.model && `model: ${m.model}`].filter(Boolean);
      if (meta.length) out.push(`*${meta.join(' | ')}*`, '');
      let body = m.text;
      if (m.role === 'user' && body.split('\n').length >= 6 &&
          /(?:^|\n)(?:\s*\$ |\s*# |.*(?:home|Traceback \(most recent|\[Trellis2\]|export [A-Z_]+=|\$PY\b))/.test(body) &&
          !body.startsWith('```')) {
        const fence = '`'.repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map(x => x[0].length + 1)));
        body = `${fence}text\n${body}\n${fence}`;
      }
      out.push(body, '', '---', '');
    }
    return out.join('\n');
  }
  function stripInternal(m) {
    const { _format, ...rest } = m;
    return rest;
  }
  function portable(chat) {
    return { ...chat, messages: chat.messages.map(stripInternal) };
  }
  function saveBlob(blob, filename) {
    const objectURL = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectURL; a.download = filename;
    (document.body || document.documentElement).appendChild(a);
    a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
  }
  const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
    let c = index;
    for (let n = 0; n < 8; n++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  });
  function crc32(data) {
    let crc = 0xffffffff;
    for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zipFiles(files) {
    const local = [], central = [], chunks = [];
    let offset = 0, centralSize = 0;
    for (const item of files) {
      const path = encoder.encode(item.name), data = item.data instanceof Uint8Array ? item.data :
        (item.data instanceof ArrayBuffer ? new Uint8Array(item.data) : encoder.encode(String(item.text || '')));
      if (path.length > 65535 || data.length > 0xffffffff) throw new Error('ZIP size limit exceeded');
      const crc = crc32(data);
      const localHeader = new Uint8Array(30 + path.length), h = new DataView(localHeader.buffer);
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true);
      h.setUint32(22, data.length, true); h.setUint16(26, path.length, true);
      localHeader.set(path, 30);
      local.push(localHeader, data);
      const centralHeader = new Uint8Array(46 + path.length), c = new DataView(centralHeader.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true);
      c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true); c.setUint16(28, path.length, true);
      c.setUint32(42, offset, true);
      centralHeader.set(path, 46);
      central.push(centralHeader);
      offset += localHeader.length + data.length;
      centralSize += centralHeader.length;
    }
    if (files.length > 65535 || offset > 0xffffffff || centralSize > 0xffffffff)
      throw new Error('ZIP is too large for ZIP32');
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
    return new Blob([...local, ...central, end], { type: 'application/zip' });
  }
  async function exportChat(chat, format, includeFiles = false) {
    check();
    const report = await downloadAttachments(chat, format === 'zip' && includeFiles);
    const result = makePortable(chat, report);
    const packed = result.chat;
    const base = fileName(chat.title) + '-' + (links(chat.url)[0]?.id || 'chat').slice(0, 8);
    const markdown = renderConversation(packed);
    const json = JSON.stringify(portable(packed), null, 2);
    const downloaded = report.files.filter(x => x.status === 'included').length;
    const manifest = {
      version: '1.6.0', generated_at: packed.exported_at,
      captured_message_count: packed.messages.length,
      source: packed.source, verification: packed.verification, warning: packed.warning || null,
      attachment_references: report.files.length, included_references: downloaded,
      unique_downloaded_files: report.added.length, attachment_bytes: report.totalBytes,
      attachments: report.files, resolved_source_urls: result.resolved_count,
      unresolved_chatgpt_source_ids: result.unresolved,
      limitation: 'Files without accessible IDs and temporary-download support cannot be included; no signed links are stored.'
    };
    if (format === 'zip') {
      const files = [
        { name: base + '.md', text: markdown },
        { name: base + '.json', text: json },
        { name: 'sources.md', text: result.sourceFile },
        { name: 'export-manifest.json', text: JSON.stringify(manifest, null, 2) },
        ...report.added
      ];
      saveBlob(zipFiles(files), base + '.zip');
    } else if (format === 'json') saveBlob(new Blob([json], { type: 'application/json' }), base + '.json');
    else if (format === 'txt') saveBlob(new Blob([packed.messages.map(m => `${m.role.toUpperCase()}:\n${m.text}`)
      .join('\n\n---\n\n')], { type: 'text/plain' }), base + '.txt');
    else saveBlob(new Blob([markdown], { type: 'text/markdown' }), base + '.md');
    return { downloaded: report.added.length, expected: [...new Set(report.files.map(a => a.file_id).filter(Boolean))].length,
      missing: report.files.filter(a => a.status !== 'included').length };
  }
  async function convertOfficial(file, targetId, format) {
    status('Reading ChatGPT JSON…');
    const parsed = JSON.parse(await file.text());
    const link = { id: targetId, url: `https://chatgpt.com/c/${targetId}`, type: 'c' };
    if (!Array.isArray(parsed) && Array.isArray(parsed.messages)) {
      const idInFile = links(parsed.url || '')[0]?.id;
      if (idInFile && idInFile !== targetId) throw new Error('Selected JSON belongs to a different chat');
      const messages = parsed.messages.filter(m => ['user','assistant'].includes(m?.role) && typeof m.text === 'string')
        .map(m => ({ ...m,
          text: m.role === 'assistant' ? m.text.replace(/^ChatGPT said:\s*\n+/i, '') : m.text,
          _format: 'markdown' }));
      const chat = { ...parsed, title: parsed.title || 'ChatGPT conversation',
        url: link.url, exported_at: now(),
        source: `repackaged JSON (${parsed.source || 'unknown source'})`,
        warning: parsed.warning || 'The original JSON may be incomplete; repackaging cannot restore missing messages.',
        message_count: messages.length, messages,
        verification: { completeness: 'UNVERIFIED — from previously exported JSON', original_source: parsed.source || 'unknown' } };
      if (!messages.length) throw new Error('No messages found in the selected JSON');
      await exportChat(chat, format, false);
      return `Repackaged ${chat.messages.length} existing JSON messages; missing chat history was not recovered.`;
    }
    const records = Array.isArray(parsed) ? parsed : parsed.conversations;
    if (!Array.isArray(records)) throw new Error('Select a conversation JSON or conversations.json from the official ChatGPT export');
    const selected = records.find(x => x.conversation_id === targetId || x.id === targetId);
    if (!selected) throw new Error(`Chat ${targetId} not found in the official export`);
    const chat = normalize(selected, link, 'official ChatGPT account export');
    if (!chat.messages.length) throw new Error('The selected official conversation contained no readable messages');
    await exportChat(chat, format, false);
    return `Exported ${chat.messages.length} messages from the official account data (original binaries not available from the JSON alone).`;
  }

  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'all:initial!important;position:fixed!important;right:14px!important;bottom:14px!important;z-index:2147483647!important;display:block!important;visibility:visible!important;max-width:calc(100vw - 24px)!important';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
  <style>
    :host{color-scheme:dark}*{box-sizing:border-box}
    .panel{font:12px/1.5 system-ui,sans-serif;width:322px;max-width:calc(100vw - 24px);padding:12px;
      color:#f9fafb;background:#18181b;border:1px solid #52525b;border-radius:12px;box-shadow:0 12px 38px #0009}
    .head,.row{display:flex;align-items:center;justify-content:space-between;gap:7px}
    .head{margin-bottom:8px}.head strong{font-size:14px}
    button,input,select,textarea{font:inherit;color:inherit;border:1px solid #52525b;border-radius:7px;background:#27272a;padding:7px}
    button{cursor:pointer}button:hover{background:#404047}button:disabled{opacity:.5;cursor:wait}
    textarea{resize:vertical;width:100%;min-height:54px;max-height:180px}
    .row{margin:7px 0}.row>*{flex:1;min-width:0}
    .primary{background:#166534;border-color:#15803d}.primary:hover{background:#15803d}
    .label{color:#c4c4cc;font-size:11px;margin:8px 0 3px}
    #status{margin:9px 0 4px;color:#cbd5e1;max-height:110px;overflow:auto;overflow-wrap:anywhere}
    #main[hidden],#stop[hidden]{display:none!important}#stop{width:100%;color:#fecaca}
    .hint{font-size:10px;color:#a1a1aa}
  </style>
  <div class="panel">
    <div class="head"><strong>ChatGPT → AI Export v1.6</strong><button id="fold" title="Minimize / expand">−</button></div>
    <div id="main">
      <div class="label">Target conversation URL (accepts /c/ or /share/)</div>
      <textarea id="url" spellcheck="false"></textarea>
      <div class="row">
        <select id="format"><option value="zip">ZIP · Markdown + JSON + Files</option><option value="md">Markdown only</option><option value="json">JSON only</option><option value="txt">Plain text</option></select>
        <button id="go" class="primary">Export URL</button>
      </div>
      <div class="row"><label style="font-size:11px"><input type="checkbox" id="with-files" checked style="vertical-align:middle"> Include original attachments in ZIP (50 MiB/file; 150 MiB total)</label></div>
      <div class="row"><button id="open">Export current page</button></div>
      <div class="label">Import official conversations.json or an earlier exported JSON</div>
      <div class="row"><button id="official">Import JSON for this chat</button></div>
      <input id="file" type="file" accept=".json,application/json" hidden>
      <button id="stop" hidden>Cancel</button>
      <div id="status" role="status" aria-live="polite">Ready. ZIP can include attachment binaries and portable source references.</div>
      <div class="hint">Files download only from permitted ChatGPT/OpenAI hosts. Failures are listed in export-manifest.json.</div>
    </div>
  </div>`;
  const $ = id => shadow.getElementById(id);
  const status = text => { $('status').textContent = String(text); };
  $('url').value = current()?.url || DEFAULT;
  let changedURL = false;
  $('url').addEventListener('input', () => { changedURL = true; });
  async function job(fn) {
    if (busy) return;
    busy = true; cancel = false; $('stop').hidden = false;
    shadow.querySelectorAll('button:not(#stop):not(#fold),input,select,textarea').forEach(x => x.disabled = true);
    try { status(await fn()); }
    catch (error) { console.warn('[ChatGPT Export]', error); status('Error: ' + error.message); }
    finally {
      busy = false; token = null; $('stop').hidden = true;
      shadow.querySelectorAll('button,input,select,textarea').forEach(x => x.disabled = false);
    }
  }
  const doExport = async (link, format, withFiles) => {
    const chat = await capture(link);
    const fileReport = await exportChat(chat, format, withFiles);
    return `Saved ${chat.messages.length} messages (${chat.source}). Included ${fileReport.downloaded}/${fileReport.expected} identifiable files.` +
      (fileReport.missing ? ` ${fileReport.missing} attachment references not embedded; see manifest.` : '') +
      (chat.warning ? ' Completeness UNVERIFIED.' : '');
  };
  $('go').addEventListener('click', () => {
    const link = links($('url').value)[0];
    if (!link) { status('Paste a valid ChatGPT /c/ or /share/ URL.'); return; }
    const format = $('format').value, withFiles = $('with-files').checked;
    if (current()?.url === link.url) { job(() => doExport(link, format, withFiles)); return; }
    try { sessionStorage.setItem(KEY, JSON.stringify({ link, format, withFiles, time: Date.now() })); }
    catch { status('Session storage unavailable. Manually open that chat and click Export current page.'); return; }
    location.assign(link.url);
  });
  $('open').addEventListener('click', () => {
    const link = current();
    if (!link) { status('Open a chat first.'); return; }
    job(() => doExport(link, $('format').value, $('with-files').checked));
  });
  $('official').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const link = links($('url').value)[0];
    if (!link || link.type !== 'c') { status('Enter the original /c/ link before importing official data.'); return; }
    job(() => convertOfficial(file, link.id, $('format').value));
  });
  $('stop').addEventListener('click', () => { cancel = true; status('Stopping the export…'); });
  $('fold').addEventListener('click', () => {
    $('main').hidden = !$('main').hidden;
    $('fold').textContent = $('main').hidden ? '+' : '−';
  });
  let last = location.href, watchedBody = null;
  const observer = new MutationObserver(mount);
  observer.observe(document, { childList: true });
  if (document.documentElement) observer.observe(document.documentElement, { childList: true });
  function mount() {
    if (!document.body) return;
    if (watchedBody !== document.body) {
      watchedBody = document.body;
      observer.observe(watchedBody, { childList: true });
    }
    if (host.parentNode !== document.body) document.body.appendChild(host);
    if (location.href !== last) {
      last = location.href;
      if (!changedURL && current()) $('url').value = current().url;
    }
  }
  mount(); setInterval(mount, 1500);
  window.addEventListener('pageshow', mount);
  window.addEventListener('popstate', mount);
  (async () => {
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch {}
    if (!pending || pending.link?.url !== current()?.url) return;
    sessionStorage.removeItem(KEY);
    if (Date.now() - pending.time > 120000) return;
    await sleep(700);
    job(() => doExport(pending.link, pending.format, !!pending.withFiles));
  })();
})();

