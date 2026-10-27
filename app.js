/**
 * PDD Smart Trainer - Core Application Logic
 * Pure Vanilla JavaScript ES6+
 */

(function () {
  'use strict';

  const QUESTIONS_PER_TICKET = 20;
  const TICKETS_COUNT = 40;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Backend: same origin when served by server.py (grzxk.ru/pdd, localhost),
  // otherwise (GitHub Pages, file://) the hosted API.
  const API_BASE = (function () {
    if (window.PDD_API_BASE) return window.PDD_API_BASE;
    const host = window.location.hostname;
    if (window.location.protocol === 'file:' || host.endsWith('github.io')) return 'https://grzxk.ru/pdd/api/';
    return 'api/';
  })();

  // ---------------------------------------------------------------------------
  // AI tag vocabulary (see docs/TAGGING_SPEC.md)
  // ---------------------------------------------------------------------------

  const TOPICS = [
    ['general', 'Общие положения, термины'],
    ['driver_duties', 'Обязанности водителя'],
    ['special_signals', 'Спецсигналы и аварийка'],
    ['signals_adjuster', 'Светофоры и регулировщик'],
    ['signs', 'Дорожные знаки'],
    ['markings', 'Разметка'],
    ['maneuvering', 'Повороты, развороты, задний ход'],
    ['lane_position', 'Полосы и расположение'],
    ['speed', 'Скорость'],
    ['overtaking', 'Обгон и встречный разъезд'],
    ['stopping_parking', 'Остановка и стоянка'],
    ['intersections', 'Перекрестки'],
    ['pedestrians', 'Пешеходные переходы'],
    ['railway', 'Ж/д переезды'],
    ['highway_residential', 'Автомагистрали и жилые зоны'],
    ['route_vehicles', 'Маршрутные ТС'],
    ['lights_horn', 'Фары и звуковой сигнал'],
    ['towing', 'Буксировка'],
    ['passengers_cargo', 'Перевозка людей и грузов'],
    ['malfunctions', 'Неисправности'],
    ['safety', 'Безопасность и техника управления'],
    ['first_aid', 'Первая помощь'],
    ['liability', 'Ответственность, ОСАГО, ДТП']
  ];

  const FORMATS = [
    ['who_first', 'Кто проедет первым'],
    ['allowed', 'Можно ли / разрешено ли'],
    ['action', 'Как действовать'],
    ['meaning', 'Что означает знак/сигнал'],
    ['trajectory', 'Траектория и полоса'],
    ['value', 'Ответ — число'],
    ['definition', 'Термины'],
    ['fact', 'Прочие факты']
  ];

  const NUMBER_KINDS = [
    ['speed', 'Скорость'],
    ['distance', 'Расстояния'],
    ['dimension', 'Размеры, мм'],
    ['time', 'Сроки и время'],
    ['percent', 'Проценты'],
    ['mass', 'Масса'],
    ['age', 'Возраст'],
    ['count', 'Количество'],
    ['other', 'Другое']
  ];

  const INVOLVES = [
    ['tram', 'Трамвай'],
    ['pedestrian', 'Пешеходы'],
    ['cyclist', 'Велосипедисты'],
    ['motorcycle', 'Мотоциклы, мопеды'],
    ['route_vehicle', 'Автобусы, троллейбусы'],
    ['emergency', 'Спецтранспорт'],
    ['adjuster', 'Регулировщик'],
    ['traffic_light', 'Светофор'],
    ['railway', 'Ж/д переезд'],
    ['roundabout', 'Круговое движение'],
    ['truck_trailer', 'Грузовики, прицепы'],
    ['children', 'Дети'],
    ['bad_conditions', 'Ночь, туман, гололед'],
    ['tunnel_bridge', 'Тоннели и мосты'],
    ['mountain_road', 'Горные дороги, уклоны']
  ];

  // Quick picks — combined with AND
  const QUICK = [
    ['memorize', 'Числа и нормы', 'Ответ требует знать конкретное число: скорость, метры, мм, сроки, проценты'],
    ['trap', 'Ловушки', 'Интуитивный ответ неверен или всё решает мелкая деталь'],
    ['my_repeat', 'Мои частые ошибки', 'Вы ошибались в этом вопросе 2 и более раз'],
    ['stale', 'Давно не повторял', 'Отвечали больше 7 дней назад'],
    ['global_hard', 'Часто ошибаются все', 'По статистике всех пользователей: 40% ошибок и больше']
  ];

  const DIFFICULTY_LABELS = { 1: 'Легкий', 2: 'Средний', 3: 'Сложный' };
  const FORMAT_LABELS = Object.fromEntries(FORMATS);
  const TOPIC_LABELS = Object.fromEntries(TOPICS);

  // Chip facets. Values inside a facet are combined with OR (topics: AND/OR switch),
  // facets are combined with AND.
  const CHIP_FACETS = [
    {
      id: 'quick', container: 'quickContainer', items: QUICK,
      match: (q, v) => quickMatches(q, v), combine: 'and'
    },
    {
      id: 'numberKinds', container: 'numbersContainer', items: NUMBER_KINDS,
      match: (q, v) => q.ai.memorize_number && q.ai.number_kind === v, combine: 'or'
    },
    {
      id: 'formats', container: 'formatsContainer', items: FORMATS,
      match: (q, v) => q.ai.format === v, combine: 'or'
    },
    {
      id: 'topics', container: 'tagsContainer', items: TOPICS,
      match: (q, v) => q.ai.topics.includes(v), combine: () => state.filters.topicMode
    },
    {
      id: 'involves', container: 'involvesContainer', items: INVOLVES,
      match: (q, v) => q.ai.involves.includes(v), combine: 'or'
    }
  ];

  const FACET_BY_ID = new Map(CHIP_FACETS.map((f) => [f.id, f]));

  // Default filter values (used for reset and for "is filter active" checks)
  const DEFAULT_FILTERS = {
    tickets: [],
    quick: [],
    numberKinds: [],
    formats: [],
    topics: [],
    involves: [],
    topicMode: 'or', // 'and' | 'or'
    status: 'all', // 'all' | 'new' | 'wrong' | 'ever_wrong' | 'correct' | 'favorites'
    difficulty: 'all', // 'all' | '1' | '2' | '3'
    media: 'all', // 'all' | 'image' | 'text'
    answers: 'all', // 'all' | '2' | '3' | '4' (4 = four or more)
    block: 'all', // 'all' | '1'..'4' (questions 1–5, 6–10, 11–15, 16–20)
    order: 'seq', // 'seq' | 'shuffle' | 'hard' | 'mistakes'
    searchInExplanation: true
  };

  const SET_FILTERS = ['tickets', 'quick', 'numberKinds', 'formats', 'topics', 'involves'];

  function freshFilters() {
    const f = { ...DEFAULT_FILTERS };
    SET_FILTERS.forEach((k) => { f[k] = new Set(); });
    return f;
  }

  // Master State
  const state = {
    questions: window.PDD_QUESTIONS || [],
    filteredQuestions: [],
    currentIndex: 0,
    filters: freshFilters(),
    searchQuery: '',
    // { questionId: { selectedIndex, isCorrect, timestamp, attempts, wrong, correct } }
    answersLog: {},
    favorites: new Set(),
    unlocked: new Set(), // answered questions re-opened for another attempt
    justAnsweredId: null,
    shuffleRank: new Map(),
    globalStats: {}, // { questionId: [attempts, wrong] } across all users
    auth: null, // { login, token }
    outbox: [], // events not yet delivered to the server
    syncStatus: 'local', // 'local' | 'syncing' | 'ok' | 'error'
    stats: {
      correct: 0,
      wrong: 0,
      totalAnswered: 0
    }
  };

  const STATUS_LABELS = { new: 'Новые', wrong: 'Ошибки сейчас', ever_wrong: 'Были ошибки', correct: 'Верные', favorites: 'Избранное' };
  const MEDIA_LABELS = { image: 'С картинкой', text: 'Без картинки' };
  const ANSWERS_LABELS = { 2: '2 варианта', 3: '3 варианта', 4: '4+ варианта' };
  const BLOCK_LABELS = { 1: 'Вопросы 1–5', 2: 'Вопросы 6–10', 3: 'Вопросы 11–15', 4: 'Вопросы 16–20' };
  const ORDER_LABELS = { shuffle: 'Вперемешку', hard: 'Сначала сложные', mistakes: 'Сначала мои ошибки' };

  // LocalStorage Persistence Keys
  const STORAGE_KEY_ANSWERS = 'pdd_smart_answers_v1';
  const STORAGE_KEY_FAVS = 'pdd_smart_favs_v1';
  const STORAGE_KEY_FILTERS = 'pdd_smart_filters_v3';
  const STORAGE_KEY_AUTH = 'pdd_auth_v1';
  const STORAGE_KEY_OUTBOX = 'pdd_outbox_v1';
  const STORAGE_KEY_THEME = 'pdd_theme';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeText(str) {
    return String(str).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  }

  function stripHtml(html) {
    return String(html).replace(/<[^>]*>/g, ' ');
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function globalNumber(q) {
    return (q.ticket - 1) * QUESTIONS_PER_TICKET + Number(q.num);
  }

  function blockOf(q) {
    return String(Math.ceil(Number(q.num) / 5));
  }

  function pluralize(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      // Storage is unavailable (private mode, quota) — keep working in memory
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {
      // ignore
    }
  }

  function readJson(key, fallback) {
    try {
      const raw = storageGet(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  // Precompute search corpora once; questions without AI tags get neutral defaults
  state.questions.forEach((q) => {
    q.ai = Object.assign({
      topics: [], format: null, memorize_number: false, number_kind: null, number_value: null,
      difficulty: 2, trap: false, trap_reason: null, involves: [], key_fact: null
    }, q.ai || {});
    q._searchMain = normalizeText(q.title + ' ' + q.answers.join(' '));
    q._searchExpl = normalizeText(stripHtml(q.explanation || '') + ' ' + (q.ai.key_fact || ''));
    q._global = globalNumber(q);
  });

  const QUESTION_BY_GLOBAL = new Map(state.questions.map((q) => [q._global, q]));
  const QUESTION_BY_ID = new Map(state.questions.map((q) => [q.id, q]));

  // ---------------------------------------------------------------------------
  // Persistence (LocalStorage + server account sync)
  // ---------------------------------------------------------------------------

  // Older logs only stored the last answer — derive counters from it
  function normalizeLogEntry(l) {
    if (!l || typeof l !== 'object') return null;
    const isCorrect = !!l.isCorrect;
    return {
      selectedIndex: Number(l.selectedIndex) || 0,
      isCorrect,
      timestamp: Number(l.timestamp) || 0,
      attempts: Number(l.attempts) || 1,
      wrong: l.wrong !== undefined ? Number(l.wrong) || 0 : (isCorrect ? 0 : 1),
      correct: l.correct !== undefined ? Number(l.correct) || 0 : (isCorrect ? 1 : 0)
    };
  }

  function loadLocalState() {
    const savedAnswers = readJson(STORAGE_KEY_ANSWERS, {});
    if (savedAnswers && typeof savedAnswers === 'object') {
      for (const id in savedAnswers) {
        const entry = normalizeLogEntry(savedAnswers[id]);
        if (entry && QUESTION_BY_ID.has(id)) state.answersLog[id] = entry;
      }
    }
    const savedFavs = readJson(STORAGE_KEY_FAVS, []);
    if (Array.isArray(savedFavs)) state.favorites = new Set(savedFavs);

    const auth = readJson(STORAGE_KEY_AUTH, null);
    if (auth && auth.token && auth.login) state.auth = auth;
    const outbox = readJson(STORAGE_KEY_OUTBOX, []);
    if (Array.isArray(outbox)) state.outbox = outbox;

    const f = readJson(STORAGE_KEY_FILTERS, null);
    if (f && typeof f === 'object') {
      const valid = (v, allowed) => (allowed.includes(v) ? v : undefined);
      const known = (list, items) => new Set((list || []).filter((v) => items.some(([id]) => id === v)));
      state.filters.tickets = new Set((f.tickets || []).filter((t) => t >= 1 && t <= TICKETS_COUNT));
      CHIP_FACETS.forEach((facet) => { state.filters[facet.id] = known(f[facet.id], facet.items); });
      state.filters.topicMode = valid(f.topicMode, ['and', 'or']) || DEFAULT_FILTERS.topicMode;
      state.filters.status = valid(f.status, ['all', 'new', 'wrong', 'ever_wrong', 'correct', 'favorites']) || DEFAULT_FILTERS.status;
      state.filters.difficulty = valid(f.difficulty, ['all', '1', '2', '3']) || DEFAULT_FILTERS.difficulty;
      state.filters.media = valid(f.media, ['all', 'image', 'text']) || DEFAULT_FILTERS.media;
      state.filters.answers = valid(f.answers, ['all', '2', '3', '4']) || DEFAULT_FILTERS.answers;
      state.filters.block = valid(f.block, ['all', '1', '2', '3', '4']) || DEFAULT_FILTERS.block;
      state.filters.order = valid(f.order, ['seq', 'shuffle', 'hard', 'mistakes']) || DEFAULT_FILTERS.order;
      state.filters.searchInExplanation = f.searchInExplanation !== false;
    }
    recalcStats();
  }

  function saveLocalProgress() {
    storageSet(STORAGE_KEY_ANSWERS, JSON.stringify(state.answersLog));
    storageSet(STORAGE_KEY_FAVS, JSON.stringify([...state.favorites]));
  }

  function saveFilters() {
    const f = state.filters;
    const out = {};
    for (const key in DEFAULT_FILTERS) {
      out[key] = f[key] instanceof Set ? [...f[key]] : f[key];
    }
    storageSet(STORAGE_KEY_FILTERS, JSON.stringify(out));
  }

  function recalcStats() {
    let correct = 0;
    let wrong = 0;
    for (const id in state.answersLog) {
      if (!QUESTION_BY_ID.has(id)) continue;
      if (state.answersLog[id].isCorrect) {
        correct++;
      } else {
        wrong++;
      }
    }
    state.stats.correct = correct;
    state.stats.wrong = wrong;
    state.stats.totalAnswered = correct + wrong;
    updateStatsHeader();
  }

  // --- Server API -------------------------------------------------------------

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.auth) headers.Authorization = 'Bearer ' + state.auth.token;
    const resp = await fetch(API_BASE + path, {
      method: options.body ? 'POST' : 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
    let data = null;
    try {
      data = await resp.json();
    } catch (_) {
      // non-JSON error page
    }
    if (!resp.ok) {
      const err = new Error((data && data.error) || `HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return data;
  }

  function queueEvent(ev) {
    if (!state.auth) return;
    state.outbox.push(ev);
    storageSet(STORAGE_KEY_OUTBOX, JSON.stringify(state.outbox));
    scheduleFlush();
  }

  let flushTimer = null;
  let flushing = false;

  function scheduleFlush(delay = 400) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushOutbox, delay);
  }

  async function flushOutbox() {
    if (!state.auth || flushing) return;
    if (state.outbox.length === 0) return;
    flushing = true;
    setSyncStatus('syncing');
    const batch = state.outbox.slice(0, 2000);
    try {
      const res = await api('events', { body: { events: batch } });
      state.outbox = state.outbox.slice(batch.length);
      storageSet(STORAGE_KEY_OUTBOX, JSON.stringify(state.outbox));
      // Only trust the server snapshot when nothing new happened meanwhile
      if (state.outbox.length === 0 && res && res.progress) applyServerProgress(res.progress);
      setSyncStatus('ok');
    } catch (e) {
      handleSyncError(e);
    } finally {
      flushing = false;
      if (state.auth && state.outbox.length > 0 && state.syncStatus === 'ok') scheduleFlush(50);
    }
  }

  async function pullProgress() {
    if (!state.auth) return;
    if (state.outbox.length > 0) {
      flushOutbox();
      return;
    }
    setSyncStatus('syncing');
    try {
      const progress = await api('progress');
      if (state.outbox.length === 0) applyServerProgress(progress);
      setSyncStatus('ok');
    } catch (e) {
      handleSyncError(e);
    }
  }

  function handleSyncError(e) {
    if (e && e.status === 401) {
      // Session is gone on the server — keep local data, ask to log in again
      state.auth = null;
      storageRemove(STORAGE_KEY_AUTH);
      setSyncStatus('local');
      renderAccount();
      return;
    }
    setSyncStatus('error');
    // Retry later (offline, server restart)
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushOutbox, 15000);
  }

  function applyServerProgress(p) {
    if (!p || typeof p !== 'object') return;
    const log = {};
    const questions = p.questions || {};
    for (const id in questions) {
      if (!QUESTION_BY_ID.has(id)) continue;
      const r = questions[id];
      log[id] = {
        selectedIndex: r.sel,
        isCorrect: !!r.ok,
        timestamp: r.ts,
        attempts: r.attempts,
        wrong: r.wrong,
        correct: r.correct
      };
    }
    state.answersLog = log;
    state.favorites = new Set((p.favorites || []).filter((id) => QUESTION_BY_ID.has(id)));
    saveLocalProgress();
    recalcStats();
    renderTicketsGrid();
    applyFilters({ keepCurrent: true });
  }

  // Turns locally stored progress into server events (used on first login)
  function localProgressEvents() {
    const events = [];
    for (const id in state.answersLog) {
      const q = QUESTION_BY_ID.get(id);
      const l = state.answersLog[id];
      if (!q || !l) continue;
      const ts = l.timestamp || Date.now();
      const wrongSel = l.isCorrect ? (q.correct + 1) % q.answers.length : l.selectedIndex;
      // Earlier attempts get distinct, deterministic timestamps so re-uploads dedupe
      let k = 1;
      for (let i = 0; i < l.correct - (l.isCorrect ? 1 : 0); i++) {
        events.push({ type: 'answer', qid: id, sel: q.correct, ok: true, ts: ts - k++ });
      }
      for (let i = 0; i < l.wrong - (l.isCorrect ? 0 : 1); i++) {
        events.push({ type: 'answer', qid: id, sel: wrongSel, ok: false, ts: ts - k++ });
      }
      events.push({ type: 'answer', qid: id, sel: l.selectedIndex, ok: l.isCorrect, ts });
    }
    state.favorites.forEach((id) => events.push({ type: 'fav', qid: id, on: true, ts: Date.now() }));
    return events;
  }

  async function doLogin(login) {
    const res = await api('login', { body: { login } });
    state.auth = { login: res.login, token: res.token };
    storageSet(STORAGE_KEY_AUTH, JSON.stringify(state.auth));
    // Local progress made before logging in is merged into the account
    state.outbox = localProgressEvents().concat(state.outbox);
    storageSet(STORAGE_KEY_OUTBOX, JSON.stringify(state.outbox));
    renderAccount();
    if (state.outbox.length > 0) {
      await flushOutbox();
    } else {
      await pullProgress();
    }
  }

  function doLogout() {
    if (!confirm('Выйти из аккаунта? Прогресс останется на сервере, а на этом устройстве будет очищен.')) return;
    state.auth = null;
    state.outbox = [];
    state.answersLog = {};
    state.favorites = new Set();
    state.unlocked.clear();
    storageRemove(STORAGE_KEY_AUTH);
    storageRemove(STORAGE_KEY_OUTBOX);
    saveLocalProgress();
    setSyncStatus('local');
    recalcStats();
    renderTicketsGrid();
    renderAccount();
    applyFilters({ keepCurrent: true });
    closeModal();
  }

  async function loadGlobalStats() {
    try {
      const data = await api('global-stats');
      if (data && typeof data === 'object') {
        state.globalStats = data;
        renderFacetCounts(buildPredicates());
      }
    } catch (_) {
      // Backend unavailable — the "everyone errs" pick just stays empty
    }
  }

  function globalErrorRate(q) {
    const s = state.globalStats[q.id];
    if (!s || s[0] < 3) return null;
    return s[1] / s[0];
  }

  // ---------------------------------------------------------------------------
  // DOM Elements Cache
  // ---------------------------------------------------------------------------

  const elements = {};

  function initDOMElements() {
    const ids = [
      'tagsContainer', 'quickContainer', 'numbersContainer', 'formatsContainer', 'involvesContainer',
      'ticketsGrid', 'searchInput', 'btnClearSearch', 'searchInExplanation',
      'resultsCount', 'resultsProgress', 'activeFilters', 'questionNavStrip', 'questionCard',
      'emptyState', 'emptyTitle', 'emptyDesc', 'btnEmptyReset',
      'statCorrect', 'statWrong', 'statTotal', 'statProgress',
      'btnPrev', 'btnNext', 'btnFavorite', 'btnFavoriteLabel', 'btnRetry',
      'btnResetFilters', 'btnResetStats', 'btnClearTickets',
      'statusGroup', 'statusHint', 'tagModeGroup', 'difficultyGroup', 'mediaGroup', 'answersGroup',
      'blockGroup', 'orderGroup',
      'qMetaId', 'qPosition', 'qMetaTags', 'qTitle', 'qImageWrapper', 'qImage', 'qImageError', 'btnZoom',
      'qAnswersList', 'qExplanation', 'qExplanationHeading', 'qExplanationText', 'qInsights',
      'btnTheme', 'btnOpenFilters', 'btnCloseFilters', 'btnApplyFilters', 'filterPanel', 'drawerOverlay', 'filtersDot',
      'lightbox', 'lightboxImg', 'btnLogo',
      'btnAccount', 'accountLabel', 'accountDot', 'accountCard',
      'modal', 'modalLogin', 'modalAccount', 'loginForm', 'loginInput', 'loginError', 'btnLoginSubmit',
      'accountName', 'accountSync', 'btnLogout', 'btnSyncNow'
    ];
    ids.forEach((id) => {
      elements[id] = document.getElementById(id);
    });
  }

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  function getSearchTokens() {
    const q = normalizeText(state.searchQuery).trim();
    return q ? q.split(' ').filter(Boolean) : [];
  }

  function quickMatches(q, v) {
    const log = state.answersLog[q.id];
    switch (v) {
      case 'memorize': return q.ai.memorize_number;
      case 'trap': return q.ai.trap;
      case 'my_repeat': return !!log && log.wrong >= 2;
      case 'stale': return !!log && Date.now() - (log.timestamp || 0) > 7 * DAY_MS;
      case 'global_hard': {
        const rate = globalErrorRate(q);
        return rate !== null && rate >= 0.4;
      }
      default: return true;
    }
  }

  function facetMatches(facet, q, values) {
    if (values.size === 0) return true;
    const mode = typeof facet.combine === 'function' ? facet.combine() : facet.combine;
    if (mode === 'and') {
      for (const v of values) if (!facet.match(q, v)) return false;
      return true;
    }
    for (const v of values) if (facet.match(q, v)) return true;
    return false;
  }

  /**
   * Builds a predicate for every filter dimension so that counts can be
   * calculated "as if" one dimension were not applied (faceted search).
   */
  function buildPredicates() {
    const f = state.filters;
    const tokens = getSearchTokens();

    const preds = {
      tickets: (q) => f.tickets.size === 0 || f.tickets.has(q.ticket),
      block: (q) => f.block === 'all' || blockOf(q) === f.block,
      media: (q) => {
        if (f.media === 'image') return !!q.image;
        if (f.media === 'text') return !q.image;
        return true;
      },
      answers: (q) => {
        if (f.answers === 'all') return true;
        const n = q.answers.length;
        return f.answers === '4' ? n >= 4 : n === Number(f.answers);
      },
      difficulty: (q) => f.difficulty === 'all' || String(q.ai.difficulty) === f.difficulty,
      status: (q) => statusMatches(q, f.status),
      search: (q) => {
        if (tokens.length === 0) return true;
        const corpus = f.searchInExplanation ? q._searchMain + ' ' + q._searchExpl : q._searchMain;
        return tokens.every((t) => corpus.includes(t));
      }
    };
    CHIP_FACETS.forEach((facet) => {
      preds[facet.id] = (q) => facetMatches(facet, q, f[facet.id]);
    });
    return preds;
  }

  function statusMatches(q, status) {
    const log = state.answersLog[q.id];
    switch (status) {
      case 'new': return !log;
      case 'wrong': return !!log && !log.isCorrect;
      case 'ever_wrong': return !!log && log.wrong > 0;
      case 'correct': return !!log && log.isCorrect;
      case 'favorites': return state.favorites.has(q.id);
      default: return true;
    }
  }

  function passesAll(q, preds, skip) {
    for (const key in preds) {
      if (key !== skip && !preds[key](q)) return false;
    }
    return true;
  }

  function hardness(q) {
    const rate = globalErrorRate(q);
    return q.ai.difficulty * 10 + (q.ai.trap ? 5 : 0) + (rate === null ? 0 : rate * 4);
  }

  function sortList(list) {
    const order = state.filters.order;
    if (order === 'shuffle') {
      ensureShuffleRank();
      return list.slice().sort((a, b) => state.shuffleRank.get(a.id) - state.shuffleRank.get(b.id));
    }
    if (order === 'hard') {
      return list.slice().sort((a, b) => hardness(b) - hardness(a) || a._global - b._global);
    }
    if (order === 'mistakes') {
      const key = (q) => {
        const l = state.answersLog[q.id];
        if (!l) return -1;
        return l.wrong * 2 + (l.isCorrect ? 0 : 1);
      };
      return list.slice().sort((a, b) => key(b) - key(a) || a._global - b._global);
    }
    return list;
  }

  function applyFilters(options = {}) {
    const { keepCurrent = false, targetId = null } = options;
    const prevId = targetId || (keepCurrent && state.filteredQuestions[state.currentIndex]
      ? state.filteredQuestions[state.currentIndex].id
      : null);

    const preds = buildPredicates();
    const list = sortList(state.questions.filter((q) => passesAll(q, preds)));
    state.filteredQuestions = list;

    // In mistake modes wrong questions are opened for another attempt
    if (state.filters.status === 'wrong' || state.filters.status === 'ever_wrong') {
      list.forEach((q) => state.unlocked.add(q.id));
    }

    let newIndex = 0;
    if (prevId) {
      const found = list.findIndex((q) => q.id === prevId);
      if (found >= 0) newIndex = found;
    }
    state.currentIndex = Math.min(newIndex, Math.max(0, list.length - 1));

    saveFilters();
    renderFacetCounts(preds);
    renderActiveFilterBadges();
    renderQuestionNavStrip();
    renderCurrentQuestion({ scroll: false });
  }

  function ensureShuffleRank(force = false) {
    if (!force && state.shuffleRank.size === state.questions.length) return;
    state.shuffleRank = new Map(state.questions.map((q) => [q.id, Math.random()]));
  }

  function hasActiveFilters() {
    const f = state.filters;
    return SET_FILTERS.some((k) => f[k].size > 0) || f.status !== 'all' || f.media !== 'all' ||
      f.answers !== 'all' || f.block !== 'all' || f.difficulty !== 'all' || state.searchQuery.trim() !== '';
  }

  // ---------------------------------------------------------------------------
  // Rendering — header stats & account
  // ---------------------------------------------------------------------------

  function updateStatsHeader() {
    if (!elements.statCorrect) return;
    const total = state.questions.length;
    elements.statCorrect.textContent = state.stats.correct;
    elements.statWrong.textContent = state.stats.wrong;
    elements.statTotal.textContent = `${state.stats.totalAnswered} / ${total}`;
    const pct = total ? Math.round((state.stats.totalAnswered / total) * 100) : 0;
    elements.statProgress.style.width = pct + '%';
    elements.statProgress.parentElement.title = `Пройдено ${pct}%`;
  }

  const SYNC_TEXT = {
    local: 'Прогресс хранится только в этом браузере',
    syncing: 'Синхронизация…',
    ok: 'Прогресс сохранен на сервере',
    error: 'Нет связи с сервером — ответы сохранятся позже'
  };

  function setSyncStatus(status) {
    state.syncStatus = status;
    renderAccount();
  }

  function renderAccount() {
    if (!elements.btnAccount) return;
    const auth = state.auth;
    elements.accountLabel.textContent = auth ? auth.login : 'Войти';
    elements.btnAccount.classList.toggle('logged-in', !!auth);
    elements.btnAccount.title = auth ? `${auth.login}: ${SYNC_TEXT[state.syncStatus]}` : 'Войти, чтобы сохранять прогресс на сервере';
    elements.accountDot.dataset.status = auth ? state.syncStatus : 'local';
    elements.accountCard.hidden = !!auth;
    elements.accountName.textContent = auth ? auth.login : '';
    elements.accountSync.textContent = SYNC_TEXT[auth ? state.syncStatus : 'local'] +
      (auth && state.outbox.length ? ` (в очереди: ${state.outbox.length})` : '');
    elements.accountSync.dataset.status = auth ? state.syncStatus : 'local';
  }

  // ---------------------------------------------------------------------------
  // Rendering — sidebar
  // ---------------------------------------------------------------------------

  function renderChipFacets() {
    CHIP_FACETS.forEach((facet) => {
      const container = elements[facet.container];
      if (!container) return;
      container.innerHTML = '';
      facet.items.forEach(([id, label, desc]) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip-btn';
        chip.dataset.facet = facet.id;
        chip.dataset.value = id;
        if (desc) chip.title = desc;
        chip.innerHTML = `<span>${escapeHtml(label)}</span><span class="chip-count"></span>`;
        chip.addEventListener('click', () => toggleFacetValue(facet.id, id));
        container.appendChild(chip);
      });
    });
  }

  function toggleFacetValue(facetId, value) {
    const set = state.filters[facetId];
    if (set.has(value)) {
      set.delete(value);
    } else {
      set.add(value);
    }
    applyFilters({ keepCurrent: true });
  }

  // Facet counts: how many questions each option would yield with the other filters applied
  function renderFacetCounts(preds) {
    const f = state.filters;

    CHIP_FACETS.forEach((facet) => {
      const container = elements[facet.container];
      if (!container) return;
      const base = state.questions.filter((q) => passesAll(q, preds, facet.id));
      const mode = typeof facet.combine === 'function' ? facet.combine() : facet.combine;
      container.querySelectorAll('.chip-btn').forEach((chip) => {
        const value = chip.dataset.value;
        const active = f[facet.id].has(value);
        let count;
        if (mode === 'and') {
          const combined = new Set(f[facet.id]);
          combined.add(value);
          count = base.filter((q) => facetMatches(facet, q, combined)).length;
        } else {
          count = base.filter((q) => facet.match(q, value)).length;
        }
        chip.classList.toggle('active', active);
        chip.classList.toggle('dim', !active && count === 0);
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        chip.querySelector('.chip-count').textContent = count;
      });
    });

    // Segmented counts
    const segCounts = (group, dim, values, test) => {
      const base = state.questions.filter((q) => passesAll(q, preds, dim));
      values.forEach((v) => {
        const el = group.querySelector(`[data-count="${v}"]`);
        if (el) el.textContent = base.filter((q) => test(q, v)).length;
      });
    };
    segCounts(elements.statusGroup, 'status', ['all', 'new', 'wrong', 'ever_wrong', 'correct', 'favorites'], statusMatches);
    segCounts(elements.difficultyGroup, 'difficulty', ['1', '2', '3'], (q, v) => String(q.ai.difficulty) === v);

    // Segmented controls state
    syncSegmented(elements.statusGroup, f.status);
    syncSegmented(elements.tagModeGroup, f.topicMode);
    syncSegmented(elements.difficultyGroup, f.difficulty);
    syncSegmented(elements.mediaGroup, f.media);
    syncSegmented(elements.answersGroup, f.answers);
    syncSegmented(elements.blockGroup, f.block);
    syncSegmented(elements.orderGroup, f.order);
    elements.statusHint.hidden = f.status !== 'wrong' && f.status !== 'ever_wrong';
    elements.searchInExplanation.checked = f.searchInExplanation;

    // Tickets
    elements.ticketsGrid.querySelectorAll('.ticket-cell').forEach((cell) => {
      const t = Number(cell.dataset.ticket);
      const active = f.tickets.has(t);
      cell.classList.toggle('active', active);
      cell.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    elements.btnClearTickets.hidden = f.tickets.size === 0;

    // Mobile drawer helpers
    const count = state.filteredQuestions.length;
    elements.btnApplyFilters.textContent = count > 0
      ? `Показать ${count} ${pluralize(count, 'вопрос', 'вопроса', 'вопросов')}`
      : 'Нет подходящих вопросов';
    elements.filtersDot.hidden = !hasActiveFilters();
  }

  function syncSegmented(group, value) {
    if (!group) return;
    group.querySelectorAll('[data-value]').forEach((btn) => {
      const active = btn.dataset.value === value;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function renderTicketsGrid() {
    const grid = elements.ticketsGrid;
    if (grid.children.length === 0) {
      for (let t = 1; t <= TICKETS_COUNT; t++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'ticket-cell';
        cell.textContent = t;
        cell.dataset.ticket = t;
        cell.addEventListener('click', () => {
          if (state.filters.tickets.has(t)) {
            state.filters.tickets.delete(t);
          } else {
            state.filters.tickets.add(t);
          }
          applyFilters();
        });
        grid.appendChild(cell);
      }
    }

    // Progress per ticket
    const progress = {};
    for (let t = 1; t <= TICKETS_COUNT; t++) progress[t] = { answered: 0, wrong: 0 };
    state.questions.forEach((q) => {
      const log = state.answersLog[q.id];
      if (!log || !progress[q.ticket]) return;
      progress[q.ticket].answered++;
      if (!log.isCorrect) progress[q.ticket].wrong++;
    });

    grid.querySelectorAll('.ticket-cell').forEach((cell) => {
      const t = Number(cell.dataset.ticket);
      const p = progress[t];
      cell.classList.remove('done', 'errors', 'partial');
      if (p.wrong > 0) {
        cell.classList.add('errors');
      } else if (p.answered >= QUESTIONS_PER_TICKET) {
        cell.classList.add('done');
      } else if (p.answered > 0) {
        cell.classList.add('partial');
      }
      cell.title = `Билет ${t}: отвечено ${p.answered} из ${QUESTIONS_PER_TICKET}` + (p.wrong ? `, ошибок ${p.wrong}` : '');
    });
  }

  // ---------------------------------------------------------------------------
  // Rendering — results bar
  // ---------------------------------------------------------------------------

  function renderActiveFilterBadges() {
    const container = elements.activeFilters;
    const f = state.filters;
    container.innerHTML = '';

    const count = state.filteredQuestions.length;
    elements.resultsCount.textContent = `${count} ${pluralize(count, 'вопрос', 'вопроса', 'вопросов')}` +
      (hasActiveFilters() ? ` из ${state.questions.length}` : '');

    // Progress within current selection
    let answered = 0;
    let correct = 0;
    state.filteredQuestions.forEach((q) => {
      const log = state.answersLog[q.id];
      if (log) {
        answered++;
        if (log.isCorrect) correct++;
      }
    });
    const wrong = answered - correct;
    const pct = answered ? Math.round((correct / answered) * 100) : 0;
    elements.resultsProgress.innerHTML = count > 0
      ? `<span>Отвечено <b>${answered}</b> / ${count}</span>` +
        `<span class="ok">✓ ${correct}</span><span class="bad">✗ ${wrong}</span>` +
        (answered ? `<span>Точность <b>${pct}%</b></span>` : '')
      : '';

    const add = (text, onRemove) => container.appendChild(createBadge(text, onRemove));

    if (state.searchQuery.trim()) {
      add(`Поиск: «${state.searchQuery.trim()}»`, () => {
        state.searchQuery = '';
        elements.searchInput.value = '';
        elements.btnClearSearch.hidden = true;
        applyFilters();
      });
    }
    if (f.status !== 'all') {
      add(STATUS_LABELS[f.status], () => setStatus('all'));
    }
    if (f.difficulty !== 'all') {
      add(`Сложность: ${DIFFICULTY_LABELS[f.difficulty].toLowerCase()}`, () => { f.difficulty = 'all'; applyFilters(); });
    }
    CHIP_FACETS.forEach((facet) => {
      const labels = Object.fromEntries(facet.items.map(([id, label]) => [id, label]));
      f[facet.id].forEach((v) => {
        const prefix = facet.id === 'numberKinds' ? 'Число: ' : '';
        add(prefix + (labels[v] || v), () => {
          f[facet.id].delete(v);
          applyFilters({ keepCurrent: true });
        });
      });
    });
    if (f.topics.size > 1) {
      add(f.topicMode === 'and' ? 'Все темы сразу' : 'Любая из тем', () => {
        f.topicMode = f.topicMode === 'and' ? 'or' : 'and';
        applyFilters();
      });
    }
    if (f.tickets.size > 0) {
      const list = [...f.tickets].sort((a, b) => a - b);
      add(`${list.length > 1 ? 'Билеты' : 'Билет'} №${list.join(', ')}`, () => {
        f.tickets.clear();
        applyFilters();
      });
    }
    if (f.block !== 'all') {
      add(BLOCK_LABELS[f.block], () => { f.block = 'all'; applyFilters(); });
    }
    if (f.media !== 'all') {
      add(MEDIA_LABELS[f.media], () => { f.media = 'all'; applyFilters(); });
    }
    if (f.answers !== 'all') {
      add(ANSWERS_LABELS[f.answers], () => { f.answers = 'all'; applyFilters(); });
    }
    if (f.order !== 'seq') {
      add(ORDER_LABELS[f.order], () => { f.order = 'seq'; applyFilters({ keepCurrent: true }); });
    }

    if (container.children.length > 1) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'link-btn badge-clear-all';
      clear.textContent = 'Сбросить всё';
      clear.addEventListener('click', resetAllFilters);
      container.appendChild(clear);
    }
  }

  function createBadge(text, onRemove) {
    const badge = document.createElement('span');
    badge.className = 'active-filter-badge';
    const label = document.createElement('span');
    label.className = 'badge-text';
    label.textContent = text;
    label.title = text;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close-btn';
    close.setAttribute('aria-label', `Убрать фильтр «${text}»`);
    close.innerHTML = '&times;';
    close.addEventListener('click', onRemove);
    badge.appendChild(label);
    badge.appendChild(close);
    return badge;
  }

  // ---------------------------------------------------------------------------
  // Rendering — navigation strip (1, 2, 3 … N)
  // ---------------------------------------------------------------------------

  function navItemClass(q, idx) {
    let cls = 'q-nav-item';
    if (idx === state.currentIndex) cls += ' current';
    const log = state.answersLog[q.id];
    if (log) cls += log.isCorrect ? ' answered-correct' : ' answered-wrong';
    return cls;
  }

  function renderQuestionNavStrip() {
    const strip = elements.questionNavStrip;
    const frag = document.createDocumentFragment();

    state.filteredQuestions.forEach((q, idx) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = navItemClass(q, idx);
      item.textContent = idx + 1;
      item.title = `Билет ${q.ticket}, вопрос ${q.num}`;
      item.dataset.idx = idx;
      frag.appendChild(item);
    });

    strip.innerHTML = '';
    strip.appendChild(frag);
    scrollNavStripToCurrent(false);
  }

  function updateNavStripItem(idx) {
    const item = elements.questionNavStrip.children[idx];
    const q = state.filteredQuestions[idx];
    if (item && q) item.className = navItemClass(q, idx);
  }

  function updateNavStripSelection(prevIdx) {
    if (prevIdx !== undefined && prevIdx !== state.currentIndex) updateNavStripItem(prevIdx);
    updateNavStripItem(state.currentIndex);
    scrollNavStripToCurrent(true);
  }

  // Scrolls only the strip horizontally (never the page)
  function scrollNavStripToCurrent(smooth) {
    const strip = elements.questionNavStrip;
    const item = strip.children[state.currentIndex];
    if (!item) return;
    const left = item.offsetLeft - strip.offsetLeft - (strip.clientWidth - item.offsetWidth) / 2;
    if (typeof strip.scrollTo === 'function') {
      strip.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
    } else {
      strip.scrollLeft = Math.max(0, left);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering — question card
  // ---------------------------------------------------------------------------

  function highlight(text, tokens) {
    const safe = escapeHtml(text);
    if (tokens.length === 0) return safe;
    const parts = tokens
      .map((t) => escapeHtml(t))
      .sort((a, b) => b.length - a.length)
      .map((t) => escapeRegExp(t).replace(/е/g, '[её]'));
    try {
      return safe.replace(new RegExp(`(${parts.join('|')})`, 'gi'), '<mark>$1</mark>');
    } catch (_) {
      return safe;
    }
  }

  function isLocked(q) {
    return !!state.answersLog[q.id] && !state.unlocked.has(q.id);
  }

  const ICON_CHECK = '<svg class="answer-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  const ICON_CROSS = '<svg class="answer-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  function metaChip(text, cls, title, onClick) {
    const chip = document.createElement(onClick ? 'button' : 'span');
    if (onClick) {
      chip.type = 'button';
      chip.addEventListener('click', onClick);
    }
    chip.className = 'q-tag-chip' + (cls ? ' ' + cls : '');
    chip.textContent = text;
    if (title) chip.title = title;
    return chip;
  }

  function renderMetaTags(q, locked) {
    const row = elements.qMetaTags;
    row.innerHTML = '';
    const showOnly = (facetId, value) => () => {
      CHIP_FACETS.forEach((facet) => state.filters[facet.id].clear());
      state.filters[facetId].add(value);
      applyFilters({ targetId: q.id });
    };

    const diff = q.ai.difficulty;
    row.appendChild(metaChip(DIFFICULTY_LABELS[diff], 'diff-' + diff, 'Показать вопросы этой сложности', () => {
      state.filters.difficulty = String(diff);
      applyFilters({ targetId: q.id });
    }));
    if (q.ai.trap) {
      row.appendChild(metaChip('Ловушка', 'tricky',
        locked && q.ai.trap_reason ? q.ai.trap_reason : 'Будьте внимательны — здесь легко ошибиться', showOnly('quick', 'trap')));
    }
    if (q.ai.memorize_number) {
      row.appendChild(metaChip('Число', 'number', 'Нужно знать конкретную норму', showOnly('quick', 'memorize')));
    }
    if (q.ai.format) {
      row.appendChild(metaChip(FORMAT_LABELS[q.ai.format], 'format', 'Показать вопросы такого типа', showOnly('formats', q.ai.format)));
    }
    q.ai.topics.forEach((t) => {
      row.appendChild(metaChip(TOPIC_LABELS[t] || t, '', `Показать только тему «${TOPIC_LABELS[t] || t}»`, showOnly('topics', t)));
    });
    const rate = globalErrorRate(q);
    if (rate !== null && rate >= 0.25) {
      row.appendChild(metaChip(`Ошибаются ${Math.round(rate * 100)}%`, 'global', 'Доля ошибок у всех пользователей'));
    }
  }

  function renderInsights(q, log) {
    const box = elements.qInsights;
    const items = [];
    if (q.ai.key_fact) {
      items.push(`<div class="insight"><span class="insight-label">Запомнить</span><span>${escapeHtml(q.ai.key_fact)}</span></div>`);
    }
    if (q.ai.memorize_number && q.ai.number_value) {
      items.push(`<div class="insight"><span class="insight-label">Норма</span><span class="insight-value">${escapeHtml(q.ai.number_value)}</span></div>`);
    }
    if (q.ai.trap && q.ai.trap_reason) {
      items.push(`<div class="insight insight-trap"><span class="insight-label">Подвох</span><span>${escapeHtml(q.ai.trap_reason)}</span></div>`);
    }
    if (log && log.attempts > 1) {
      items.push(`<div class="insight insight-history"><span class="insight-label">Ваша история</span><span>${log.attempts} ${pluralize(log.attempts, 'попытка', 'попытки', 'попыток')}, ошибок: ${log.wrong}</span></div>`);
    }
    box.innerHTML = items.length
      ? items.join('') + '<div class="insight-note">Подсказки сгенерированы ИИ и могут содержать неточности — сверяйтесь с пояснением.</div>'
      : '';
    box.hidden = items.length === 0;
  }

  function renderCurrentQuestion(options = {}) {
    const { scroll = false } = options;
    const count = state.filteredQuestions.length;

    if (count === 0) {
      elements.questionCard.hidden = true;
      elements.emptyState.hidden = false;
      const f = state.filters;
      if ((f.status === 'wrong' || f.status === 'ever_wrong') && !hasActiveFiltersExceptStatus()) {
        elements.emptyTitle.textContent = 'Ошибок нет';
        elements.emptyDesc.textContent = 'Отлично! Вопросов с ошибками не осталось. Решайте новые вопросы, чтобы пополнить статистику.';
      } else if (f.status === 'favorites' && state.favorites.size === 0) {
        elements.emptyTitle.textContent = 'Избранное пусто';
        elements.emptyDesc.textContent = 'Отмечайте сложные вопросы звездочкой, чтобы вернуться к ним позже.';
      } else {
        elements.emptyTitle.textContent = 'Вопросы не найдены';
        elements.emptyDesc.textContent = 'По выбранной комбинации фильтров нет подходящих вопросов. Попробуйте отключить некоторые фильтры или изменить поиск.';
      }
      updateHash(null);
      return;
    }

    elements.emptyState.hidden = true;
    elements.questionCard.hidden = false;

    const q = state.filteredQuestions[state.currentIndex];
    const log = state.answersLog[q.id];
    const locked = isLocked(q);
    const isFav = state.favorites.has(q.id);
    const tokens = getSearchTokens();
    const justAnswered = state.justAnsweredId === q.id;
    state.justAnsweredId = null;

    // Meta row
    elements.qMetaId.textContent = `Билет ${q.ticket} · Вопрос ${q.num}`;
    let position = `${state.currentIndex + 1} из ${count}`;
    if (log && log.wrong > 0 && !locked) position += ` · ошибок раньше: ${log.wrong}`;
    elements.qPosition.textContent = position;
    renderMetaTags(q, locked);

    // Title
    elements.qTitle.innerHTML = highlight(q.title, tokens);

    // Image
    renderImage(q);

    // Answers
    const answersList = elements.qAnswersList;
    answersList.innerHTML = '';
    q.answers.forEach((ansText, ansIdx) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'answer-item';
      let mark = '';
      if (locked) {
        item.classList.add('locked');
        item.setAttribute('aria-disabled', 'true');
        if (ansIdx === q.correct) {
          item.classList.add('correct');
          mark = ICON_CHECK;
        } else if (ansIdx === log.selectedIndex) {
          item.classList.add('wrong');
          if (justAnswered) item.classList.add('just-answered');
          mark = ICON_CROSS;
        }
      }

      item.innerHTML = `
        <span class="answer-index">${ansIdx + 1}</span>
        <span class="answer-text">${highlight(ansText, tokens)}</span>
        ${mark}
      `;

      if (!locked) {
        item.addEventListener('click', () => handleAnswerSelect(q, ansIdx));
      }

      answersList.appendChild(item);
    });

    // Result + explanation
    const box = elements.qExplanation;
    if (locked) {
      box.hidden = false;
      box.classList.toggle('is-correct', log.isCorrect);
      box.classList.toggle('is-wrong', !log.isCorrect);
      const headingText = log.isCorrect
        ? 'Правильно!'
        : `Ошибка — правильный ответ: ${q.correct + 1}`;
      elements.qExplanationHeading.querySelector('span').textContent = headingText;
      renderInsights(q, log);
      elements.qExplanationText.innerHTML = q.explanation || 'Пояснение к этому вопросу отсутствует.';
      elements.qExplanationText.querySelectorAll('a').forEach((a) => {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      });
    } else {
      box.hidden = true;
      elements.qExplanationText.innerHTML = '';
      elements.qInsights.innerHTML = '';
    }

    // Favorite button
    elements.btnFavorite.classList.toggle('active', isFav);
    elements.btnFavorite.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    elements.btnFavorite.setAttribute('aria-label', isFav ? 'Убрать из избранного' : 'В избранное');
    elements.btnFavoriteLabel.textContent = isFav ? 'В избранном' : 'В избранное';

    // Retry button
    elements.btnRetry.hidden = !locked;

    // Prev / Next button states
    elements.btnPrev.disabled = state.currentIndex === 0;
    elements.btnNext.disabled = state.currentIndex === count - 1;

    // Restart the appear animation
    if (scroll) {
      elements.questionCard.classList.remove('animate');
      void elements.questionCard.offsetWidth;
      elements.questionCard.classList.add('animate');
      scrollCardIntoView();
    }

    if (justAnswered && locked) {
      // Make sure the result is visible on small screens
      requestAnimationFrame(() => {
        const rect = box.getBoundingClientRect();
        if (rect.bottom > window.innerHeight) {
          box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }

    prefetchNeighbourImages();
    updateHash(q);
  }

  function hasActiveFiltersExceptStatus() {
    const f = state.filters;
    return SET_FILTERS.some((k) => f[k].size > 0) || f.media !== 'all' || f.answers !== 'all' ||
      f.block !== 'all' || f.difficulty !== 'all' || state.searchQuery.trim() !== '';
  }

  function renderImage(q) {
    const wrapper = elements.qImageWrapper;
    const img = elements.qImage;
    elements.qImageError.hidden = true;

    if (!q.image) {
      wrapper.hidden = true;
      img.removeAttribute('src');
      return;
    }

    wrapper.hidden = false;
    img.hidden = false;
    elements.btnZoom.hidden = false;
    img.alt = `Иллюстрация к вопросу ${q.num} билета ${q.ticket}`;

    if (img.getAttribute('src') === q.image && img.complete) {
      wrapper.classList.remove('loading');
      return;
    }

    wrapper.classList.add('loading');
    img.style.opacity = '0';
    img.onload = () => {
      wrapper.classList.remove('loading');
      img.style.opacity = '';
    };
    img.onerror = () => {
      wrapper.classList.remove('loading');
      img.style.opacity = '';
      img.hidden = true;
      elements.btnZoom.hidden = true;
      elements.qImageError.hidden = false;
    };
    img.src = q.image;
  }

  function prefetchNeighbourImages() {
    [state.currentIndex + 1, state.currentIndex - 1].forEach((idx) => {
      const q = state.filteredQuestions[idx];
      if (q && q.image) {
        const pre = new Image();
        pre.src = q.image;
      }
    });
  }

  function scrollCardIntoView() {
    const header = document.querySelector('.app-header');
    const headerH = header ? header.offsetHeight : 0;
    const top = elements.questionCard.getBoundingClientRect().top;
    if (top < headerH) {
      window.scrollTo({ top: window.scrollY + top - headerH - 12, behavior: 'auto' });
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function handleAnswerSelect(question, selectedIdx) {
    if (isLocked(question)) return;
    const isCorrect = selectedIdx === question.correct;
    const prev = state.answersLog[question.id];
    const ts = Date.now();
    state.answersLog[question.id] = {
      selectedIndex: selectedIdx,
      isCorrect: isCorrect,
      timestamp: ts,
      attempts: (prev ? prev.attempts : 0) + 1,
      wrong: (prev ? prev.wrong : 0) + (isCorrect ? 0 : 1),
      correct: (prev ? prev.correct : 0) + (isCorrect ? 1 : 0)
    };
    state.unlocked.delete(question.id);
    state.justAnsweredId = question.id;

    saveLocalProgress();
    queueEvent({ type: 'answer', qid: question.id, sel: selectedIdx, ok: isCorrect, ts });
    recalcStats();
    renderTicketsGrid();
    renderFacetCounts(buildPredicates());
    renderActiveFilterBadges();
    updateNavStripItem(state.currentIndex);
    renderCurrentQuestion();
  }

  function goToIndex(idx) {
    if (idx < 0 || idx >= state.filteredQuestions.length || idx === state.currentIndex) return;
    const prev = state.currentIndex;
    state.currentIndex = idx;
    updateNavStripSelection(prev);
    renderCurrentQuestion({ scroll: true });
  }

  function goToPrev() {
    goToIndex(state.currentIndex - 1);
  }

  function goToNext() {
    goToIndex(state.currentIndex + 1);
  }

  function toggleFavorite() {
    if (state.filteredQuestions.length === 0) return;
    const q = state.filteredQuestions[state.currentIndex];
    const on = !state.favorites.has(q.id);
    if (on) {
      state.favorites.add(q.id);
    } else {
      state.favorites.delete(q.id);
    }
    saveLocalProgress();
    queueEvent({ type: 'fav', qid: q.id, on, ts: Date.now() });
    renderFacetCounts(buildPredicates());
    renderCurrentQuestion();
  }

  function retryCurrent() {
    const q = state.filteredQuestions[state.currentIndex];
    if (!q || !isLocked(q)) return;
    state.unlocked.add(q.id);
    renderCurrentQuestion();
  }

  function setStatus(status) {
    if (state.filters.status !== status) {
      state.unlocked.clear();
    }
    state.filters.status = status;
    applyFilters();
  }

  function resetAllFilters() {
    const searchInExplanation = state.filters.searchInExplanation;
    state.filters = freshFilters();
    state.filters.searchInExplanation = searchInExplanation;
    state.searchQuery = '';
    state.unlocked.clear();
    elements.searchInput.value = '';
    elements.btnClearSearch.hidden = true;
    applyFilters();
  }

  function resetProgressStats() {
    const where = state.auth ? ' (на сервере тоже)' : '';
    if (!confirm(`Сбросить всю историю ответов и статистику${where}? Избранное сохранится.`)) return;
    state.answersLog = {};
    state.unlocked.clear();
    saveLocalProgress();
    queueEvent({ type: 'reset', ts: Date.now() });
    recalcStats();
    renderTicketsGrid();
    applyFilters({ keepCurrent: true });
  }

  // ---------------------------------------------------------------------------
  // URL hash: #N — global question number (1..800), e.g. #25 = ticket 2, question 5
  // ---------------------------------------------------------------------------

  function parseHash() {
    const raw = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
    if (!raw) return null;
    const byId = raw.match(/^t(\d+)_q(\d+)$/i);
    if (byId) {
      return QUESTION_BY_GLOBAL.get((Number(byId[1]) - 1) * QUESTIONS_PER_TICKET + Number(byId[2])) || null;
    }
    const num = parseInt(raw.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(num)) return QUESTION_BY_GLOBAL.get(num) || null;
    return null;
  }

  function updateHash(q) {
    try {
      const next = q ? `#${q._global}` : window.location.pathname + window.location.search;
      if (q && window.location.hash === next) return;
      if (!q && !window.location.hash) return;
      history.replaceState(null, '', next);
    } catch (_) {
      // History API unavailable (some file:// contexts)
    }
  }

  function navigateToQuestion(q) {
    if (!q) return;
    const idx = state.filteredQuestions.findIndex((x) => x.id === q.id);
    if (idx >= 0) {
      goToIndex(idx);
      return;
    }
    // Not in the current selection — drop filters and open it
    resetAllFilters();
    applyFilters({ targetId: q.id });
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const color = theme === 'dark' ? '#0b1120' : '#f1f5f9';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
    elements.btnTheme.setAttribute('aria-label', theme === 'dark' ? 'Включить светлую тему' : 'Включить темную тему');
    elements.btnTheme.title = theme === 'dark' ? 'Светлая тема' : 'Темная тема';
  }

  function initTheme() {
    applyTheme(currentTheme());
    elements.btnTheme.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      storageSet(STORAGE_KEY_THEME, next);
      applyTheme(next);
    });
    // Follow the OS theme until the user picks one explicitly
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = (e) => {
        if (!storageGet(STORAGE_KEY_THEME)) applyTheme(e.matches ? 'dark' : 'light');
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  // ---------------------------------------------------------------------------
  // Mobile filter drawer, lightbox & account modal
  // ---------------------------------------------------------------------------

  const drawerQuery = window.matchMedia ? window.matchMedia('(max-width: 1024px)') : null;

  function isDrawerMode() {
    return drawerQuery ? drawerQuery.matches : window.innerWidth <= 1024;
  }

  function openDrawer() {
    if (!isDrawerMode()) return;
    elements.filterPanel.classList.add('open');
    elements.drawerOverlay.hidden = false;
    elements.btnOpenFilters.setAttribute('aria-expanded', 'true');
    document.body.classList.add('no-scroll');
  }

  function closeDrawer() {
    elements.filterPanel.classList.remove('open');
    elements.drawerOverlay.hidden = true;
    elements.btnOpenFilters.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('no-scroll');
  }

  function isDrawerOpen() {
    return elements.filterPanel.classList.contains('open');
  }

  function openLightbox() {
    if (!elements.qImage.src || elements.qImage.hidden) return;
    elements.lightboxImg.src = elements.qImage.src;
    elements.lightbox.hidden = false;
    document.body.classList.add('no-scroll');
  }

  function closeLightbox() {
    elements.lightbox.hidden = true;
    if (!isDrawerOpen()) document.body.classList.remove('no-scroll');
  }

  function openModal() {
    closeDrawer();
    const logged = !!state.auth;
    elements.modalLogin.hidden = logged;
    elements.modalAccount.hidden = !logged;
    elements.loginError.hidden = true;
    elements.modal.hidden = false;
    document.body.classList.add('no-scroll');
    renderAccount();
    if (!logged) setTimeout(() => elements.loginInput.focus(), 30);
  }

  function closeModal() {
    elements.modal.hidden = true;
    if (!isDrawerOpen()) document.body.classList.remove('no-scroll');
  }

  function isModalOpen() {
    return !elements.modal.hidden;
  }

  async function submitLogin(e) {
    e.preventDefault();
    const login = elements.loginInput.value.trim();
    if (!login) return;
    elements.btnLoginSubmit.disabled = true;
    elements.loginError.hidden = true;
    try {
      await doLogin(login);
      closeModal();
    } catch (err) {
      elements.loginError.textContent = err && err.status
        ? err.message
        : 'Сервер недоступен. Попробуйте позже.';
      elements.loginError.hidden = false;
    } finally {
      elements.btnLoginSubmit.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts
  // ---------------------------------------------------------------------------

  function initKeyboardListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (isModalOpen()) { closeModal(); return; }
        if (!elements.lightbox.hidden) { closeLightbox(); return; }
        if (isDrawerOpen()) { closeDrawer(); return; }
        if (document.activeElement === elements.searchInput) elements.searchInput.blur();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target;
      const tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return;
      if (!elements.lightbox.hidden || isDrawerOpen() || isModalOpen()) return;

      // Let focused buttons/links handle Space/Enter natively
      const onControl = tag === 'BUTTON' || tag === 'A';

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNext();
      } else if (e.key === ' ' && !onControl) {
        e.preventDefault();
        goToNext();
      } else if (/^[1-5]$/.test(e.key)) {
        const ansIdx = Number(e.key) - 1;
        const q = state.filteredQuestions[state.currentIndex];
        if (q && !isLocked(q) && ansIdx < q.answers.length) {
          e.preventDefault();
          handleAnswerSelect(q, ansIdx);
        }
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        toggleFavorite();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        retryCurrent();
      } else if (e.code === 'Slash' || e.key === '/') {
        e.preventDefault();
        openDrawer();
        elements.searchInput.focus();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // UI Event Listeners
  // ---------------------------------------------------------------------------

  function bindSegmented(group, handler) {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-value]');
      if (btn && group.contains(btn)) handler(btn.dataset.value);
    });
  }

  function attachEventListeners() {
    elements.btnPrev.addEventListener('click', goToPrev);
    elements.btnNext.addEventListener('click', goToNext);
    elements.btnFavorite.addEventListener('click', toggleFavorite);
    elements.btnRetry.addEventListener('click', retryCurrent);
    elements.btnResetFilters.addEventListener('click', resetAllFilters);
    elements.btnEmptyReset.addEventListener('click', resetAllFilters);
    elements.btnResetStats.addEventListener('click', resetProgressStats);
    elements.btnClearTickets.addEventListener('click', () => {
      state.filters.tickets.clear();
      applyFilters();
    });

    elements.questionNavStrip.addEventListener('click', (e) => {
      const item = e.target.closest('.q-nav-item');
      if (item) goToIndex(Number(item.dataset.idx));
    });

    // Search input with debounce
    let searchTimeout = null;
    elements.searchInput.addEventListener('input', (e) => {
      const value = e.target.value;
      elements.btnClearSearch.hidden = value.length === 0;
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.searchQuery = value;
        applyFilters();
      }, 200);
    });
    elements.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(searchTimeout);
        state.searchQuery = elements.searchInput.value;
        applyFilters();
        elements.searchInput.blur();
        if (isDrawerMode()) closeDrawer();
      }
    });
    elements.btnClearSearch.addEventListener('click', () => {
      clearTimeout(searchTimeout);
      elements.searchInput.value = '';
      elements.btnClearSearch.hidden = true;
      state.searchQuery = '';
      applyFilters();
      elements.searchInput.focus();
    });
    elements.searchInExplanation.addEventListener('change', (e) => {
      state.filters.searchInExplanation = e.target.checked;
      applyFilters();
    });

    // Segmented filters
    bindSegmented(elements.statusGroup, setStatus);
    bindSegmented(elements.tagModeGroup, (v) => { state.filters.topicMode = v; applyFilters(); });
    bindSegmented(elements.difficultyGroup, (v) => {
      // Clicking the active level again clears it
      state.filters.difficulty = state.filters.difficulty === v ? 'all' : v;
      applyFilters({ keepCurrent: true });
    });
    bindSegmented(elements.mediaGroup, (v) => { state.filters.media = v; applyFilters(); });
    bindSegmented(elements.answersGroup, (v) => { state.filters.answers = v; applyFilters(); });
    bindSegmented(elements.blockGroup, (v) => { state.filters.block = v; applyFilters(); });
    bindSegmented(elements.orderGroup, (v) => {
      // Clicking "Вперемешку" again reshuffles
      if (v === 'shuffle') ensureShuffleRank(true);
      state.filters.order = v;
      applyFilters();
    });

    // Drawer
    elements.btnOpenFilters.addEventListener('click', openDrawer);
    elements.btnCloseFilters.addEventListener('click', closeDrawer);
    elements.drawerOverlay.addEventListener('click', closeDrawer);
    elements.btnApplyFilters.addEventListener('click', () => {
      closeDrawer();
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
    if (drawerQuery) {
      const onChange = () => { if (!isDrawerMode()) closeDrawer(); };
      if (drawerQuery.addEventListener) drawerQuery.addEventListener('change', onChange);
      else if (drawerQuery.addListener) drawerQuery.addListener(onChange);
    }

    // Lightbox
    elements.qImage.addEventListener('click', openLightbox);
    elements.btnZoom.addEventListener('click', openLightbox);
    elements.lightbox.addEventListener('click', closeLightbox);

    // Account
    elements.btnAccount.addEventListener('click', openModal);
    elements.accountCard.addEventListener('click', openModal);
    elements.modal.addEventListener('click', (e) => {
      if (e.target === elements.modal || e.target.closest('[data-close-modal]')) closeModal();
    });
    elements.loginForm.addEventListener('submit', submitLogin);
    elements.btnLogout.addEventListener('click', doLogout);
    elements.btnSyncNow.addEventListener('click', () => {
      if (state.outbox.length) flushOutbox(); else pullProgress();
    });

    // Pick up answers made on other devices when coming back to the tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pullProgress();
    });
    window.addEventListener('online', () => flushOutbox());

    // Logo → home
    elements.btnLogo.addEventListener('click', (e) => {
      e.preventDefault();
      closeDrawer();
      resetAllFilters();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Hash navigation (e.g. links like index.html#125)
    window.addEventListener('hashchange', () => {
      const q = parseHash();
      const current = state.filteredQuestions[state.currentIndex];
      if (q && (!current || current.id !== q.id)) navigateToQuestion(q);
    });
  }

  // ---------------------------------------------------------------------------
  // Bootstrap Application
  // ---------------------------------------------------------------------------

  function init() {
    initDOMElements();
    initTheme();
    loadLocalState();
    renderChipFacets();
    renderTicketsGrid();
    attachEventListeners();
    initKeyboardListeners();
    renderAccount();

    const fromHash = parseHash();
    applyFilters({ targetId: fromHash ? fromHash.id : null });
    // Question from the link is filtered out by saved filters — show it anyway
    if (fromHash && !state.filteredQuestions.some((q) => q.id === fromHash.id)) {
      navigateToQuestion(fromHash);
    }

    if (state.auth) {
      setSyncStatus('syncing');
      pullProgress();
    }
    loadGlobalStats();
  }

  // Launch when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
