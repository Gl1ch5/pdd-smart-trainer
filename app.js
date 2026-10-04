/**
 * PDD Smart Trainer - Core Application Logic
 * Pure Vanilla JavaScript ES6+
 */

(function () {
  'use strict';

  const QUESTIONS_PER_TICKET = 20;
  const TICKETS_COUNT = 40;

  // Default filter values (used for reset and for "is filter active" checks)
  const DEFAULT_FILTERS = {
    tickets: [],
    tags: [],
    tagMode: 'and', // 'and' | 'or'
    status: 'all', // 'all' | 'new' | 'wrong' | 'correct' | 'favorites'
    media: 'all', // 'all' | 'image' | 'text'
    answers: 'all', // 'all' | '2' | '3' | '4' (4 = four or more)
    block: 'all', // 'all' | '1'..'4' (questions 1–5, 6–10, 11–15, 16–20)
    order: 'seq', // 'seq' | 'shuffle'
    searchInExplanation: true
  };

  // Master State
  const state = {
    questions: window.PDD_QUESTIONS || [],
    filteredQuestions: [],
    currentIndex: 0,
    filters: {
      tickets: new Set(),
      tags: new Set(),
      tagMode: DEFAULT_FILTERS.tagMode,
      status: DEFAULT_FILTERS.status,
      media: DEFAULT_FILTERS.media,
      answers: DEFAULT_FILTERS.answers,
      block: DEFAULT_FILTERS.block,
      order: DEFAULT_FILTERS.order,
      searchInExplanation: DEFAULT_FILTERS.searchInExplanation
    },
    searchQuery: '',
    answersLog: {}, // { questionId: { selectedIndex, isCorrect, timestamp } }
    favorites: new Set(),
    unlocked: new Set(), // answered questions re-opened for another attempt
    justAnsweredId: null,
    shuffleRank: new Map(),
    stats: {
      correct: 0,
      wrong: 0,
      totalAnswered: 0
    }
  };

  // Tag Metadata Definitions (Labels & Categories)
  const TAG_GROUPS = [
    { id: 'traffic', label: 'Дорожные ситуации' },
    { id: 'rules', label: 'Правила движения' },
    { id: 'elements', label: 'Знаки и разметка' },
    { id: 'tech', label: 'Техника, медицина, право' },
    { id: 'special', label: 'Особые темы' }
  ];

  const TAG_DEFINITIONS = [
    { id: 'numbers', label: 'Числа и цифры', group: 'special', desc: 'Вопросы со скоростями, метрами, сроками и процентами' },
    { id: 'pedestrians', label: 'Пешеходы и переходы', group: 'traffic', desc: 'Зебры, уступить дорогу, слепые пешеходы' },
    { id: 'tram_adjuster', label: 'Трамваи и регулировщик', group: 'traffic', desc: 'Трамвайные пути, жезлы, сигналы регулировщика' },
    { id: 'intersections', label: 'Перекрестки', group: 'traffic', desc: 'Главная дорога, помеха справа, круговое движение' },
    { id: 'parking', label: 'Остановка и стоянка', group: 'rules', desc: 'По четным/нечетным, метры до остановок, знаки парковки' },
    { id: 'speed', label: 'Скоростной режим', group: 'rules', desc: 'Ограничения в городе, за городом, автомагистраль' },
    { id: 'distance', label: 'Дистанция и интервал', group: 'rules', desc: 'Метры, безопасная дистанция, время реакции' },
    { id: 'overtaking', label: 'Обгон и разъезд', group: 'rules', desc: 'Выезд на встречную, опережение, узкие участки' },
    { id: 'maneuvering', label: 'Маневрирование', group: 'rules', desc: 'Повороты, развороты, перестроения, поворотники' },
    { id: 'signs', label: 'Дорожные знаки', group: 'elements', desc: 'Предупреждающие, запрещающие, предписывающие' },
    { id: 'markings', label: 'Дорожная разметка', group: 'elements', desc: 'Сплошные, прерывистые, стоп-линии, стрелки' },
    { id: 'malfunctions', label: 'Неисправности авто', group: 'tech', desc: 'Люфты, глубина протектора, фары, стеклоочистители' },
    { id: 'medicine', label: 'Первая помощь', group: 'tech', desc: 'Жгуты, сердечно-легочная реанимация, кровотечения' },
    { id: 'law_duties', label: 'Штрафы и законы', group: 'tech', desc: 'Лишение прав, ОСАГО, оформление ДТП, документы' },
    { id: 'towing', label: 'Буксировка и прицепы', group: 'special', desc: 'Сцепка, масса прицепа, буксировка в гололед' },
    { id: 'railway', label: 'Ж/Д переезды', group: 'special', desc: 'Дистанция до шлагбаума и рельсов, запреты' },
    { id: 'highway', label: 'Автомагистрали', group: 'special', desc: 'Въезд, остановка на обочине, минимальная скорость' },
    { id: 'tricky', label: 'Вопросы-ловушки', group: 'special', desc: 'Сложные вопросы с высоким процентом ошибок' },
    // Media tags are handled by the dedicated "Тип вопроса" control
    { id: 'has_image', label: 'С картинкой', group: 'media', desc: 'Ситуации с графическими дорожными картинками' },
    { id: 'text_only', label: 'Без картинки', group: 'media', desc: 'Чисто теоретические текстовые вопросы' }
  ];

  const TAG_BY_ID = new Map(TAG_DEFINITIONS.map((t) => [t.id, t]));

  const STATUS_LABELS = { new: 'Новые', wrong: 'Мои ошибки', correct: 'Верные', favorites: 'Избранное' };
  const MEDIA_LABELS = { image: 'С картинкой', text: 'Без картинки' };
  const ANSWERS_LABELS = { 2: '2 варианта', 3: '3 варианта', 4: '4+ варианта' };
  const BLOCK_LABELS = { 1: 'Вопросы 1–5', 2: 'Вопросы 6–10', 3: 'Вопросы 11–15', 4: 'Вопросы 16–20' };

  // LocalStorage Persistence Keys
  const STORAGE_KEY_ANSWERS = 'pdd_smart_answers_v1';
  const STORAGE_KEY_FAVS = 'pdd_smart_favs_v1';
  const STORAGE_KEY_FILTERS = 'pdd_smart_filters_v2';
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

  // Precompute search corpora once
  state.questions.forEach((q) => {
    q._searchMain = normalizeText(q.title + ' ' + q.answers.join(' '));
    q._searchExpl = normalizeText(stripHtml(q.explanation || ''));
    q._global = globalNumber(q);
  });

  const QUESTION_BY_GLOBAL = new Map(state.questions.map((q) => [q._global, q]));
  const QUESTION_BY_ID = new Map(state.questions.map((q) => [q.id, q]));

  // ---------------------------------------------------------------------------
  // Persistence (LocalStorage + optional backend API sync)
  // ---------------------------------------------------------------------------

  function loadLocalState() {
    try {
      const savedAnswers = storageGet(STORAGE_KEY_ANSWERS);
      if (savedAnswers) {
        const parsed = JSON.parse(savedAnswers);
        if (parsed && typeof parsed === 'object') state.answersLog = parsed;
      }
      const savedFavs = storageGet(STORAGE_KEY_FAVS);
      if (savedFavs) {
        const parsed = JSON.parse(savedFavs);
        if (Array.isArray(parsed)) state.favorites = new Set(parsed);
      }
      const savedFilters = storageGet(STORAGE_KEY_FILTERS);
      if (savedFilters) {
        const f = JSON.parse(savedFilters);
        if (f && typeof f === 'object') {
          const valid = (v, allowed) => (allowed.includes(v) ? v : undefined);
          state.filters.tickets = new Set((f.tickets || []).filter((t) => t >= 1 && t <= TICKETS_COUNT));
          state.filters.tags = new Set((f.tags || []).filter((t) => TAG_BY_ID.has(t) && TAG_BY_ID.get(t).group !== 'media'));
          state.filters.tagMode = valid(f.tagMode, ['and', 'or']) || DEFAULT_FILTERS.tagMode;
          state.filters.status = valid(f.status, ['all', 'new', 'wrong', 'correct', 'favorites']) || DEFAULT_FILTERS.status;
          state.filters.media = valid(f.media, ['all', 'image', 'text']) || DEFAULT_FILTERS.media;
          state.filters.answers = valid(f.answers, ['all', '2', '3', '4']) || DEFAULT_FILTERS.answers;
          state.filters.block = valid(f.block, ['all', '1', '2', '3', '4']) || DEFAULT_FILTERS.block;
          state.filters.order = valid(f.order, ['seq', 'shuffle']) || DEFAULT_FILTERS.order;
          state.filters.searchInExplanation = f.searchInExplanation !== false;
        }
      }
    } catch (e) {
      console.warn('Persistence load error:', e);
    }
    recalcStats();
  }

  async function syncWithBackend() {
    // Only meaningful when served by server.py (not from file:// or static hosting)
    if (!/^https?:$/.test(window.location.protocol)) return;
    try {
      const resp = await fetch('/api/progress', { cache: 'no-store' });
      if (!resp.ok) return;
      const remote = await resp.json();
      let changed = false;

      if (remote.answersLog && typeof remote.answersLog === 'object') {
        for (const id in remote.answersLog) {
          const r = remote.answersLog[id];
          const l = state.answersLog[id];
          if (!QUESTION_BY_ID.has(id) || !r) continue;
          // Newer answer wins
          if (!l || (r.timestamp || 0) > (l.timestamp || 0)) {
            state.answersLog[id] = r;
            changed = true;
          }
        }
      }
      if (Array.isArray(remote.favorites)) {
        remote.favorites.forEach((id) => {
          if (QUESTION_BY_ID.has(id) && !state.favorites.has(id)) {
            state.favorites.add(id);
            changed = true;
          }
        });
      }

      if (changed) {
        storageSet(STORAGE_KEY_ANSWERS, JSON.stringify(state.answersLog));
        storageSet(STORAGE_KEY_FAVS, JSON.stringify([...state.favorites]));
        recalcStats();
        renderTicketsGrid();
        applyFilters({ keepCurrent: true });
      }
    } catch (_) {
      // Backend not running — local storage is used seamlessly
    }
  }

  let backendSaveTimer = null;

  function savePersistedState() {
    storageSet(STORAGE_KEY_ANSWERS, JSON.stringify(state.answersLog));
    storageSet(STORAGE_KEY_FAVS, JSON.stringify([...state.favorites]));

    if (!/^https?:$/.test(window.location.protocol)) return;
    clearTimeout(backendSaveTimer);
    backendSaveTimer = setTimeout(() => {
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answersLog: state.answersLog,
          favorites: [...state.favorites]
        })
      }).catch(() => {});
    }, 400);
  }

  function saveFilters() {
    const f = state.filters;
    storageSet(STORAGE_KEY_FILTERS, JSON.stringify({
      tickets: [...f.tickets],
      tags: [...f.tags],
      tagMode: f.tagMode,
      status: f.status,
      media: f.media,
      answers: f.answers,
      block: f.block,
      order: f.order,
      searchInExplanation: f.searchInExplanation
    }));
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

  // ---------------------------------------------------------------------------
  // DOM Elements Cache
  // ---------------------------------------------------------------------------

  const elements = {};

  function initDOMElements() {
    const ids = [
      'tagsContainer', 'ticketsGrid', 'searchInput', 'btnClearSearch', 'searchInExplanation',
      'resultsCount', 'resultsProgress', 'activeFilters', 'questionNavStrip', 'questionCard',
      'emptyState', 'emptyTitle', 'emptyDesc', 'btnEmptyReset',
      'statCorrect', 'statWrong', 'statTotal', 'statProgress',
      'btnPrev', 'btnNext', 'btnFavorite', 'btnFavoriteLabel', 'btnRetry',
      'btnResetFilters', 'btnResetStats', 'btnClearTickets',
      'statusGroup', 'statusHint', 'tagModeGroup', 'mediaGroup', 'answersGroup', 'blockGroup', 'orderGroup',
      'qMetaId', 'qPosition', 'qMetaTags', 'qTitle', 'qImageWrapper', 'qImage', 'qImageError', 'btnZoom',
      'qAnswersList', 'qExplanation', 'qExplanationHeading', 'qExplanationText',
      'btnTheme', 'btnOpenFilters', 'btnCloseFilters', 'btnApplyFilters', 'filterPanel', 'drawerOverlay', 'filtersDot',
      'lightbox', 'lightboxImg', 'btnLogo'
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

  /**
   * Builds a predicate for every filter dimension so that counts can be
   * calculated "as if" one dimension were not applied (faceted search).
   */
  function buildPredicates() {
    const f = state.filters;
    const tokens = getSearchTokens();

    return {
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
      status: (q) => statusMatches(q, f.status),
      tags: (q) => tagsMatch(q, f.tags, f.tagMode),
      search: (q) => {
        if (tokens.length === 0) return true;
        const corpus = f.searchInExplanation ? q._searchMain + ' ' + q._searchExpl : q._searchMain;
        return tokens.every((t) => corpus.includes(t));
      }
    };
  }

  function statusMatches(q, status) {
    const log = state.answersLog[q.id];
    switch (status) {
      case 'new': return !log;
      case 'wrong': return !!log && !log.isCorrect;
      case 'correct': return !!log && log.isCorrect;
      case 'favorites': return state.favorites.has(q.id);
      default: return true;
    }
  }

  function tagsMatch(q, tags, mode) {
    if (tags.size === 0) return true;
    const qTags = q.tags || [];
    if (mode === 'or') {
      for (const t of tags) if (qTags.includes(t)) return true;
      return false;
    }
    for (const t of tags) if (!qTags.includes(t)) return false;
    return true;
  }

  function passesAll(q, preds, skip) {
    for (const key in preds) {
      if (key !== skip && !preds[key](q)) return false;
    }
    return true;
  }

  function applyFilters(options = {}) {
    const { keepCurrent = false, targetId = null } = options;
    const prevId = targetId || (keepCurrent && state.filteredQuestions[state.currentIndex]
      ? state.filteredQuestions[state.currentIndex].id
      : null);

    const preds = buildPredicates();
    let list = state.questions.filter((q) => passesAll(q, preds));

    if (state.filters.order === 'shuffle') {
      ensureShuffleRank();
      list = list.slice().sort((a, b) => state.shuffleRank.get(a.id) - state.shuffleRank.get(b.id));
    }

    state.filteredQuestions = list;

    // In "Мои ошибки" mode wrong questions are opened for another attempt
    if (state.filters.status === 'wrong') {
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
    return f.tickets.size > 0 || f.tags.size > 0 || f.status !== 'all' || f.media !== 'all' ||
      f.answers !== 'all' || f.block !== 'all' || state.searchQuery.trim() !== '';
  }

  // ---------------------------------------------------------------------------
  // Rendering — header stats
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

  // ---------------------------------------------------------------------------
  // Rendering — sidebar
  // ---------------------------------------------------------------------------

  function renderTagsList() {
    const container = elements.tagsContainer;
    container.innerHTML = '';

    TAG_GROUPS.forEach((group) => {
      const defs = TAG_DEFINITIONS.filter((t) => t.group === group.id);
      if (defs.length === 0) return;

      const wrap = document.createElement('div');
      wrap.className = 'tag-group';
      const title = document.createElement('div');
      title.className = 'tag-group-title';
      title.textContent = group.label;
      const grid = document.createElement('div');
      grid.className = 'tag-grid';

      defs.forEach((tagDef) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip-btn';
        chip.dataset.tag = tagDef.id;
        chip.title = tagDef.desc;
        chip.innerHTML = `<span>${escapeHtml(tagDef.label)}</span><span class="chip-count"></span>`;
        chip.addEventListener('click', () => toggleTag(tagDef.id));
        grid.appendChild(chip);
      });

      wrap.appendChild(title);
      wrap.appendChild(grid);
      container.appendChild(wrap);
    });
  }

  function toggleTag(tagId) {
    if (state.filters.tags.has(tagId)) {
      state.filters.tags.delete(tagId);
    } else {
      state.filters.tags.add(tagId);
    }
    applyFilters();
  }

  // Facet counts: how many questions each option would yield with the other filters applied
  function renderFacetCounts(preds) {
    const f = state.filters;

    // Tag chips
    const baseForTags = state.questions.filter((q) => passesAll(q, preds, 'tags'));
    elements.tagsContainer.querySelectorAll('.chip-btn').forEach((chip) => {
      const tagId = chip.dataset.tag;
      const active = f.tags.has(tagId);
      let count;
      if (f.tagMode === 'and') {
        const combined = new Set(f.tags);
        combined.add(tagId);
        count = baseForTags.filter((q) => tagsMatch(q, combined, 'and')).length;
      } else {
        count = baseForTags.filter((q) => (q.tags || []).includes(tagId)).length;
      }
      chip.classList.toggle('active', active);
      chip.classList.toggle('dim', !active && count === 0);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
      chip.querySelector('.chip-count').textContent = count;
    });

    // Status counts
    const baseForStatus = state.questions.filter((q) => passesAll(q, preds, 'status'));
    ['all', 'new', 'wrong', 'correct', 'favorites'].forEach((status) => {
      const el = elements.statusGroup.querySelector(`[data-count="${status}"]`);
      if (el) el.textContent = baseForStatus.filter((q) => statusMatches(q, status)).length;
    });

    // Segmented controls state
    syncSegmented(elements.statusGroup, f.status);
    syncSegmented(elements.tagModeGroup, f.tagMode);
    syncSegmented(elements.mediaGroup, f.media);
    syncSegmented(elements.answersGroup, f.answers);
    syncSegmented(elements.blockGroup, f.block);
    syncSegmented(elements.orderGroup, f.order);
    elements.statusHint.hidden = f.status !== 'wrong';
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
    f.tags.forEach((tagId) => {
      const def = TAG_BY_ID.get(tagId);
      add(def ? def.label : tagId, () => {
        f.tags.delete(tagId);
        applyFilters();
      });
    });
    if (f.tags.size > 1) {
      add(f.tagMode === 'and' ? 'Все темы сразу' : 'Любая из тем', () => {
        f.tagMode = f.tagMode === 'and' ? 'or' : 'and';
        applyFilters();
      });
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

  function renderCurrentQuestion(options = {}) {
    const { scroll = false } = options;
    const count = state.filteredQuestions.length;

    if (count === 0) {
      elements.questionCard.hidden = true;
      elements.emptyState.hidden = false;
      const f = state.filters;
      if (f.status === 'wrong' && !state.searchQuery && f.tags.size === 0 && f.tickets.size === 0) {
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
    elements.qPosition.textContent = `${state.currentIndex + 1} из ${count}`;

    // Tags (click to filter by tag)
    const tagsRow = elements.qMetaTags;
    tagsRow.innerHTML = '';
    (q.tags || []).forEach((t) => {
      const def = TAG_BY_ID.get(t);
      if (!def || def.group === 'media') return;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'q-tag-chip' + (t === 'tricky' ? ' tricky' : '');
      chip.textContent = def.label;
      chip.title = `Показать только тему «${def.label}»`;
      chip.addEventListener('click', () => {
        state.filters.tags = new Set([t]);
        applyFilters({ targetId: q.id });
      });
      tagsRow.appendChild(chip);
    });

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
      elements.qExplanationText.innerHTML = q.explanation || 'Пояснение к этому вопросу отсутствует.';
      elements.qExplanationText.querySelectorAll('a').forEach((a) => {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      });
    } else {
      box.hidden = true;
      elements.qExplanationText.innerHTML = '';
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
    state.answersLog[question.id] = {
      selectedIndex: selectedIdx,
      isCorrect: isCorrect,
      timestamp: Date.now()
    };
    state.unlocked.delete(question.id);
    state.justAnsweredId = question.id;

    savePersistedState();
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
    if (state.favorites.has(q.id)) {
      state.favorites.delete(q.id);
    } else {
      state.favorites.add(q.id);
    }
    savePersistedState();
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
    const f = state.filters;
    f.tickets.clear();
    f.tags.clear();
    f.tagMode = DEFAULT_FILTERS.tagMode;
    f.status = DEFAULT_FILTERS.status;
    f.media = DEFAULT_FILTERS.media;
    f.answers = DEFAULT_FILTERS.answers;
    f.block = DEFAULT_FILTERS.block;
    f.order = DEFAULT_FILTERS.order;
    f.searchInExplanation = DEFAULT_FILTERS.searchInExplanation;
    state.searchQuery = '';
    state.unlocked.clear();
    elements.searchInput.value = '';
    elements.btnClearSearch.hidden = true;
    applyFilters();
  }

  function resetProgressStats() {
    if (!confirm('Сбросить всю историю ответов и статистику? Избранное сохранится.')) return;
    state.answersLog = {};
    state.unlocked.clear();
    savePersistedState();
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
  // Mobile filter drawer & lightbox
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

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts
  // ---------------------------------------------------------------------------

  function initKeyboardListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!elements.lightbox.hidden) { closeLightbox(); return; }
        if (isDrawerOpen()) { closeDrawer(); return; }
        if (document.activeElement === elements.searchInput) elements.searchInput.blur();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target;
      const tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return;
      if (!elements.lightbox.hidden || isDrawerOpen()) return;

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
    bindSegmented(elements.tagModeGroup, (v) => { state.filters.tagMode = v; applyFilters(); });
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
    renderTagsList();
    renderTicketsGrid();
    attachEventListeners();
    initKeyboardListeners();

    const fromHash = parseHash();
    applyFilters({ targetId: fromHash ? fromHash.id : null });
    // Question from the link is filtered out by saved filters — show it anyway
    if (fromHash && !state.filteredQuestions.some((q) => q.id === fromHash.id)) {
      navigateToQuestion(fromHash);
    }

    syncWithBackend();
  }

  // Launch when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
