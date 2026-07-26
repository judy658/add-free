const $ = (sel) => document.querySelector(sel);

const els = {
  urlInput: $('#urlInput'),
  loadBtn: $('#loadBtn'),
  historyList: $('#historyList'),
  historyEmpty: $('#historyEmpty'),
  clearHistoryBtn: $('#clearHistoryBtn'),
  nowPlayingTitle: $('#nowPlayingTitle'),
  videoFrame: $('#videoFrame'),
  theaterBtn: $('#theaterBtn'),
  playPauseBtn: $('#playPauseBtn'),
  muteBtn: $('#muteBtn'),
  volumeRange: $('#volumeRange'),
  volumeValue: $('#volumeValue'),
  fullscreenBtn: $('#fullscreenBtn'),
  videoWrap: $('#videoWrap'),
  altStreamBtn: $('#altStreamBtn'),
  embedError: $('#embedError'),
  settingsBtn: $('#settingsBtn'),
  settingsModal: $('#settingsModal'),
  settingsCloseBtn: $('#settingsCloseBtn'),
  ytApiKeyInput: $('#ytApiKeyInput'),
  ytApiKeySaveBtn: $('#ytApiKeySaveBtn'),
  ytApiKeyClearBtn: $('#ytApiKeyClearBtn'),
  ytApiKeyStatus: $('#ytApiKeyStatus'),
};


const STORAGE_KEY = 'stream-companion.history.v1';
const MAX_HISTORY = 12;

const STORAGE_YT_API_KEY = 'stream-companion.yt-api-key.v1';

// TEMP: Hardcoded API keys (until Settings modal works).
// NOTE: Putting API keys in frontend code is insecure; use backend/proxy for real deployments.
const HARD_CODED_YT_API_KEYS = [
  'AIzaSyASNRMcGO-xxHDfmGgsIya-AAbmNA275tU',
  'AIzaSyBGjtox-vkXV5WIMe_RwNlvOUViUoXOAqA',
  'AIzaSyDZH6HFXRDITnFY7nIaaCHnpH2wX334iq0',
  'AIzaSyDZS4WN-h_lF2-10OuvmdOlaMgpPAFJaaI',
  'AIzaSyBFA4R4gR0yRoWtclz-5FDP5qNWtVQ4pCE',
];

// For Invidious keyword search fallback.
const INVIDIOUS_SEARCH_INSTANCES = [
  'https://yewtu.be',
  'https://invidious.drgns.space',
  'https://vid.puffyan.us',
  'https://invidious.snopyta.org',
];

let playerState = {
  current: null, // { id, title?, provider }
  theater: false,
  volume: 100,
  muted: false,
  // iframe mode: 'youtube-nocookie' | 'invidious' | 'youtube-api'
  mode: 'youtube-nocookie',
  // selected invidious instance base url for embed/search
  invidiousInstance: 'https://yewtu.be',
};

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeToVideoId(input) {
  // Accept:
  // - https://www.youtube.com/watch?v=VIDEO_ID
  // - https://youtu.be/VIDEO_ID
  // - https://www.youtube.com/embed/VIDEO_ID
  // - VIDEO_ID directly (11 chars typical, but we allow a broader safe pattern)
  const raw = String(input || '').trim();
  if (!raw) return null;

  // Direct ID attempt
  const directMatch = raw.match(/^[a-zA-Z0-9_-]{6,20}$/);
  if (directMatch && !raw.includes('http') && !raw.includes('youtube')) {
    return raw;
  }

  // URL-based parsing
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id || null;
    }

    if (host.endsWith('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return v;

      // /embed/VIDEO_ID or /v/VIDEO_ID
      const parts = url.pathname.split('/').filter(Boolean);
      const embedIdx = parts.indexOf('embed');
      if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1];

      const vIdx = parts.indexOf('v');
      if (vIdx >= 0 && parts[vIdx + 1]) return parts[vIdx + 1];

      return null;
    }
  } catch {
    // Might be plain ID
  }

  // Fallback: extract v=... from query text
  const m = raw.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function titleFromInput(input, id) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return id;
  if (trimmed.includes('watch') || trimmed.includes('youtu.be') || trimmed.includes('youtube')) {
    return id;
  }
  return trimmed.length > 32 ? id : trimmed;
}

function buildNoCookieEmbedUrl(videoId) {
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    modestbranding: '1',
  });
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params}`;
}

function buildInvidiousEmbedUrl(videoId, instanceUrl) {
  const base = String(instanceUrl || 'https://yewtu.be').replace(/\/$/, '');
  const params = new URLSearchParams({
    autoplay: '1',
    local: '1',
  });
  return `${base}/embed/${encodeURIComponent(videoId)}?${params}`;
}

function formatDurationSeconds(seconds) {
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

function loadHistory() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const list = safeJsonParse(raw, []);
  if (!Array.isArray(list)) return [];
  return list.filter(Boolean);
}

function saveHistory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
}

function renderHistory() {
  const items = loadHistory();
  els.historyList.innerHTML = '';

  if (!items.length) {
    els.historyEmpty.hidden = false;
    return;
  }

  els.historyEmpty.hidden = true;

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'history-item';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.videoId = item.id;
    btn.dataset.mode = item.mode;

    const title = item.title || item.id;

    // Eğer author/title yanlışlıkla video id gibi görünüyorsa, sadece title’ı göster.
    // (Çünkü bazı durumlarda title boş/yanlış olabilir.)
    const authorPart = item.author && item.author !== item.id ? item.author : '';
    const author = authorPart ? ` • ${escapeHtml(authorPart)}` : '';

    btn.innerHTML = `
      <div class="history-item__meta">
        <div class="history-item__title">${escapeHtml(title)}${author}</div>
      </div>
    `;

    li.appendChild(btn);
    els.historyList.appendChild(li);
  }
}

function persistWatched(id, title, mode, author) {
  const items = loadHistory();
  const entry = { id, title, author, mode, watchedAt: Date.now() };
  const filtered = items.filter((x) => x.id !== id);
  filtered.unshift(entry);
  saveHistory(filtered);
}

function setNowPlaying(title) {
  els.nowPlayingTitle.textContent = title || '—';
}

function setTheaterMode(on) {
  playerState.theater = on;
  document.body.classList.toggle('theater', on);
  els.theaterBtn.setAttribute('aria-pressed', String(on));
  els.theaterBtn.textContent = on ? 'Exit Theater Mode' : 'Theater Mode';
}

function applyVolumeToPlayerUiOnly() {
  els.volumeValue.textContent = String(playerState.volume);
}

function updatePlayPauseUi(isPlaying) {
  els.playPauseBtn.textContent = isPlaying ? '⏸' : '⏯';
}

function showEmbedError(show) {
  els.embedError.hidden = !show;
}

function loadVideo({ videoId, mode, inputTitle }) {
  if (!videoId) return;

  const title = inputTitle || titleFromInput(els.urlInput.value, videoId);
  playerState.current = { id: videoId, title, mode };
  playerState.mode = mode;

  setNowPlaying(title);
  showEmbedError(false);

  const src =
    mode === 'youtube-nocookie'
      ? buildNoCookieEmbedUrl(videoId)
      : buildInvidiousEmbedUrl(videoId, playerState.invidiousInstance);

  els.videoFrame.setAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-presentation allow-forms allow-pointer-lock allow-popups'
  );
  els.videoFrame.src = src;

  // Save basic entry immediately.
  persistWatched(videoId, title, mode, playerState.current?.author);
  renderHistory();

  // If title looks like a raw ID (e.g. user pasted a URL), try to enrich it via Invidious.
  if (title === videoId) {
    (async () => {
      try {
        const res = await fetchInvidiousSearchResults({ q: videoId });
        const match = (res.items || []).find((x) => x.videoId === videoId);
        if (!match) return;

        playerState.current.title = match.title || videoId;
        playerState.current.author = match.author || '';

        persistWatched(videoId, playerState.current.title, mode, playerState.current.author);
        renderHistory();
        setNowPlaying(playerState.current.title);
      } catch {
        // ignore
      }
    })();
  }

  updatePlayPauseUi(true);
}

async function toggleFullscreen() {
  const doc = document;
  const frame = els.videoFrame || $('#videoFrame');

  try {
    if (!doc.fullscreenElement) {
      await frame.requestFullscreen();
    } else {
      await doc.exitFullscreen();
    }
  } catch {
    // ignore
  }
}

function looksLikeDirectVideoInput(raw) {
  const t = String(raw || '').trim();
  if (!t) return false;
  const hasHttp = t.includes('http://') || t.includes('https://');
  const hasYoutube = t.includes('youtube') || t.includes('youtu.be');
  const id = normalizeToVideoId(t);

  if (hasHttp && hasYoutube) return !!id;
  if (!hasHttp && !hasYoutube && !t.includes(' ') && id) return true;
  return false;
}

function ensureSearchUi() {
  const app = $('#app');
  const topbar = $('.topbar');
  if (!app || !topbar) return;

  let wrap = $('#searchResultsWrap');
  if (wrap) return;

  wrap = document.createElement('div');
  wrap.id = 'searchResultsWrap';
  wrap.className = 'search-results-wrap';
  wrap.hidden = true;

  wrap.innerHTML = `
    <div id="searchResultsStatus" class="search-status" aria-live="polite">
      <div id="searchSpinner" class="search-spinner" hidden></div>
      <div id="searchStatusText" class="search-status__text"></div>
    </div>
    <div id="searchResultsGrid" class="search-grid" role="list"></div>
  `;

  topbar.insertAdjacentElement('afterend', wrap);

  if (!document.getElementById('search-results-css')) {
    const style = document.createElement('style');
    style.id = 'search-results-css';
    style.textContent = `
      .search-results-wrap{ padding: 0 16px 10px; }
      .search-status{ display:flex; align-items:center; gap:12px; padding: 10px 0; color: var(--muted); }
      .search-status__text{ font-size: 13px; }
      .search-spinner{ width:18px; height:18px; border-radius:50%; border:2px solid rgba(255,255,255,0.2); border-top-color: rgba(255,77,77,0.8); animation: sc-spin 700ms linear infinite; }
      @keyframes sc-spin{ to{ transform: rotate(360deg);} }
      .search-grid{ display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      @media (max-width: 980px){ .search-grid{ grid-template-columns: repeat(2, minmax(0,1fr)); } }
      @media (max-width: 640px){ .search-results-wrap{ padding: 0 12px 10px; } .search-grid{ grid-template-columns: 1fr; } }
      .search-card{ border: 1px solid var(--border); background: rgba(255,255,255,0.02); border-radius: 14px; overflow:hidden; cursor:pointer; color: var(--text); display:flex; gap: 12px; padding: 10px; }
      .search-card:hover{ border-color: rgba(255,255,255,0.22); }
      .search-card__thumb{ width: 160px; min-width: 160px; height: 90px; background: #000; border-radius: 10px; object-fit: cover; }
      @media (max-width: 640px){ .search-card{ gap:10px;} .search-card__thumb{ width: 110px; min-width:110px; height: 62px;} }
      .search-card__meta{ display:flex; flex-direction: column; gap:6px; min-width:0; }
      .search-card__title{ font-weight:800; font-size: 13px; line-height:1.25; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .search-card__sub{ font-size: 12px; color: var(--muted); display:flex; gap:8px; flex-wrap:wrap; }
    `;
    document.head.appendChild(style);
  }
}

function setSearchResultsVisible(on) {
  const wrap = $('#searchResultsWrap');
  if (!wrap) return;
  wrap.hidden = !on;
}

function setSearchLoading(on, text) {
  const spinner = $('#searchSpinner');
  const statusText = $('#searchStatusText');
  if (spinner) spinner.hidden = !on;
  if (statusText) statusText.textContent = text || (on ? 'Loading…' : '');
}

function getYouTubeApiKey() {
  // Prefer user-saved key
  const v = localStorage.getItem(STORAGE_YT_API_KEY);
  const saved = v ? String(v).trim() : '';
  if (saved) return saved;

  // TEMP fallback to hardcoded keys
  return HARD_CODED_YT_API_KEYS[0] || '';
}

function openSettingsModal() {
  if (!els.settingsModal) return;
  els.settingsModal.hidden = false;
  els.settingsModal.style.display = 'flex';
  els.settingsModal.setAttribute('aria-hidden', 'false');
  els.settingsModal.classList.add('open');
}

function closeSettingsModal() {
  if (!els.settingsModal) return;
  els.settingsModal.hidden = true;
  els.settingsModal.style.display = 'none';
  els.settingsModal.setAttribute('aria-hidden', 'true');
  els.settingsModal.classList.remove('open');
}

function initSettingsUi() {
  if (!els.settingsBtn || !els.settingsModal) return;

  // Inject minimal modal CSS (since index.html is standalone).
  if (!document.getElementById('settings-modal-css')) {
    const style = document.createElement('style');
    style.id = 'settings-modal-css';
    style.textContent = `
      .modal{ position: fixed; inset: 0; z-index: 1000; display:flex; align-items:center; justify-content:center; }
      .modal[hidden]{ display:none; }
      .modal__backdrop{ position:absolute; inset:0; background: rgba(0,0,0,0.65); }
      .modal__panel{ position: relative; width: min(560px, calc(100vw - 28px)); background: rgba(15,15,20,0.92); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow); padding: 14px; }
      .modal__header{ display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; }
      .modal__title{ font-weight: 900; font-size: 16px; }
      .modal__body{ padding: 6px 2px 2px; }
      .field{ display:flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
      .field__label{ font-size: 13px; color: var(--text); font-weight: 700; }
      .field input{ width: 100%; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--border); background: rgba(255,255,255,0.03); color: var(--text); outline:none; }
      .field input:focus{ border-color: rgba(255, 77, 77, 0.6); box-shadow: 0 0 0 4px var(--focus); }
      .field__help{ color: var(--muted); font-size: 12px; }
      .modal__actions{ display:flex; gap: 10px; justify-content:flex-end; }
    `;
    document.head.appendChild(style);
  }

  // init modal hidden state
  els.settingsModal.hidden = true;

  const loadKey = () => {
    const key = getYouTubeApiKey();
    els.ytApiKeyInput.value = key;
    els.ytApiKeyStatus.textContent = key ? 'API key loaded.' : 'No API key saved.';
  };
  loadKey();

  els.settingsBtn.addEventListener('click', () => {
    loadKey();
    openSettingsModal();
  });

  els.settingsCloseBtn?.addEventListener('click', closeSettingsModal);

  els.settingsModal.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-close') === 'true') closeSettingsModal();
  });

  els.ytApiKeySaveBtn.addEventListener('click', () => {
    const key = String(els.ytApiKeyInput.value || '').trim();
    if (!key || key.length < 10) {
      els.ytApiKeyStatus.textContent = 'Please paste a valid API key.';
      return;
    }
    localStorage.setItem(STORAGE_YT_API_KEY, key);
    els.ytApiKeyStatus.textContent = 'Saved. YouTube official search enabled.';
  });

  els.ytApiKeyClearBtn.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_YT_API_KEY);
    els.ytApiKeyInput.value = '';
    els.ytApiKeyStatus.textContent = 'Cleared.';
  });
}

function normalizeInvidiousSearchItem(item) {
  if (!item) return null;

  const videoId =
    item.videoId ||
    item.video_id ||
    item.id ||
    item.video?.videoId ||
    item.video?.video_id ||
    null;

  if (!videoId) return null;

  const title = item.title || item.video?.title || videoId;
  const author =
    item.author?.name || item.uploader || item.author || item.channel?.name || '';

  const viewCount = item.viewCount || item.views || item.statistics?.viewCount || null;
  const lengthSeconds =
    item.lengthSeconds || item.length_seconds || item.durationSeconds || item.length?.seconds || null;

  const published = item.published || null;

  return {
    videoId,
    title,
    author,
    viewCount,
    lengthSeconds,
    published,
  };
}

async function fetchInvidiousSearchResults({ q }) {
  const query = String(q || '').trim();
  if (!query) return { items: [], instance: null };

  let lastErr;

  for (const base of INVIDIOUS_SEARCH_INSTANCES) {
    const instance = String(base).replace(/\/$/, '');
    try {
      const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) throw new Error(`Invidious search failed: ${res.status}`);

      const data = await res.json();
      const rawItems = Array.isArray(data) ? data : data?.items || data?.videos || [];

      const items = rawItems.map(normalizeInvidiousSearchItem).filter(Boolean);
      return { items, instance };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('No Invidious search instance available');
}

function normalizeYouTubeDataSearchItem(item) {
  const videoId = item?.id?.videoId;
  if (!videoId) return null;

  const title = item?.snippet?.title || videoId;
  const channelTitle = item?.snippet?.channelTitle || '';

  return {
    videoId,
    title,
    author: channelTitle,
    viewCount: null,
    lengthSeconds: null,
    provider: 'google',
  };
}

function parseISO8601DurationToSeconds(duration) {
  // Basic ISO8601 duration like PT1H2M3S
  if (!duration || typeof duration !== 'string') return null;
  const m = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const mm = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  const total = h * 3600 + mm * 60 + s;
  return Number.isFinite(total) && total > 0 ? total : null;
}

async function enrichGoogleVideosDetails(items, apiKey) {
  const ids = items.map((x) => x.videoId).filter(Boolean);
  if (!ids.length) return items;

  const uniqueIds = [...new Set(ids)];

  // videos.list supports up to 50 ids per call
  const batches = [];
  for (let i = 0; i < uniqueIds.length; i += 50) {
    batches.push(uniqueIds.slice(i, i + 50));
  }

  const map = new Map();

  for (const batch of batches) {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'contentDetails,statistics');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) continue;

    const data = await res.json();
    const vitems = Array.isArray(data?.items) ? data.items : [];

    for (const v of vitems) {
      const id = v?.id;
      if (!id) continue;
      const duration = parseISO8601DurationToSeconds(v?.contentDetails?.duration);
      const viewCount = v?.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null;
      map.set(id, { duration, viewCount });
    }
  }

  return items.map((it) => {
    const extra = map.get(it.videoId);
    if (!extra) return it;
    return {
      ...it,
      lengthSeconds: extra.duration ?? it.lengthSeconds,
      viewCount: extra.viewCount ?? it.viewCount,
    };
  });
}

async function fetchYouTubeDataSearchResults({ q, apiKey, pageToken }) {
  const query = String(q || '').trim();
  if (!query) return { items: [], instance: 'google', nextPageToken: null };
  if (!apiKey) throw new Error('Missing YouTube API key');

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('maxResults', '50');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('safeSearch', 'none');
  if (pageToken) url.searchParams.set('pageToken', pageToken);

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`YouTube search failed: ${res.status} ${txt}`);
  }

  const data = await res.json();
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items = rawItems.map(normalizeYouTubeDataSearchItem).filter(Boolean);
  const nextPageToken = data?.nextPageToken || null;

  return { items, instance: 'google', nextPageToken };
}

async function paginateGoogleSearchResults({ q, apiKey, baseItems }) {
  const all = [];
  const seen = new Set();

  // seed
  let seed = baseItems || [];
  for (const it of seed) {
    if (!it?.videoId || seen.has(it.videoId)) continue;
    seen.add(it.videoId);
    all.push(it);
  }

  let pageToken = null;
  try {
    // We need nextPageToken; fetch again for token is expensive.
    // Instead: do a small loop by querying until no token.
    // We'll call the search endpoint repeatedly and rely on response token.
    // Start by fetching first page token using current seed request.
  } catch {
    // ignore
  }

  // Better approach: do loop with an initial call.
  let page = await fetchYouTubeDataSearchResults({ q, apiKey, pageToken: null });
  // merge page items
  for (const it of page.items) {
    if (!it?.videoId || seen.has(it.videoId)) continue;
    seen.add(it.videoId);
    all.push(it);
  }

  pageToken = page.nextPageToken;

  // Show "as many as API returns" until no nextPageToken.
  // To avoid infinite loops/quota blowups, cap to 500 results.
  const MAX_TOTAL = 500;
  while (pageToken && all.length < MAX_TOTAL) {
    page = await fetchYouTubeDataSearchResults({ q, apiKey, pageToken });
    for (const it of page.items) {
      if (!it?.videoId || seen.has(it.videoId)) continue;
      seen.add(it.videoId);
      all.push(it);
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }

  // Enrich with duration + viewCount for better UI.
  try {
    return await enrichGoogleVideosDetails(all, apiKey);
  } catch {
    return all;
  }
}

async function fetchSearchResults({ q }) {
  const apiKey = getYouTubeApiKey();

  if (apiKey) {
    try {
      const base = await fetchYouTubeDataSearchResults({ q, apiKey });

      // IMPORTANT: YouTube search returns a limited set per page (maxResults).
      // But we can paginate with nextPageToken to show as many as API returns.
      // Since you asked to show all results, we paginate until nextPageToken is missing.
      // Note: quota/rate limits may apply.
      const allItems = await paginateGoogleSearchResults({ q, apiKey, baseItems: base.items });
      return { items: allItems, instance: 'google' };
    } catch {
      // Fall back to Invidious.
    }
  }

  return await fetchInvidiousSearchResults({ q });
}

function renderSearchResults(items) {
  const grid = $('#searchResultsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!items?.length) {
    grid.innerHTML = `<div class="muted" style="grid-column: 1 / -1; padding: 8px 0;">No results.</div>`;
    return;
  }

  for (const item of items) {
    const videoId = item.videoId;
    const thumbUrl = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;

    const duration = formatDurationSeconds(item.lengthSeconds);
    const viewsText =
      item.viewCount != null
        ? `${String(item.viewCount).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} views`
        : '';

    const sub = [item.author ? item.author : null, viewsText || (duration ? duration : null)].filter(Boolean);

    const card = document.createElement('div');
    card.className = 'search-card';
    card.role = 'listitem';
    card.tabIndex = 0;

    card.innerHTML = `
      <img class="search-card__thumb" src="${thumbUrl}" alt="" loading="lazy" />
      <div class="search-card__meta">
        <div class="search-card__title">${escapeHtml(item.title || videoId)}</div>
        <div class="search-card__sub">${sub.map(escapeHtml).join(' • ')}</div>
      </div>
    `;

    const onPick = () => {
      // BIG FIX: Use the same loading mode as the rest of the app by default.
      // (Earlier it tried invidious embed; with CORS issues or instance problems it may not load.)
      loadVideo({
        videoId,
        mode: 'youtube-nocookie',
        inputTitle: item.title || videoId,
      });
      els.videoWrap?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    card.addEventListener('click', onPick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPick();
      }
    });

    grid.appendChild(card);
  }
}

async function runSearchFromInput() {
  ensureSearchUi();

  const raw = els.urlInput.value;
  const query = String(raw || '').trim();
  if (!query) {
    setSearchResultsVisible(false);
    return;
  }

  if (looksLikeDirectVideoInput(query)) {
    const id = normalizeToVideoId(query);
    if (!id) return;
    loadVideo({ videoId: id, mode: 'youtube-nocookie', inputTitle: titleFromInput(query, id) });
    setSearchResultsVisible(false);
    return;
  }

  setSearchResultsVisible(true);
  setSearchLoading(true, 'Searching…');

  try {
    const { items, instance } = await fetchSearchResults({ q: query });
    if (instance && instance !== 'google') playerState.invidiousInstance = instance;
    renderSearchResults(items);
    setSearchLoading(false);
  } catch {
    renderSearchResults([]);
    setSearchLoading(false, 'Search failed. Try again.');
  }
}

function init() {
  ensureSearchUi();
  initSettingsUi();

  els.theaterBtn.addEventListener('click', () => setTheaterMode(!playerState.theater));

  async function submitFromInput() {
    const raw = els.urlInput.value;
    const id = normalizeToVideoId(raw);

    if (!id) {
      await runSearchFromInput();
      return;
    }

    if (looksLikeDirectVideoInput(raw)) {
      loadVideo({ videoId: id, mode: 'youtube-nocookie', inputTitle: titleFromInput(raw, id) });
      setSearchResultsVisible(false);
      return;
    }

    await runSearchFromInput();
  }

  els.loadBtn.addEventListener('click', submitFromInput);
  els.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitFromInput();
  });


  els.historyList.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const videoId = btn.dataset.videoId;
    const mode = btn.dataset.mode || 'youtube-nocookie';

    loadVideo({
      videoId,
      mode,
      inputTitle: btn.querySelector('.history-item__title')?.textContent?.trim() || videoId,
    });
    setSearchResultsVisible(false);
  });

  els.clearHistoryBtn.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    renderHistory();
  });

  els.altStreamBtn.addEventListener('click', () => {
    if (!playerState.current?.id) return;
    loadVideo({
      videoId: playerState.current.id,
      mode: 'invidious',
      inputTitle: playerState.current.title,
    });
  });

  els.playPauseBtn.addEventListener('click', () => {
    const isPlaying = els.playPauseBtn.textContent === '⏸';
    updatePlayPauseUi(!isPlaying);
  });

  els.muteBtn.addEventListener('click', () => {
    playerState.muted = !playerState.muted;
    els.muteBtn.textContent = playerState.muted ? '🔇' : '🔊';
  });

  els.volumeRange.addEventListener('input', () => {
    playerState.volume = Number(els.volumeRange.value);
    applyVolumeToPlayerUiOnly();
  });

  els.fullscreenBtn.addEventListener('click', toggleFullscreen);

  els.videoFrame.addEventListener('load', () => showEmbedError(false));

  applyVolumeToPlayerUiOnly();
  renderHistory();
  els.nowPlayingTitle.textContent = 'Paste a YouTube URL or ID to begin';
  setSearchResultsVisible(false);
}

init();
