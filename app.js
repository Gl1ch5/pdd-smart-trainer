/**
 * PDD Smart Trainer - Core Application Logic
 * Pure Vanilla JavaScript ES6+
 */

(function () {
  'use strict';

  // Master State
  const state = {
    questions: window.PDD_QUESTIONS || [],
    filteredQuestions: [],
    currentIndex: 0,
    activeTicket: null, // null means all tickets
    activeTags: new Set(),
    searchQuery: '',
    onlyErrors: false,
    onlyFavorites: false,
    answersLog: {}, // { questionId: { selectedIndex, isCorrect, timestamp } }
    favorites: new Set(),
    stats: {
      correct: 0,
      wrong: 0,
      totalAnswered: 0
    }
  };

  // Tag Metadata Definitions (Labels & Categories)
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
    { id: 'has_image', label: 'Только с фото', group: 'media', desc: 'Ситуации с графическими дорожными картинками' },
    { id: 'text_only', label: 'Только текст', group: 'media', desc: 'Чисто теоретические текстовые вопросы' }
  ];

  // LocalStorage Persistence Keys
  const STORAGE_KEY_ANSWERS = 'pdd_smart_answers_v1';
  const STORAGE_KEY_FAVS = 'pdd_smart_favs_v1';

  // Load Saved Data (Both LocalStorage + Backend API sync)
  async function loadPersistedState() {
    try {
      const savedAnswers = localStorage.getItem(STORAGE_KEY_ANSWERS);
      if (savedAnswers) {
        state.answersLog = JSON.parse(savedAnswers);
        recalcStats();
      }
      const savedFavs = localStorage.getItem(STORAGE_KEY_FAVS);
      if (savedFavs) {
        state.favorites = new Set(JSON.parse(savedFavs));
      }

      // Also try sync with backend API if available
      try {
        const resp = await fetch('/api/progress', { cache: 'no-store' });
        if (resp.ok) {
          const remote = await resp.json();
          if (remote.answersLog && Object.keys(remote.answersLog).length > 0) {
            state.answersLog = { ...state.answersLog, ...remote.answersLog };
          }
          if (remote.favorites && Array.isArray(remote.favorites)) {
            remote.favorites.forEach((id) => state.favorites.add(id));
          }
          recalcStats();
          renderQuestionNavStrip();
          renderCurrentQuestion();
        }
      } catch (_) {
        // Backend not running, local storage used seamlessly
      }
    } catch (e) {
      console.warn('Persistence load error:', e);
    }
  }

  function savePersistedState() {
    try {
      localStorage.setItem(STORAGE_KEY_ANSWERS, JSON.stringify(state.answersLog));
      localStorage.setItem(STORAGE_KEY_FAVS, JSON.stringify([...state.favorites]));

      // Also push to backend API asynchronously
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answersLog: state.answersLog,
          favorites: [...state.favorites]
        })
      }).catch(() => {});
    } catch (e) {
      console.warn('Persistence save error:', e);
    }
  }

  function recalcStats() {
    let correct = 0;
    let wrong = 0;
    for (const id in state.answersLog) {
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

  // DOM Elements Cache
  const elements = {};

  function initDOMElements() {
    elements.tagsContainer = document.getElementById('tagsContainer');
    elements.ticketsGrid = document.getElementById('ticketsGrid');
    elements.searchInput = document.getElementById('searchInput');
    elements.resultsCount = document.getElementById('resultsCount');
    elements.activeFiltersContainer = document.getElementById('activeFilters');
    elements.questionNavStrip = document.getElementById('questionNavStrip');
    elements.questionCard = document.getElementById('questionCard');
    elements.emptyState = document.getElementById('emptyState');
    elements.statCorrect = document.getElementById('statCorrect');
    elements.statWrong = document.getElementById('statWrong');
    elements.statTotal = document.getElementById('statTotal');
    elements.btnPrev = document.getElementById('btnPrev');
    elements.btnNext = document.getElementById('btnNext');
    elements.btnFavorite = document.getElementById('btnFavorite');
    elements.btnResetFilters = document.getElementById('btnResetFilters');
    elements.btnResetStats = document.getElementById('btnResetStats');
    elements.btnFilterErrors = document.getElementById('btnFilterErrors');
    elements.btnFilterFavs = document.getElementById('btnFilterFavs');
    elements.btnAllQuestions = document.getElementById('btnAllQuestions');
  }

  // Filter Algorithm
  function applyFilters() {
    const query = state.searchQuery.toLowerCase().trim();
    
    state.filteredQuestions = state.questions.filter((q) => {
      // 1. Ticket filter
      if (state.activeTicket !== null && q.ticket !== state.activeTicket) {
        return false;
      }

      // 2. Only Errors filter
      if (state.onlyErrors) {
        const log = state.answersLog[q.id];
        if (!log || log.isCorrect) return false;
      }

      // 3. Only Favorites filter
      if (state.onlyFavorites) {
        if (!state.favorites.has(q.id)) return false;
      }

      // 4. Semantic Tags (All selected tags must match)
      if (state.activeTags.size > 0) {
        for (const tag of state.activeTags) {
          if (!q.tags || !q.tags.includes(tag)) {
            return false;
          }
        }
      }

      // 5. Full text search query
      if (query.length > 0) {
        const searchCorpus = (q.title + ' ' + q.answers.join(' ') + ' ' + (q.explanation || '')).toLowerCase();
        if (!searchCorpus.includes(query)) {
          return false;
        }
      }

      return true;
    });

    // Reset current index to 0 when filter changes
    state.currentIndex = 0;

    renderActiveFilterBadges();
    renderQuestionNavStrip();
    renderCurrentQuestion();
  }

  // UI Rendering - Header Stats
  function updateStatsHeader() {
    if (elements.statCorrect) elements.statCorrect.textContent = state.stats.correct;
    if (elements.statWrong) elements.statWrong.textContent = state.stats.wrong;
    if (elements.statTotal) elements.statTotal.textContent = `${state.stats.totalAnswered} / 800`;
  }

  // UI Rendering - Sidebar Tags with Dynamic Count
  function renderTagsList() {
    if (!elements.tagsContainer) return;
    elements.tagsContainer.innerHTML = '';

    // Calculate count per tag based on entire questions DB
    const counts = {};
    state.questions.forEach((q) => {
      if (q.tags) {
        q.tags.forEach((t) => {
          counts[t] = (counts[t] || 0) + 1;
        });
      }
    });

    TAG_DEFINITIONS.forEach((tagDef) => {
      const count = counts[tagDef.id] || 0;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `chip-btn ${state.activeTags.has(tagDef.id) ? 'active' : ''}`;
      chip.title = tagDef.desc;
      chip.innerHTML = `
        <span>${tagDef.label}</span>
        <span class="chip-count">${count}</span>
      `;
      chip.addEventListener('click', () => {
        if (state.activeTags.has(tagDef.id)) {
          state.activeTags.delete(tagDef.id);
        } else {
          state.activeTags.add(tagDef.id);
        }
        renderTagsList();
        applyFilters();
      });
      elements.tagsContainer.appendChild(chip);
    });
  }

  // UI Rendering - Quick 1..40 Tickets Grid
  function renderTicketsGrid() {
    if (!elements.ticketsGrid) return;
    elements.ticketsGrid.innerHTML = '';

    for (let t = 1; t <= 40; t++) {
      const cell = document.createElement('div');
      cell.className = `ticket-cell ${state.activeTicket === t ? 'active' : ''}`;
      cell.textContent = t;
      cell.title = `Билет ${t}`;
      cell.addEventListener('click', () => {
        if (state.activeTicket === t) {
          state.activeTicket = null; // deselect
        } else {
          state.activeTicket = t;
        }
        renderTicketsGrid();
        applyFilters();
      });
      elements.ticketsGrid.appendChild(cell);
    }
  }

  // UI Rendering - Active Filters Row
  function renderActiveFilterBadges() {
    if (!elements.activeFiltersContainer) return;
    elements.activeFiltersContainer.innerHTML = '';

    elements.resultsCount.textContent = `Найдено вопросов: ${state.filteredQuestions.length}`;

    if (state.activeTicket !== null) {
      const badge = createBadge(`Билет №${state.activeTicket}`, () => {
        state.activeTicket = null;
        renderTicketsGrid();
        applyFilters();
      });
      elements.activeFiltersContainer.appendChild(badge);
    }

    if (state.onlyErrors) {
      const badge = createBadge('Мои ошибки', () => {
        state.onlyErrors = false;
        elements.btnFilterErrors.classList.remove('active');
        applyFilters();
      });
      elements.activeFiltersContainer.appendChild(badge);
    }

    if (state.onlyFavorites) {
      const badge = createBadge('Избранное', () => {
        state.onlyFavorites = false;
        elements.btnFilterFavs.classList.remove('active');
        applyFilters();
      });
      elements.activeFiltersContainer.appendChild(badge);
    }

    state.activeTags.forEach((tagId) => {
      const tagDef = TAG_DEFINITIONS.find((t) => t.id === tagId);
      const label = tagDef ? tagDef.label : tagId;
      const badge = createBadge(label, () => {
        state.activeTags.delete(tagId);
        renderTagsList();
        applyFilters();
      });
      elements.activeFiltersContainer.appendChild(badge);
    });
  }

  function createBadge(text, onRemove) {
    const badge = document.createElement('span');
    badge.className = 'active-filter-badge';
    badge.innerHTML = `
      <span>${text}</span>
      <span class="close-btn">&times;</span>
    `;
    badge.querySelector('.close-btn').addEventListener('click', onRemove);
    return badge;
  }

  // UI Rendering - Navigation Strip (1, 2, 3... N)
  function renderQuestionNavStrip() {
    if (!elements.questionNavStrip) return;
    elements.questionNavStrip.innerHTML = '';

    if (state.filteredQuestions.length === 0) return;

    state.filteredQuestions.forEach((q, idx) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'q-nav-item';
      item.textContent = idx + 1;

      if (idx === state.currentIndex) {
        item.classList.add('current');
      }

      // Check answered status
      const log = state.answersLog[q.id];
      if (log) {
        if (log.isCorrect) {
          item.classList.add('answered-correct');
        } else {
          item.classList.add('answered-wrong');
        }
      }

      item.addEventListener('click', () => {
        state.currentIndex = idx;
        updateNavStripSelection();
        renderCurrentQuestion();
      });

      elements.questionNavStrip.appendChild(item);
    });
  }

  function updateNavStripSelection() {
    const items = elements.questionNavStrip.querySelectorAll('.q-nav-item');
    items.forEach((item, idx) => {
      if (idx === state.currentIndex) {
        item.classList.add('current');
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } else {
        item.classList.remove('current');
      }
    });
  }

  // UI Rendering - Current Question Card
  function renderCurrentQuestion() {
    if (state.filteredQuestions.length === 0) {
      elements.questionCard.style.display = 'none';
      elements.emptyState.style.display = 'flex';
      return;
    }

    elements.emptyState.style.display = 'none';
    elements.questionCard.style.display = 'flex';

    const q = state.filteredQuestions[state.currentIndex];
    const log = state.answersLog[q.id];
    const isAnswered = !!log;
    const isFav = state.favorites.has(q.id);

    // Meta row
    const idTag = document.getElementById('qMetaId');
    const tagsRow = document.getElementById('qMetaTags');
    const titleEl = document.getElementById('qTitle');
    const imgWrapper = document.getElementById('qImageWrapper');
    const imgEl = document.getElementById('qImage');
    const answersList = document.getElementById('qAnswersList');
    const explanationBox = document.getElementById('qExplanation');
    const explanationText = document.getElementById('qExplanationText');

    if (idTag) idTag.textContent = `Билет ${q.ticket} · Вопрос ${q.num}`;

    // Tags
    if (tagsRow) {
      tagsRow.innerHTML = '';
      if (q.tags) {
        q.tags.forEach((t) => {
          const def = TAG_DEFINITIONS.find((d) => d.id === t);
          const span = document.createElement('span');
          span.className = 'q-tag-chip';
          span.textContent = def ? def.label : t;
          tagsRow.appendChild(span);
        });
      }
    }

    // Title
    if (titleEl) titleEl.textContent = q.title;

    // Image
    if (q.image && q.image.length > 0) {
      imgWrapper.style.display = 'flex';
      imgEl.src = q.image;
      imgEl.alt = `Вопрос ${q.num}`;
    } else {
      imgWrapper.style.display = 'none';
      imgEl.src = '';
    }

    // Answers
    answersList.innerHTML = '';
    q.answers.forEach((ansText, ansIdx) => {
      const item = document.createElement('div');
      item.className = 'answer-item';
      if (isAnswered) {
        item.classList.add('locked');
        if (ansIdx === q.correct) {
          item.classList.add('correct');
        } else if (ansIdx === log.selectedIndex) {
          item.classList.add('wrong');
        }
      }

      item.innerHTML = `
        <div class="answer-index">${ansIdx + 1}</div>
        <div class="answer-text">${ansText}</div>
      `;

      if (!isAnswered) {
        item.addEventListener('click', () => handleAnswerSelect(q, ansIdx));
      }

      answersList.appendChild(item);
    });

    // Explanation
    if (isAnswered && q.explanation) {
      explanationBox.style.display = 'flex';
      explanationText.innerHTML = q.explanation;
    } else {
      explanationBox.style.display = 'none';
    }

    // Favorite Button update
    if (elements.btnFavorite) {
      if (isFav) {
        elements.btnFavorite.classList.add('active');
        elements.btnFavorite.innerHTML = `
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          <span>В избранном</span>
        `;
      } else {
        elements.btnFavorite.classList.remove('active');
        elements.btnFavorite.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          <span>В избранное</span>
        `;
      }
    }

    // Prev / Next button states
    if (elements.btnPrev) elements.btnPrev.disabled = state.currentIndex === 0;
    if (elements.btnNext) elements.btnNext.disabled = state.currentIndex === state.filteredQuestions.length - 1;
  }

  // Answer selection handler
  function handleAnswerSelect(question, selectedIdx) {
    const isCorrect = selectedIdx === question.correct;
    state.answersLog[question.id] = {
      selectedIndex: selectedIdx,
      isCorrect: isCorrect,
      timestamp: Date.now()
    };

    savePersistedState();
    recalcStats();
    renderQuestionNavStrip();
    renderCurrentQuestion();
  }

  // Navigation handlers
  function goToPrev() {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      updateNavStripSelection();
      renderCurrentQuestion();
    }
  }

  function goToNext() {
    if (state.currentIndex < state.filteredQuestions.length - 1) {
      state.currentIndex++;
      updateNavStripSelection();
      renderCurrentQuestion();
    }
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
    renderCurrentQuestion();
  }

  // Reset Actions
  function resetAllFilters() {
    state.activeTicket = null;
    state.activeTags.clear();
    state.searchQuery = '';
    state.onlyErrors = false;
    state.onlyFavorites = false;
    if (elements.searchInput) elements.searchInput.value = '';
    if (elements.btnFilterErrors) elements.btnFilterErrors.classList.remove('active');
    if (elements.btnFilterFavs) elements.btnFilterFavs.classList.remove('active');
    if (elements.btnAllQuestions) elements.btnAllQuestions.classList.add('active');
    renderTagsList();
    renderTicketsGrid();
    applyFilters();
  }

  function resetProgressStats() {
    if (confirm('Сбросить всю историю ответов и статистику?')) {
      state.answersLog = {};
      savePersistedState();
      recalcStats();
      renderQuestionNavStrip();
      renderCurrentQuestion();
    }
  }

  // Keyboard Shortcuts (1..5 answers, Left/Right navigation)
  function initKeyboardListeners() {
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in search input
      if (document.activeElement === elements.searchInput) return;

      if (e.key === 'ArrowLeft') {
        goToPrev();
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        goToNext();
      } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
        const ansIdx = parseInt(e.key, 10) - 1;
        const q = state.filteredQuestions[state.currentIndex];
        if (q && !state.answersLog[q.id] && ansIdx < q.answers.length) {
          handleAnswerSelect(q, ansIdx);
        }
      }
    });
  }

  // Setup UI Event Listeners
  function attachEventListeners() {
    elements.btnPrev.addEventListener('click', goToPrev);
    elements.btnNext.addEventListener('click', goToNext);
    elements.btnFavorite.addEventListener('click', toggleFavorite);
    elements.btnResetFilters.addEventListener('click', resetAllFilters);
    elements.btnResetStats.addEventListener('click', resetProgressStats);

    // Search input with debounce
    let searchTimeout = null;
    elements.searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.searchQuery = e.target.value;
        applyFilters();
      }, 200);
    });

    // Preset filter buttons
    elements.btnAllQuestions.addEventListener('click', () => {
      state.onlyErrors = false;
      state.onlyFavorites = false;
      elements.btnAllQuestions.classList.add('active');
      elements.btnFilterErrors.classList.remove('active');
      elements.btnFilterFavs.classList.remove('active');
      applyFilters();
    });

    elements.btnFilterErrors.addEventListener('click', () => {
      state.onlyErrors = !state.onlyErrors;
      state.onlyFavorites = false;
      elements.btnFilterErrors.classList.toggle('active', state.onlyErrors);
      elements.btnFilterFavs.classList.remove('active');
      elements.btnAllQuestions.classList.toggle('active', !state.onlyErrors);
      applyFilters();
    });

    elements.btnFilterFavs.addEventListener('click', () => {
      state.onlyFavorites = !state.onlyFavorites;
      state.onlyErrors = false;
      elements.btnFilterFavs.classList.toggle('active', state.onlyFavorites);
      elements.btnFilterErrors.classList.remove('active');
      elements.btnAllQuestions.classList.toggle('active', !state.onlyFavorites);
      applyFilters();
    });
  }

  // Bootstrap Application
  function init() {
    // Read question number from URL hash if provided (e.g. #2 or #q=2)
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const qNum = parseInt(hash.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(qNum) && qNum >= 1 && qNum <= 800) {
        state.currentIndex = qNum - 1;
      }
    }
    loadPersistedState();
    initDOMElements();
    renderTagsList();
    renderTicketsGrid();
    attachEventListeners();
    initKeyboardListeners();
    applyFilters();
  }

  // Launch when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
