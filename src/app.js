import * as Sync from '../../shared/v1/sync.js';

const APP = Object.freeze({
  namespace: 'trace',
  owner: 'jennie-verse',
  repo: 'webapp-data',
  branch: 'main',
  tokenKey: 'sync.token.v1',
  cacheKey: 'trace.cache.v1',
  localKey: 'trace.local.v1',
  settingsKey: 'trace.settings.v1',
  memoBasePath: 'trace/memo.json',
  debounceMs: 4000,
  fontSizes: [6, 8, 10, 12, 14, 17]
});

/* ── events 파서용 상수 ─────────────────────────────────────────────────
   events/ 는 한 단계 평면 폴더입니다. 파일 이름은 <app>.<ctx>.YYYY-MM.json
   한 가지뿐이고, 여기에 맞지 않는 항목(.gitkeep 등)은 전부 무시합니다.

   읽는 범위를 최근 3개월로 묶어 둡니다. 이벤트 파일은 앱 × 컨텍스트 × 달마다
   하나씩 생기므로 제한이 없으면 새로고침 한 번에 요청이 수백 회로 늘어납니다.
   그보다 오래된 날을 열면 그날의 이벤트는 비어 보입니다.
   ────────────────────────────────────────────────────────────────────── */
const EVENT_FILE_PATTERN = /^([a-z][a-z0-9-]*)\.([a-z0-9-]+)\.(\d{4}-\d{2})\.json$/;
const EVENT_APP_PATTERN = /^[a-z][a-z0-9-]{0,15}$/;
const EVENT_MONTHS_WINDOW = 3;

const elements = {};

const state = {
  selectedDate: localDateKey(new Date()),
  // 파서 이름별 항목 목록입니다. PARSERS 의 키와 같은 이름을 씁니다.
  items: { tide: [], clip: [], events: [] },
  remoteMemos: {},
  localDoc: { context: '', updatedAt: '', memos: {} },
  contextId: '',
  refreshedAt: '',
  lastError: '',
  fontSize: 12,
  composingMemo: false,
  pushTimer: 0,
  refreshing: null,
  stopOutboxWatch: null,
  contextDialogResolve: null
};

const PARSERS = Object.freeze({
  // tide 는 현재 운영 중인 데이터원입니다.
  // 만료된(7일간 손대지 않은) 항목만 tide/archive/<YYYY-MM>.json 배열로 쌓입니다.
  // 레코드 모양: { id, kind: 'clip'|'dump', text, createdAt, archivedAt }
  // 따라서 오늘·이번 주는 비어 있는 것이 정상입니다.
  tide: Object.freeze({
    async read(config, dirPath) {
      let entries;
      try {
        entries = await Sync.listDir(config, `${dirPath}/archive`);
      } catch (error) {
        // archive 폴더가 아직 없으면 빈 목록으로 둡니다.
        if (error && error.type === 'notfound') return [];
        throw error;
      }
      const files = entries.filter((entry) => (
        entry.type === 'file' && /^\d{4}-\d{2}\.json$/.test(entry.name)
      ));
      const documents = await Promise.all(files.map((entry) => readJsonArrayFile(config, entry.path)));
      return mergeTideArchives(documents.filter(Boolean));
    },
    events(items, dateKey) {
      return items
        .filter((item) => localDateKey(new Date(item.createdAt)) === dateKey)
        .map((item) => ({
          id: `tide:${item.id}`,
          app: 'TIDE',
          at: item.createdAt,
          title: item.kind === 'dump' ? 'Wrote a note' : 'Saved a clip',
          detail: textPreview(item.text)
        }));
    }
  }),
  // clip 은 은퇴한 앱입니다. webapp-data 의 clip/ 폴더가 남아 있는 동안에만
  // 과거 기록을 계속 볼 수 있도록 파서를 유지합니다.
  // clip/ 폴더를 지우면 rootEntries 에 잡히지 않으므로 조용히 비활성화됩니다.
  clip: Object.freeze({
    async read(config, dirPath) {
      const entries = await Sync.listDir(config, dirPath);
      const files = entries.filter((entry) => entry.type === 'file' && /^data\..+\.json$/.test(entry.name));
      const documents = await Promise.all(files.map((entry) => readJsonFile(config, entry.path)));
      return mergeClipDocuments(documents.filter(Boolean));
    },
    events(items, dateKey) {
      return items
        .filter((item) => localDateKey(new Date(item.createdAt)) === dateKey)
        .map((item) => ({
          id: `clip:${item.id}`,
          app: 'CLIP',
          at: item.createdAt,
          title: 'Saved a clip',
          detail: clipDetail(item)
        }));
    }
  }),
  // events 는 앱들이 공통 모양으로 남기는 활동 기록입니다. 앱마다 파서를 따로
  // 두지 않기 위한 층이라, 새 앱이 늘어도 이 파서 하나만 유지하면 됩니다.
  // 파일: events/<app>.<ctx>.YYYY-MM.json — 이벤트 객체의 배열
  // 레코드 모양: { v: 1, id, app, kind, at, title, detail?, ref?, deleted? }
  // events/ 폴더가 없으면 rootEntries 에 잡히지 않으므로 조용히 비활성화됩니다.
  events: Object.freeze({
    async read(config, dirPath) {
      const entries = await Sync.listDir(config, dirPath);
      const months = recentMonthKeys(EVENT_MONTHS_WINDOW);
      const files = entries.filter((entry) => {
        if (entry.type !== 'file') return false;
        const matched = EVENT_FILE_PATTERN.exec(entry.name);
        return Boolean(matched) && months.has(matched[3]);
      });
      const documents = await Promise.all(files.map((entry) => readJsonArrayFile(config, entry.path)));
      return mergeEventArrays(documents.filter(Boolean));
    },
    events(items, dateKey) {
      return items
        .filter((item) => localDateKey(new Date(item.at)) === dateKey)
        .map((item) => ({
          id: `events:${item.id}`,
          app: item.app.toUpperCase(),
          at: item.at,
          title: item.title,
          detail: item.detail ? textPreview(item.detail) : ''
        }));
    }
  })
});

const PARSER_NAMES = Object.freeze(Object.keys(PARSERS));

function byId(id) {
  return document.getElementById(id);
}

function collectElements() {
  [
    'day-screen', 'settings-screen', 'settings-open', 'settings-close',
    'previous-day', 'next-day', 'today-button', 'date-heading',
    'connection-line', 'timeline', 'empty-state', 'day-summary', 'memo-input',
    'token-input', 'token-status', 'token-save', 'token-clear',
    'context-value', 'context-change', 'refresh-button', 'updated-status',
    'error-status', 'outbox-status', 'size-picker', 'size-reset', 'settings-message',
    'context-dialog', 'context-form', 'context-input', 'context-cancel'
  ].forEach((id) => {
    elements[id] = byId(id);
  });
  elements.appShell = document.querySelector('.app-shell');
}

function storageGet(key, fallback = '') {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    // Storage can be unavailable in private browsing modes.
  }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function validObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isoMillis(value) {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function localDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
}

function shiftedDateKey(key, days) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function formatDateHeading(key) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(dateFromKey(key));
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatRefreshTime(value) {
  if (!validIso(value)) return 'Not refreshed';
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const options = sameYear
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return `Updated ${new Intl.DateTimeFormat('en-US', options).format(date)}`;
}

function clipDetail(item) {
  const label = typeof item.label === 'string' ? item.label.trim() : '';
  if (label) return label;
  return textPreview(item.text);
}

// 한글은 코드 유닛이 아니라 글자 단위로 잘라야 조합 문자가 깨지지 않습니다.
function textPreview(value) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const characters = Array.from(text);
  if (characters.length <= 40) return characters.join('');
  return `${characters.slice(0, 40).join('')}…`;
}

// 오늘이 속한 달부터 거슬러 올라가며 'YYYY-MM' 키를 만듭니다. 로컬 시각 기준입니다.
function recentMonthKeys(monthCount) {
  const keys = new Set();
  const now = new Date();
  for (let back = 0; back < monthCount; back += 1) {
    const month = new Date(now.getFullYear(), now.getMonth() - back, 1);
    keys.add(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function normalizeEvent(raw) {
  if (!validObject(raw)) return null;
  // 모르는 스키마 버전은 조용히 건너뜁니다.
  if (raw.v !== 1) return null;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  if (!validIso(raw.at)) return null;

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return null;

  const detail = typeof raw.detail === 'string' ? raw.detail.trim() : '';
  return {
    id: raw.id,
    app: typeof raw.app === 'string' && EVENT_APP_PATTERN.test(raw.app) ? raw.app : 'app',
    at: raw.at,
    title: title.slice(0, 120),
    detail: detail.slice(0, 400),
    deleted: raw.deleted === true
  };
}

// 추가만 하는 파일이라 나중에 적힌 것이 최신입니다. 취소(deleted)도 같은 id 로
// 뒤에 붙으므로 마지막에 본 것을 채택하고, 취소된 것은 목록에서 뺍니다.
function mergeEventArrays(documents) {
  const newest = new Map();
  documents.forEach((entries) => {
    entries.forEach((raw) => {
      const event = normalizeEvent(raw);
      if (!event) return;
      const previous = newest.get(event.id);
      if (!previous || isoMillis(event.at) >= isoMillis(previous.at)) {
        newest.set(event.id, event);
      }
    });
  });
  return [...newest.values()].filter((event) => !event.deleted);
}

function normalizeTideItem(raw) {
  if (!validObject(raw) || typeof raw.id !== 'string' || !raw.id.trim()) return null;
  if (typeof raw.text !== 'string' || !validIso(raw.createdAt)) return null;
  return {
    id: raw.id,
    kind: raw.kind === 'dump' ? 'dump' : 'clip',
    text: raw.text,
    createdAt: raw.createdAt,
    archivedAt: validIso(raw.archivedAt) ? raw.archivedAt : ''
  };
}

// 같은 id 가 여러 달 파일에 남아 있으면 가장 나중에 보관된 것만 남깁니다.
function mergeTideArchives(documents) {
  const items = new Map();
  documents.forEach((records) => {
    if (!Array.isArray(records)) return;
    records.forEach((raw) => {
      const item = normalizeTideItem(raw);
      if (!item) return;
      const current = items.get(item.id);
      if (!current || isoMillis(item.archivedAt) > isoMillis(current.archivedAt)) {
        items.set(item.id, item);
      }
    });
  });
  return Array.from(items.values());
}

function normalizeClip(raw) {
  if (!validObject(raw) || typeof raw.id !== 'string' || !raw.id.trim()) return null;
  if (!validIso(raw.updatedAt) || !validIso(raw.createdAt)) return null;
  return {
    id: raw.id,
    text: typeof raw.text === 'string' ? raw.text : '',
    label: typeof raw.label === 'string' ? raw.label : '',
    type: typeof raw.type === 'string' ? raw.type : '',
    pinned: Boolean(raw.pinned),
    createdAt: raw.createdAt,
    usedAt: validIso(raw.usedAt) ? raw.usedAt : null,
    useCount: Number.isFinite(Number(raw.useCount)) ? Number(raw.useCount) : 0,
    updatedAt: raw.updatedAt
  };
}

function mergeClipDocuments(documents) {
  const items = new Map();
  const deleted = new Map();

  documents.forEach((documentData) => {
    if (!validObject(documentData)) return;
    if (Array.isArray(documentData.items)) {
      documentData.items.forEach((raw) => {
        const item = normalizeClip(raw);
        if (!item) return;
        const current = items.get(item.id);
        if (!current || isoMillis(item.updatedAt) > isoMillis(current.updatedAt)) {
          items.set(item.id, item);
        }
      });
    }
    if (Array.isArray(documentData.deleted)) {
      documentData.deleted.forEach((raw) => {
        if (!validObject(raw) || typeof raw.id !== 'string' || !raw.id || !validIso(raw.at)) return;
        const current = deleted.get(raw.id);
        if (!current || isoMillis(raw.at) > isoMillis(current)) deleted.set(raw.id, raw.at);
      });
    }
  });

  const merged = [];
  items.forEach((item, id) => {
    const deletedAt = deleted.get(id);
    if (deletedAt && isoMillis(deletedAt) > isoMillis(item.updatedAt)) return;
    merged.push(item);
  });
  return merged;
}

function normalizeMemos(raw) {
  const output = {};
  if (!validObject(raw)) return output;
  Object.entries(raw).forEach(([dateKey, memo]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !validObject(memo) || !validIso(memo.at)) return;
    output[dateKey] = {
      text: typeof memo.text === 'string' ? memo.text : '',
      at: memo.at
    };
  });
  return output;
}

function mergeMemoMaps(...maps) {
  const merged = {};
  maps.forEach((map) => {
    Object.entries(normalizeMemos(map)).forEach(([dateKey, memo]) => {
      if (!merged[dateKey] || isoMillis(memo.at) > isoMillis(merged[dateKey].at)) {
        merged[dateKey] = memo;
      }
    });
  });
  return merged;
}

function currentMemo(dateKey) {
  const merged = mergeMemoMaps(state.remoteMemos, state.localDoc.memos);
  return merged[dateKey] || null;
}

function config() {
  return {
    owner: APP.owner,
    repo: APP.repo,
    token: storageGet(APP.tokenKey),
    branch: APP.branch
  };
}

async function resolveConfig() {
  const resolved = config();
  if (!resolved.token) {
    throw new Sync.SyncError('Add a GitHub token in Settings.', { type: 'auth' });
  }
  return resolved;
}

async function readJsonFile(syncConfig, path) {
  try {
    const result = await Sync.readFile(syncConfig, path);
    if (!result.exists || !result.content) return null;
    const parsed = JSON.parse(result.content);
    return validObject(parsed) ? parsed : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function readJsonArrayFile(syncConfig, path) {
  try {
    const result = await Sync.readFile(syncConfig, path);
    if (!result.exists || !result.content) return null;
    const parsed = JSON.parse(result.content);
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function loadSettings() {
  const saved = parseJson(storageGet(APP.settingsKey, '{}'), {});
  const size = Number(saved.fontSize);
  state.fontSize = APP.fontSizes.includes(size) ? size : 12;
  applyFontSize();
}

function saveSettings() {
  storageSet(APP.settingsKey, JSON.stringify({ fontSize: state.fontSize }));
}

function applyFontSize() {
  document.documentElement.style.setProperty('--body-size', `${state.fontSize}px`);
  if (!elements['size-picker']) return;
  elements['size-picker'].querySelectorAll('button[data-size]').forEach((button) => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.size) === state.fontSize));
  });
}

function loadCache() {
  const cached = parseJson(storageGet(APP.cacheKey, '{}'), {});
  if (!validObject(cached)) return;

  // version 1 캐시는 clip 목록만 최상위 `clips` 키에 담았습니다. 그대로 이어받습니다.
  const legacyClips = Array.isArray(cached.clips) ? cached.clips : null;
  const items = validObject(cached.items) ? cached.items : {};

  state.items = {
    tide: Array.isArray(items.tide) ? items.tide.map(normalizeTideItem).filter(Boolean) : [],
    clip: Array.isArray(items.clip)
      ? items.clip.map(normalizeClip).filter(Boolean)
      : (legacyClips ? legacyClips.map(normalizeClip).filter(Boolean) : []),
    events: Array.isArray(items.events) ? items.events.map(normalizeEvent).filter(Boolean) : []
  };
  state.remoteMemos = normalizeMemos(cached.memos);
  state.refreshedAt = validIso(cached.refreshedAt) ? cached.refreshedAt : '';
}

function saveCache() {
  storageSet(APP.cacheKey, JSON.stringify({
    version: 2,
    refreshedAt: state.refreshedAt,
    items: state.items,
    memos: state.remoteMemos
  }));
}

function loadLocalDoc() {
  const raw = parseJson(storageGet(APP.localKey, '{}'), {});
  state.localDoc = {
    context: state.contextId,
    updatedAt: validIso(raw.updatedAt) ? raw.updatedAt : '',
    memos: raw.context === state.contextId ? normalizeMemos(raw.memos) : {}
  };
}

function saveLocalDoc() {
  storageSet(APP.localKey, JSON.stringify(state.localDoc));
}

async function readAllRemoteMemos(syncConfig) {
  const entries = await Sync.listDir(syncConfig, 'trace');
  const files = entries.filter((entry) => entry.type === 'file' && /^memo\..+\.json$/.test(entry.name));
  const documents = await Promise.all(files.map((entry) => readJsonFile(syncConfig, entry.path)));
  return mergeMemoMaps(...documents.filter(Boolean).map((documentData) => documentData.memos));
}

async function readParserData(syncConfig, rootEntries) {
  const parserJobs = rootEntries
    .filter((entry) => entry.type === 'dir' && Object.prototype.hasOwnProperty.call(PARSERS, entry.name))
    .map(async (entry) => ({ name: entry.name, items: await PARSERS[entry.name].read(syncConfig, entry.path) }));
  return Promise.all(parserJobs);
}

function describeError(error) {
  if (!error) return 'Unknown sync error.';
  if (error.type === 'auth') return 'Authorization failed. Check the token and repository access.';
  if (error.type === 'network') return 'Network unavailable. Cached data is shown.';
  if (error.type === 'notfound') return 'The repository path was not found.';
  if (error.type === 'conflict') return 'A newer copy exists. The memo is queued to send again.';
  return typeof error.message === 'string' && error.message ? error.message : 'Unknown sync error.';
}

async function refreshRemote() {
  if (state.refreshing) return state.refreshing;
  const token = storageGet(APP.tokenKey);
  if (!token) {
    state.lastError = 'Add a GitHub token in Settings.';
    renderSettings();
    return;
  }
  state.refreshing = (async () => {
    elements['refresh-button'].disabled = true;
    try {
      const syncConfig = config();
      const rootEntries = await Sync.listDir(syncConfig, '');
      const [parserResults, memos] = await Promise.all([
        readParserData(syncConfig, rootEntries),
        readAllRemoteMemos(syncConfig)
      ]);
      // 폴더가 없는 데이터원은 결과에 안 잡히므로 빈 배열로 둡니다.
      const nextItems = {};
      PARSER_NAMES.forEach((name) => {
        const result = parserResults.find((entry) => entry.name === name);
        nextItems[name] = result ? result.items : [];
      });
      state.items = nextItems;
      state.remoteMemos = memos;
      state.refreshedAt = new Date().toISOString();
      state.lastError = '';
      saveCache();
      renderDay();
      renderSettings();
    } catch (error) {
      state.lastError = describeError(error);
      renderConnection();
      renderSettings();
    } finally {
      elements['refresh-button'].disabled = false;
      state.refreshing = null;
    }
  })();
  return state.refreshing;
}

function eventsForDate(dateKey) {
  const events = [];
  PARSER_NAMES.forEach((name) => {
    const items = state.items[name];
    if (!Array.isArray(items) || items.length === 0) return;
    events.push(...PARSERS[name].events(items, dateKey));
  });
  events.sort((a, b) => isoMillis(a.at) - isoMillis(b.at));
  return events;
}

function createTimelineItem(event) {
  const item = document.createElement('li');
  item.className = 'timeline-item';

  const time = document.createElement('time');
  time.className = 'timeline-time';
  time.dateTime = event.at;
  time.textContent = formatTime(event.at);

  const dot = document.createElement('span');
  dot.className = 'timeline-dot';
  dot.setAttribute('aria-hidden', 'true');

  const content = document.createElement('div');
  content.className = 'timeline-content';

  const badge = document.createElement('span');
  badge.className = 'app-badge';
  badge.textContent = event.app;

  const text = document.createElement('span');
  text.className = 'event-text';
  const title = document.createElement('span');
  title.textContent = event.title;
  text.append(title);
  if (event.detail) {
    const detail = document.createElement('span');
    detail.className = 'event-detail';
    detail.textContent = ` · ${event.detail}`;
    text.append(detail);
  }

  content.append(badge, text);
  item.append(time, dot, content);
  return item;
}

function renderTimeline(events) {
  elements.timeline.replaceChildren();
  events.forEach((event) => elements.timeline.append(createTimelineItem(event)));
  const empty = events.length === 0;
  elements.timeline.hidden = empty;
  elements['empty-state'].hidden = !empty;
  elements['day-summary'].textContent = empty
    ? ''
    : `${events.length} entr${events.length === 1 ? 'y' : 'ies'}`;
}

function renderMemo() {
  if (document.activeElement === elements['memo-input']) return;
  const memo = currentMemo(state.selectedDate);
  elements['memo-input'].value = memo ? memo.text : '';
}

function renderConnection() {
  const offline = !navigator.onLine;
  elements['connection-line'].hidden = !offline;
  elements['connection-line'].textContent = 'Offline · cached data is shown';
}

function renderDay() {
  const today = localDateKey(new Date());
  if (state.selectedDate > today) state.selectedDate = today;
  elements['date-heading'].textContent = formatDateHeading(state.selectedDate);
  elements['next-day'].disabled = state.selectedDate >= today;
  renderTimeline(eventsForDate(state.selectedDate));
  renderMemo();
  renderConnection();
}

function renderTokenStatus() {
  const token = storageGet(APP.tokenKey);
  elements['token-status'].textContent = token ? `Saved · ending ${token.slice(-4)}` : 'Not saved';
  if (document.activeElement !== elements['token-input']) elements['token-input'].value = '';
}

async function refreshOutboxCount() {
  let count = 0;
  try {
    const entries = await Sync.outboxList(APP.namespace);
    count = entries.length;
  } catch (error) {
    count = 0;
  }
  elements['outbox-status'].textContent = `${count} to send`;
}

function renderSettings() {
  renderTokenStatus();
  elements['context-value'].textContent = Sync.getContextLabel(APP.namespace) || 'Not named yet — tap Change';
  elements['updated-status'].textContent = formatRefreshTime(state.refreshedAt);
  elements['error-status'].textContent = state.lastError || 'No errors';
  elements['error-status'].dataset.error = String(Boolean(state.lastError));
  applyFontSize();
  refreshOutboxCount();
}

function setSettingsMessage(message) {
  elements['settings-message'].textContent = message;
}

function requestContextName(current = '') {
  if (state.contextDialogResolve) return Promise.resolve('');
  elements['context-input'].value = current;
  elements['context-dialog'].showModal();
  elements['context-input'].focus();
  return new Promise((resolve) => {
    state.contextDialogResolve = resolve;
  });
}

function resolveContextDialog(value) {
  if (!state.contextDialogResolve) return;
  const resolve = state.contextDialogResolve;
  state.contextDialogResolve = null;
  elements['context-dialog'].close();
  resolve(value);
}

function openSettings() {
  elements['day-screen'].hidden = true;
  elements['settings-screen'].hidden = false;
  elements.appShell.classList.add('settings-active');
  renderSettings();
  elements['settings-close'].focus();
}

function closeSettings() {
  elements['settings-screen'].hidden = true;
  elements['day-screen'].hidden = false;
  elements.appShell.classList.remove('settings-active');
  setSettingsMessage('');
  renderDay();
  elements['date-heading'].focus({ preventScroll: true });
}

function moveSelectedDay(days) {
  const next = shiftedDateKey(state.selectedDate, days);
  const today = localDateKey(new Date());
  state.selectedDate = next > today ? today : next;
  renderDay();
}

function saveMemoLocally() {
  const now = new Date().toISOString();
  state.localDoc.context = state.contextId;
  state.localDoc.updatedAt = now;
  state.localDoc.memos[state.selectedDate] = {
    text: elements['memo-input'].value,
    at: now
  };
  saveLocalDoc();
  scheduleMemoPush();
}

function scheduleMemoPush() {
  if (state.pushTimer) window.clearTimeout(state.pushTimer);
  state.pushTimer = window.setTimeout(() => {
    state.pushTimer = 0;
    pushMemosNow();
  }, APP.debounceMs);
}

function memoPayload(memos) {
  return JSON.stringify({
    context: state.contextId,
    updatedAt: new Date().toISOString(),
    memos
  }, null, 2);
}

async function enqueueMemo(path, content, error) {
  try {
    await Sync.outboxEnqueueReplace(APP.namespace, {
      path,
      content,
      message: `sync: trace memo ${new Date().toISOString().slice(0, 16)}`
    });
    state.lastError = describeError(error);
  } catch (queueError) {
    state.lastError = 'The memo is saved on this device, but the send queue could not be opened.';
  }
  refreshOutboxCount();
  renderSettings();
}

async function pushMemosNow() {
  if (!state.contextId) return;
  if (state.pushTimer) {
    window.clearTimeout(state.pushTimer);
    state.pushTimer = 0;
  }

  const path = Sync.contextFilePath(APP.memoBasePath, state.contextId);
  let content = memoPayload(state.localDoc.memos);
  try {
    const syncConfig = await resolveConfig();
    const current = await Sync.readFile(syncConfig, path);
    let merged = state.localDoc.memos;
    if (current.exists && current.content) {
      try {
        const remote = JSON.parse(current.content);
        merged = mergeMemoMaps(remote.memos, state.localDoc.memos);
      } catch (error) {
        merged = state.localDoc.memos;
      }
    }
    state.localDoc.memos = merged;
    state.localDoc.updatedAt = new Date().toISOString();
    saveLocalDoc();
    content = memoPayload(merged);
    await Sync.writeFile(syncConfig, path, content, {
      sha: current.sha || undefined,
      message: `sync: trace memo ${new Date().toISOString().slice(0, 16)}`
    });
    state.lastError = '';
    renderSettings();
    refreshOutboxCount();
  } catch (error) {
    await enqueueMemo(path, content, error);
  }
}

function bindEvents() {
  elements['previous-day'].addEventListener('click', () => moveSelectedDay(-1));
  elements['next-day'].addEventListener('click', () => moveSelectedDay(1));
  elements['today-button'].addEventListener('click', () => {
    state.selectedDate = localDateKey(new Date());
    renderDay();
  });
  elements['settings-open'].addEventListener('click', openSettings);
  elements['settings-close'].addEventListener('click', closeSettings);

  elements['memo-input'].addEventListener('compositionstart', () => {
    state.composingMemo = true;
  });
  elements['memo-input'].addEventListener('compositionend', () => {
    state.composingMemo = false;
    saveMemoLocally();
  });
  elements['memo-input'].addEventListener('input', () => {
    if (!state.composingMemo) saveMemoLocally();
  });

  elements['token-save'].addEventListener('click', async () => {
    const token = elements['token-input'].value.trim();
    if (!token) {
      setSettingsMessage('Enter a token to save.');
      return;
    }
    storageSet(APP.tokenKey, token);
    elements['token-input'].value = '';
    state.lastError = '';
    setSettingsMessage('Token saved.');
    renderSettings();
    await refreshRemote();
  });

  elements['token-clear'].addEventListener('click', () => {
    if (!storageGet(APP.tokenKey)) return;
    // One token key per origin, so Atlas and Tide read the same value as Trace.
    if (!window.confirm('Clear the saved GitHub token?\n\nAtlas and Tide share this token — clearing it stops their sync too.')) return;
    storageRemove(APP.tokenKey);
    state.lastError = '';
    setSettingsMessage('Token cleared.');
    renderSettings();
  });

  elements['context-change'].addEventListener('click', async () => {
    const current = Sync.getContextLabel(APP.namespace) || '';
    const label = await requestContextName(current);
    if (!label.trim()) return;
    Sync.setContextLabel(APP.namespace, label.trim());
    setSettingsMessage('Context name changed.');
    renderSettings();
  });

  elements['context-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    resolveContextDialog(elements['context-input'].value.trim());
  });
  elements['context-cancel'].addEventListener('click', () => resolveContextDialog(''));
  elements['context-dialog'].addEventListener('cancel', (event) => {
    event.preventDefault();
    resolveContextDialog('');
  });

  elements['refresh-button'].addEventListener('click', async () => {
    setSettingsMessage('');
    await refreshRemote();
  });

  elements['size-picker'].addEventListener('click', (event) => {
    const button = event.target.closest('button[data-size]');
    if (!button) return;
    const size = Number(button.dataset.size);
    if (!APP.fontSizes.includes(size)) return;
    state.fontSize = size;
    saveSettings();
    applyFontSize();
  });

  elements['size-reset'].addEventListener('click', () => {
    state.fontSize = 12;
    saveSettings();
    applyFontSize();
  });

  window.addEventListener('online', () => {
    renderConnection();
    refreshRemote();
  });
  window.addEventListener('offline', renderConnection);
  window.addEventListener('storage', (event) => {
    if (event.key === APP.tokenKey) renderSettings();
    if (event.key === APP.localKey) {
      loadLocalDoc();
      renderDay();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.pushTimer) pushMemosNow();
  });
  window.addEventListener('pagehide', () => {
    if (state.pushTimer) pushMemosNow();
  });
}

async function ensureContext() {
  // No prompt on first launch. Asking someone to name a "browser storage context"
  // before they have seen the app is a poor first screen, and the name is only
  // needed once sync is set up — Settings › Context › Change covers that.
  // Omitting the prompt makes ensureContextId generate an unnamed id instead.
  state.contextId = await Sync.ensureContextId(APP.namespace);
  loadLocalDoc();
}

function watchOutbox() {
  state.stopOutboxWatch = Sync.outboxWatch(APP.namespace, resolveConfig, {
    onFlushed(result) {
      if (result && Array.isArray(result.flushed) && result.flushed.length > 0) state.lastError = '';
      refreshOutboxCount();
      renderSettings();
    },
    onError(error) {
      state.lastError = describeError(error);
      refreshOutboxCount();
      renderSettings();
    }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The app remains usable without service worker registration.
    });
  });
}

async function init() {
  collectElements();
  loadSettings();
  loadCache();
  bindEvents();
  renderDay();
  await ensureContext();
  renderDay();
  renderSettings();
  watchOutbox();
  registerServiceWorker();
  await refreshRemote();
}

init().catch((error) => {
  state.lastError = describeError(error);
  renderConnection();
  renderSettings();
});
