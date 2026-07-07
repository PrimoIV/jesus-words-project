import {
    analyzeVerseHighlights,
    buildHighlightSpans,
    formatDisplayText,
    renderHighlightedText,
    setHighlightReviewLayer,
    tokenizeText
} from './highlightEngine.js';
import { getDisplayJesusText, loadJesusSpeechOverrides } from './jesusSpeechText.js';
import { SPEECH_BLOCKS } from './speechBlocks.js';

const TRANSLATIONS = ['DBH', 'NRSVUE', 'LAMSA'];
const FEATURED_VERSE_ID = 'MAT_5_3';

const categoryRules = {
    'Kingdom of God': ['kingdom', 'heaven', 'kingdom of heaven'],
    Parables: ['parable', 'likened', 'like unto'],
    'Discipleship / Cost of Following': ['follow me', 'take up your cross', 'deny yourself', 'disciple'],
    'Love / Forgiveness': ['forgive', 'love', 'mercy', 'enemy'],
    'Prayer / Spiritual Practice': ['pray', 'prayer', 'fasting', 'hallowed be'],
    'Wealth / Money': ['rich', 'money', 'treasure', 'wealth', 'mammon', 'camel'],
    'Judgment / Warnings': ['judge', 'condemn', 'hell', 'weeping', 'gnashing'],
    'Identity ("I am")': ['i am', 'bread of life', 'light of the world', 'good shepherd'],
    'Faith / Healing': ['faith', 'believe', 'healed', 'made whole', 'cured', 'physician']
};

let dataset = {};
let allVerseIds = [];
let activeVerseId = null;
let activeSpeechBlockId = null;
let activeCategory = null;
let currentMode = 'verse';
let readingMode = 'verse';
let activeTranslationTab = 'DBH';
let showContext = false;
let categoryMap = {};
let books = [];

const differenceScoreCache = new Map();

const sidebarSearch = document.getElementById('sidebar-search');
const bookFilter = document.getElementById('book-filter');
const diffOnlyFilter = document.getElementById('diff-only-filter');
const toggleBtns = document.querySelectorAll('.toggle-btn[data-mode]');
const readingModeBtns = document.querySelectorAll('.reading-mode-btn[data-reading-mode]');
const showContextToggle = document.getElementById('show-context-toggle');
const libraryStat = document.getElementById('library-stat');
const sourceStat = document.getElementById('source-stat');

const viewVerse = document.getElementById('view-verse');
const viewSpeechBlocks = document.getElementById('view-speech-blocks');
const viewStudyEmpty = document.getElementById('view-study-empty');
const viewStudyDetail = document.getElementById('view-study-detail');
const verseListEl = document.getElementById('verse-list');
const speechBlockListEl = document.getElementById('speech-block-list');
const studyVerseListEl = document.getElementById('study-verse-list');
const dashboardGrid = document.getElementById('dashboard-grid');
const btnBackCategories = document.getElementById('btn-back-categories');
const studyDetailTitle = document.getElementById('study-detail-title');
const comparisonView = document.getElementById('comparison-view');
const categoriesDashboard = document.getElementById('categories-dashboard');

const activeReference = document.getElementById('active-reference');
const activeAnchor = document.getElementById('active-anchor');
const activeDiffLevel = document.getElementById('active-diff-level');
const contextLabelEl = document.getElementById('context-label');
const btnPrevVerse = document.getElementById('btn-prev-verse');
const btnNextVerse = document.getElementById('btn-next-verse');
const translationTabs = document.getElementById('translation-tabs');
const comparisonTable = document.getElementById('comparison-table');
const phraseGrid = document.getElementById('phrase-grid');
const differenceSummary = document.getElementById('difference-summary');
const coverageSummary = document.getElementById('coverage-summary');
const sidebarContent = document.getElementById('sidebar-content');

document.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        const [response] = await Promise.all([
            fetch('data/jesus_verses_final.json'),
            loadJesusSpeechOverrides()
        ]);

        if (!response.ok) throw new Error(`Dataset request failed: ${response.status}`);

        dataset = await response.json();
        allVerseIds = Object.keys(dataset);

        await loadHighlightReviewLayer();
        books = getBooks();
        buildBookFilter();
        buildCategoryMap();
        bindEvents();
        updateStats();
        renderCategories();

        activeVerseId = dataset[FEATURED_VERSE_ID] ? FEATURED_VERSE_ID : allVerseIds[0];
        updateViewLayer();
        if (activeVerseId) setActiveVerse(activeVerseId);
    } catch (error) {
        console.error('Failed to load Jesus Words dataset', error);
        renderLoadError();
    }
}

async function loadHighlightReviewLayer() {
    try {
        const response = await fetch('dev/highlight_review_overrides.json');
        if (response.ok) setHighlightReviewLayer(await response.json());
    } catch {
        setHighlightReviewLayer({ overrides: [] });
    }
}

function bindEvents() {
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    readingModeBtns.forEach(btn => {
        btn.addEventListener('click', () => setReadingMode(btn.dataset.readingMode));
    });

    showContextToggle.addEventListener('change', () => {
        showContext = showContextToggle.checked;
        rerenderActiveComparison();
    });

    btnBackCategories.addEventListener('click', () => {
        activeCategory = null;
        sidebarSearch.value = '';
        updateViewLayer();
        handleSearch('');
    });

    sidebarSearch.addEventListener('input', () => handleSearch(currentQuery()));
    bookFilter.addEventListener('change', () => handleSearch(currentQuery()));
    diffOnlyFilter.addEventListener('change', () => handleSearch(currentQuery()));
    btnPrevVerse.addEventListener('click', () => moveActiveItem(-1));
    btnNextVerse.addEventListener('click', () => moveActiveItem(1));

    translationTabs.addEventListener('click', event => {
        const btn = event.target.closest('[data-translation-tab]');
        if (!btn) return;
        activeTranslationTab = btn.dataset.translationTab;
        translationTabs.querySelectorAll('.translation-tab').forEach(tab => {
            const isActive = tab === btn;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
        });
        rerenderActiveComparison();
    });

    sidebarContent.addEventListener('click', event => {
        const item = event.target.closest('.list-item');
        if (!item) return;
        if (item.dataset.type === 'speech-block') {
            setActiveSpeechBlock(item.dataset.id);
            return;
        }
        setActiveVerse(item.dataset.id);
    });

    sidebarContent.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const item = event.target.closest('.list-item');
        if (!item) return;
        event.preventDefault();
        item.click();
    });

    dashboardGrid.addEventListener('click', event => {
        const card = event.target.closest('.dashboard-card');
        if (!card) return;
        activeCategory = card.dataset.category;
        setMode('study', { preserveCategory: true });
        const visibleIds = getVisibleVerseIds(categoryMap[activeCategory] || []);
        if (visibleIds.length > 0) setActiveVerse(visibleIds[0]);
    });
}

function setMode(mode, options = {}) {
    currentMode = mode === 'study' ? 'study' : 'verse';
    if (currentMode === 'study') readingMode = 'verse';
    if (!options.preserveCategory && currentMode === 'verse') activeCategory = null;

    toggleBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === currentMode));
    readingModeBtns.forEach(btn => {
        const isActive = btn.dataset.readingMode === readingMode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    updateViewLayer();
    handleSearch(currentQuery());
}

function setReadingMode(mode) {
    readingMode = mode === 'speech' ? 'speech' : 'verse';
    if (readingMode === 'speech') {
        currentMode = 'verse';
        activeCategory = null;
    }

    toggleBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === currentMode));
    readingModeBtns.forEach(btn => {
        const isActive = btn.dataset.readingMode === readingMode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    updateViewLayer();
    handleSearch(currentQuery());

    if (readingMode === 'speech') {
        const visibleBlocks = getVisibleSpeechBlocks();
        setActiveSpeechBlock(activeSpeechBlockId || visibleBlocks[0]?.id);
    } else if (activeVerseId) {
        setActiveVerse(activeVerseId);
    }
}

function updateViewLayer() {
    [viewVerse, viewSpeechBlocks, viewStudyEmpty, viewStudyDetail].forEach(el => el.classList.remove('active'));
    [comparisonView, categoriesDashboard].forEach(el => el.classList.remove('active'));

    if (readingMode === 'speech') {
        viewSpeechBlocks.classList.add('active');
        comparisonView.classList.add('active');
        renderSpeechBlockList();
        return;
    }

    if (currentMode === 'study' && !activeCategory) {
        viewStudyEmpty.classList.add('active');
        categoriesDashboard.classList.add('active');
        renderCategories(currentQuery());
        return;
    }

    if (currentMode === 'study' && activeCategory) {
        viewStudyDetail.classList.add('active');
        comparisonView.classList.add('active');
        studyDetailTitle.textContent = activeCategory;
        renderVerses(getVisibleVerseIds(categoryMap[activeCategory] || []), studyVerseListEl);
        return;
    }

    viewVerse.classList.add('active');
    comparisonView.classList.add('active');
    renderVerses(getVisibleVerseIds(), verseListEl);
}

function handleSearch(query) {
    if (readingMode === 'speech') {
        renderSpeechBlockList(query);
        updateNavButtons();
        return;
    }

    if (currentMode === 'study' && !activeCategory) {
        renderCategories(query);
        return;
    }

    if (currentMode === 'study' && activeCategory) {
        renderVerses(getVisibleVerseIds(categoryMap[activeCategory] || [], query), studyVerseListEl);
        updateNavButtons();
        return;
    }

    renderVerses(getVisibleVerseIds(allVerseIds, query), verseListEl);
    updateNavButtons();
}

function renderVerses(ids, container) {
    const fragment = document.createDocumentFragment();

    if (ids.length === 0) {
        fragment.appendChild(createEmptyListItem('No matching verses'));
        container.replaceChildren(fragment);
        return;
    }

    ids.forEach(id => {
        const verse = dataset[id];
        if (!verse) return;

        const item = document.createElement('li');
        item.className = 'list-item';
        item.tabIndex = 0;
        item.dataset.id = id;
        item.dataset.type = 'verse';
        item.classList.toggle('active', id === activeVerseId);

        const ref = document.createElement('span');
        ref.className = 'verse-ref';
        ref.textContent = getReference(verse);
        item.appendChild(ref);
        item.appendChild(createDifferenceBadge(getDifferenceScoreCached(id)));
        fragment.appendChild(item);
    });

    container.replaceChildren(fragment);
}

function renderSpeechBlockList(query = currentQuery()) {
    const fragment = document.createDocumentFragment();
    const blocks = getVisibleSpeechBlocks(query);

    if (blocks.length === 0) {
        fragment.appendChild(createEmptyListItem('No matching speech blocks'));
        speechBlockListEl.replaceChildren(fragment);
        return;
    }

    blocks.forEach(block => {
        const item = document.createElement('li');
        item.className = 'list-item speech-block-item';
        item.tabIndex = 0;
        item.dataset.id = block.id;
        item.dataset.type = 'speech-block';
        item.classList.toggle('active', block.id === activeSpeechBlockId);

        const title = document.createElement('span');
        title.className = 'verse-ref';
        title.textContent = block.title;

        const range = document.createElement('span');
        range.className = 'speech-block-range';
        range.textContent = getBlockRange(block);

        item.append(title, range);
        fragment.appendChild(item);
    });

    speechBlockListEl.replaceChildren(fragment);
}

function renderCategories(query = '') {
    const fragment = document.createDocumentFragment();
    const normalizedQuery = query.toLowerCase();

    Object.entries(categoryMap).forEach(([category, ids]) => {
        if (normalizedQuery && !category.toLowerCase().includes(normalizedQuery)) return;
        if (ids.length === 0 && !normalizedQuery) return;

        const card = document.createElement('button');
        card.className = 'dashboard-card';
        card.type = 'button';
        card.dataset.category = category;

        const title = document.createElement('h3');
        title.textContent = category;

        const count = document.createElement('span');
        count.className = 'card-count';
        count.textContent = `${ids.length} verses`;

        card.append(title, count);
        fragment.appendChild(card);
    });

    if (!fragment.childNodes.length) fragment.appendChild(createEmptyCategoryCard());
    dashboardGrid.replaceChildren(fragment);
}

function setActiveVerse(id) {
    if (!id || !dataset[id]) return;
    readingMode = 'verse';
    activeVerseId = id;

    readingModeBtns.forEach(btn => {
        const isActive = btn.dataset.readingMode === 'verse';
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    renderComparison(id);
    updateActiveListItems(id);
}

function setActiveSpeechBlock(blockId) {
    const block = SPEECH_BLOCKS.find(item => item.id === blockId);
    if (!block) return;
    readingMode = 'speech';
    activeSpeechBlockId = blockId;

    readingModeBtns.forEach(btn => {
        const isActive = btn.dataset.readingMode === 'speech';
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    renderSpeechBlockComparison(blockId);
    updateActiveListItems(blockId);
}

function renderComparison(id) {
    const verse = dataset[id];
    if (!verse) return;

    activeReference.textContent = getReference(verse);
    activeAnchor.textContent = verse.anchor?.BSB ? formatDisplayText(verse.anchor.BSB) : '';
    renderContextLabel(showContext ? getSmallestBlockForVerseId(id)?.contextLabel : '');
    updateVariancePill(getDifferenceScoreCached(id));

    const processed = buildProcessedTranslations(verse, id);
    renderComparisonRows(processed);
    renderPhraseGrid(processed);
    renderDifferenceSummary(processed);
    renderCoverage(processed);
    updateNavButtons();
}

function renderSpeechBlockComparison(blockId) {
    const block = SPEECH_BLOCKS.find(item => item.id === blockId);
    if (!block) return;

    activeReference.textContent = block.title;
    activeAnchor.textContent = getBlockRange(block);
    renderContextLabel(showContext ? block.contextLabel : '');
    updateVariancePill(getSpeechBlockDifferenceScore(block));

    const processed = buildProcessedSpeechBlock(block);
    renderSpeechBlockRows(block, processed);
    renderPhraseGrid(processed);
    renderDifferenceSummary(processed);
    renderCoverage(processed);
    updateNavButtons();
}

function renderComparisonRows(processed) {
    const rows = document.createDocumentFragment();
    if (activeTranslationTab === 'Compare') {
        TRANSLATIONS.forEach(name => rows.appendChild(createTranslationCard(name, processed, true)));
    } else {
        rows.appendChild(createTranslationCard(activeTranslationTab, processed, false));
    }
    comparisonTable.replaceChildren(rows);
}

function renderSpeechBlockRows(block, processed) {
    const rows = document.createDocumentFragment();
    if (activeTranslationTab === 'Compare') {
        TRANSLATIONS.forEach(name => rows.appendChild(createSpeechBlockTranslationCard(name, block, true)));
    } else {
        rows.appendChild(createSpeechBlockTranslationCard(activeTranslationTab, block, false));
    }
    comparisonTable.replaceChildren(rows);
}

function createTranslationCard(name, processed, compact) {
    const row = document.createElement('article');
    row.className = compact ? 'comparison-row compare-card' : 'comparison-row selected-translation';

    const label = document.createElement('div');
    label.className = 'translation-label';
    label.textContent = name;

    const text = document.createElement('div');
    text.className = 'translation-text';
    text.innerHTML = renderHighlightedText(processed[name].text, processed[name].highlights, 'meaning');

    row.append(label, text);
    return row;
}

function createSpeechBlockTranslationCard(name, block, compact) {
    const row = document.createElement('article');
    row.className = compact ? 'comparison-row compare-card speech-block-card' : 'comparison-row selected-translation speech-block-card';

    const label = document.createElement('div');
    label.className = 'translation-label';
    label.textContent = name;

    const text = document.createElement('div');
    text.className = 'translation-text speech-block-text';

    block.verseIds.forEach(verseId => {
        const verse = dataset[verseId];
        if (!verse) return;

        const verseText = getFormattedTranslation(verseId, verse, name);
        if (!verseText) return;

        const segment = document.createElement('span');
        segment.className = 'speech-verse-segment';

        const ref = document.createElement('span');
        ref.className = 'inline-verse-ref';
        ref.textContent = getReference(verse);

        const words = document.createElement('span');
        words.className = 'speech-verse-text';
        const otherTexts = TRANSLATIONS
            .filter(item => item !== name)
            .map(item => getFormattedTranslation(verseId, verse, item));
        words.innerHTML = renderHighlightedText(
            verseText,
            buildHighlightSpans(verseText, otherTexts, 'meaning', name),
            'meaning'
        );

        segment.append(ref, document.createTextNode(' '), words, document.createTextNode(' '));
        text.appendChild(segment);
    });

    row.append(label, text);
    return row;
}

function buildProcessedTranslations(verse, verseId) {
    const processed = {};
    TRANSLATIONS.forEach(name => {
        const text = getFormattedTranslation(verseId, verse, name);
        processed[name] = {
            text,
            tokens: tokenizeText(text).map(token => token.normalized),
            highlights: []
        };
    });

    TRANSLATIONS.forEach(name => {
        const otherTexts = TRANSLATIONS
            .filter(item => item !== name)
            .map(item => processed[item].text);
        processed[name].highlights = buildHighlightSpans(processed[name].text, otherTexts, 'meaning', name);
    });

    return processed;
}

function buildProcessedSpeechBlock(block) {
    const processed = {};

    TRANSLATIONS.forEach(name => {
        const text = block.verseIds
            .map(verseId => {
                const verse = dataset[verseId];
                return verse ? getFormattedTranslation(verseId, verse, name) : '';
            })
            .filter(Boolean)
            .join(' ');
        processed[name] = {
            text,
            tokens: tokenizeText(text).map(token => token.normalized),
            highlights: []
        };
    });

    TRANSLATIONS.forEach(name => {
        const otherTexts = TRANSLATIONS
            .filter(item => item !== name)
            .map(item => processed[item].text);
        processed[name].highlights = buildHighlightSpans(processed[name].text, otherTexts, 'meaning', name);
    });

    return processed;
}

function renderPhraseGrid(processed) {
    const fragment = document.createDocumentFragment();
    TRANSLATIONS.forEach(name => {
        const row = document.createElement('div');
        row.className = 'phrase-row';

        const label = document.createElement('div');
        label.className = 'phrase-label';
        label.textContent = name;

        const phrases = document.createElement('div');
        phrases.className = 'phrase-chips';
        splitPhrases(processed[name].text).forEach(phrase => {
            const chip = document.createElement('span');
            chip.className = phraseHasHighlights(phrase, processed[name].highlights) ? 'phrase-chip diff' : 'phrase-chip';
            chip.textContent = phrase;
            phrases.appendChild(chip);
        });

        row.append(label, phrases);
        fragment.appendChild(row);
    });
    phraseGrid.replaceChildren(fragment);
}

function renderDifferenceSummary(processed) {
    const groups = buildDifferenceGroups(processed);
    if (groups.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No major meaning-level differences detected.';
        differenceSummary.replaceChildren(empty);
        return;
    }

    const table = document.createElement('div');
    table.className = 'difference-table';

    groups.slice(0, 10).forEach(group => {
        const item = document.createElement('div');
        item.className = group.critical ? 'key-difference-item critical' : 'key-difference-item';

        const phrase = document.createElement('span');
        phrase.className = 'difference-phrase';
        phrase.textContent = group.term;

        const meta = document.createElement('span');
        meta.className = 'difference-meta';
        meta.textContent = `Unique to ${group.translations.join(', ')}`;

        item.append(phrase, meta);
        table.appendChild(item);
    });

    differenceSummary.replaceChildren(table);
}

function renderCoverage(processed) {
    const fragment = document.createDocumentFragment();
    TRANSLATIONS.forEach(name => {
        const item = document.createElement('div');
        item.className = 'coverage-item';

        const label = document.createElement('span');
        label.textContent = name;

        const value = document.createElement('strong');
        value.textContent = processed[name].text ? 'Present' : 'Missing';

        item.append(label, value);
        fragment.appendChild(item);
    });
    coverageSummary.replaceChildren(fragment);
}

function buildDifferenceGroups(processed) {
    const groups = new Map();

    TRANSLATIONS.forEach(name => {
        processed[name].highlights.forEach(span => {
            const key = `${span.type}:${span.normalized}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    term: span.text,
                    translations: [],
                    critical: span.type === 'critical',
                    type: span.type
                });
            }
            groups.get(key).translations.push(name);
        });
    });

    return Array.from(groups.values()).sort((a, b) => {
        if (a.critical !== b.critical) return a.critical ? -1 : 1;
        return a.term.localeCompare(b.term);
    });
}

function getVisibleVerseIds(sourceIds = allVerseIds, query = currentQuery()) {
    const selectedBook = bookFilter.value;
    return sourceIds.filter(id => {
        const verse = dataset[id];
        if (!verse) return false;
        if (selectedBook && verse.book !== selectedBook) return false;
        if (diffOnlyFilter.checked && getDifferenceLevel(getDifferenceScoreCached(id)) !== 'high') return false;
        if (!query) return true;

        const haystack = [
            getReference(verse),
            verse.anchor?.BSB || '',
            ...TRANSLATIONS.map(name => getTranslationText(id, verse, name))
        ].join(' ').toLowerCase();
        return haystack.includes(query);
    });
}

function getVisibleSpeechBlocks(query = currentQuery()) {
    const selectedBook = bookFilter.value;
    return SPEECH_BLOCKS.filter(block => {
        if (selectedBook && block.book !== selectedBook) return false;
        if (!query) return true;
        return [
            block.title,
            block.startRef,
            block.endRef,
            block.contextLabel,
            block.category
        ].join(' ').toLowerCase().includes(query);
    });
}

function moveActiveItem(direction) {
    if (readingMode === 'speech') {
        const visibleBlocks = getVisibleSpeechBlocks();
        const index = visibleBlocks.findIndex(block => block.id === activeSpeechBlockId);
        const next = visibleBlocks[Math.max(0, Math.min(visibleBlocks.length - 1, index + direction))];
        if (next) setActiveSpeechBlock(next.id);
        return;
    }

    const source = currentMode === 'study' && activeCategory ? categoryMap[activeCategory] : allVerseIds;
    const visibleIds = getVisibleVerseIds(source);
    const index = visibleIds.indexOf(activeVerseId);
    const nextId = visibleIds[Math.max(0, Math.min(visibleIds.length - 1, index + direction))];
    if (nextId) setActiveVerse(nextId);
}

function updateNavButtons() {
    if (readingMode === 'speech') {
        const visibleBlocks = getVisibleSpeechBlocks();
        const index = visibleBlocks.findIndex(block => block.id === activeSpeechBlockId);
        btnPrevVerse.disabled = index <= 0;
        btnNextVerse.disabled = index === -1 || index >= visibleBlocks.length - 1;
        return;
    }

    const source = currentMode === 'study' && activeCategory ? categoryMap[activeCategory] : allVerseIds;
    const visibleIds = getVisibleVerseIds(source);
    const index = visibleIds.indexOf(activeVerseId);
    btnPrevVerse.disabled = index <= 0;
    btnNextVerse.disabled = index === -1 || index >= visibleIds.length - 1;
}

function getDifferenceScoreCached(id) {
    if (differenceScoreCache.has(id)) return differenceScoreCache.get(id);
    const verse = dataset[id];
    if (!verse) return 0;
    const displayVerse = {
        ...verse,
        translations: Object.fromEntries(TRANSLATIONS.map(name => [
            name,
            getFormattedTranslation(id, verse, name)
        ]))
    };
    const highlights = analyzeVerseHighlights(displayVerse, TRANSLATIONS, 'meaning');
    const score = TRANSLATIONS.reduce((total, name) => total + highlights[name].reduce((sum, span) => {
        if (span.type === 'critical') return sum + 3;
        if (span.type === 'interpretive') return sum + 2;
        return sum + 1;
    }, 0), 0);
    differenceScoreCache.set(id, score);
    return score;
}

function getSpeechBlockDifferenceScore(block) {
    return block.verseIds.reduce((total, id) => total + getDifferenceScoreCached(id), 0);
}

function createDifferenceBadge(score) {
    const level = getDifferenceLevel(score);
    const badge = document.createElement('span');
    badge.className = `diff-badge ${level}`;
    badge.textContent = level === 'high' ? 'High' : level === 'medium' ? 'Med' : 'Low';
    return badge;
}

function updateVariancePill(score) {
    const level = getDifferenceLevel(score);
    activeDiffLevel.className = `variance-pill ${level}`;
    activeDiffLevel.textContent = level === 'high'
        ? 'Strong variation'
        : level === 'medium'
            ? 'Moderate variation'
            : 'Close alignment';
}

function getDifferenceLevel(score) {
    if (score >= 10) return 'high';
    if (score >= 5) return 'medium';
    return 'low';
}

function splitPhrases(text) {
    if (!text) return ['Missing translation'];
    return text
        .split(/(?<=[.;:!?])\s+|,\s+|\u2014/)
        .map(part => part.trim())
        .filter(Boolean)
        .slice(0, 14);
}

function phraseHasHighlights(phrase, highlights) {
    const phraseTokens = new Set(tokenizeText(phrase).map(token => token.normalized));
    return highlights.some(span => span.normalized.split(/\s+/).some(token => phraseTokens.has(token)));
}

function buildBookFilter() {
    books.forEach(book => {
        const option = document.createElement('option');
        option.value = book;
        option.textContent = book;
        bookFilter.appendChild(option);
    });
}

function buildCategoryMap() {
    categoryMap = Object.fromEntries(Object.keys(categoryRules).map(category => [category, []]));

    allVerseIds.forEach(id => {
        const verse = dataset[id];
        if (!verse?.translations) return;
        const combinedText = TRANSLATIONS
            .map(name => getTranslationText(id, verse, name))
            .join(' ')
            .toLowerCase();

        Object.entries(categoryRules).forEach(([category, keywords]) => {
            const matched = keywords.some(keyword => new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(combinedText));
            if (matched) categoryMap[category].push(id);
        });
    });
}

function getBooks() {
    const seen = new Set();
    allVerseIds.forEach(id => {
        const book = dataset[id]?.book;
        if (book) seen.add(book);
    });
    return Array.from(seen);
}

function updateStats() {
    libraryStat.textContent = `${allVerseIds.length} verses`;
    sourceStat.textContent = `${books.length} books`;
}

function getFormattedTranslation(id, verse, name) {
    return formatDisplayText(getTranslationText(id, verse, name));
}

function getTranslationText(id, verse, name) {
    return getDisplayJesusText(id, verse, name);
}

function getReference(verse) {
    return verse.reference || `${verse.book} ${verse.chapter}:${verse.verse}`;
}

function getBlockRange(block) {
    if (block.startRef === block.endRef) return block.startRef;
    return `${block.startRef}-${block.endRef.replace(`${block.book} `, '')}`;
}

function getBlocksForVerseId(verseId) {
    return SPEECH_BLOCKS.filter(block => block.verseIds.includes(verseId));
}

function getSmallestBlockForVerseId(verseId) {
    return getBlocksForVerseId(verseId).sort((a, b) => a.verseIds.length - b.verseIds.length)[0] || null;
}

function renderContextLabel(label) {
    if (!label) {
        contextLabelEl.hidden = true;
        contextLabelEl.textContent = '';
        return;
    }
    contextLabelEl.hidden = false;
    contextLabelEl.textContent = label;
}

function rerenderActiveComparison() {
    if (readingMode === 'speech' && activeSpeechBlockId) {
        renderSpeechBlockComparison(activeSpeechBlockId);
        return;
    }
    if (activeVerseId) renderComparison(activeVerseId);
}

function updateActiveListItems(id) {
    document.querySelectorAll('.list-item.active').forEach(item => item.classList.remove('active'));
    document.querySelectorAll(`.list-item[data-id="${cssEscape(id)}"]`).forEach(item => item.classList.add('active'));
}

function createEmptyListItem(message) {
    const item = document.createElement('li');
    item.className = 'placeholder-state';
    item.textContent = message;
    return item;
}

function createEmptyCategoryCard() {
    const card = document.createElement('div');
    card.className = 'dashboard-card';
    const title = document.createElement('h3');
    title.textContent = 'No matching categories';
    const note = document.createElement('span');
    note.className = 'card-count';
    note.textContent = 'Try another search';
    card.append(title, note);
    return card;
}

function renderLoadError() {
    activeReference.textContent = 'Unable to load data';
    activeAnchor.textContent = 'Start a local server from the project folder and reload the page.';
    activeDiffLevel.textContent = 'Offline';
    verseListEl.replaceChildren(createEmptyListItem('Dataset failed to load'));
}

function currentQuery() {
    return sidebarSearch.value.toLowerCase().trim();
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
}
