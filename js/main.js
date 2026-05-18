import {
    analyzeVerseHighlights,
    buildHighlightSpans,
    formatDisplayText,
    processWords,
    renderHighlightedText,
    setHighlightReviewLayer,
    tokenizeText
} from './highlightEngine.js';
import { getDisplayJesusText, loadJesusSpeechOverrides } from './jesusSpeechText.js';
import { SPEECH_BLOCKS } from './speechBlocks.js';

const DEV_MODE = new URLSearchParams(window.location.search).has('dev');
const TRANSLATIONS = ['DBH', 'NRSVUE', 'LAMSA'];

const HOME_CONFIG = {
    featuredVerseId: "MAT_5_3",
    browsePaths: [
        { label: "Sermon on the Mount", verseId: "MAT_5_3" },
        { label: "John’s Discourses", verseId: "JHN_8_12" },
        { label: "Parables", verseId: "LUK_15_4" },
        { label: "Revelation", verseId: "REV_2_1" }
    ]
};

let dataset = {};
let allVerseIds = [];
let activeVerseId = null;
let currentMode = 'verse';
let readingMode = 'verse';
let activeCategory = null;
let activeSpeechBlockId = null;
let categoryMap = {};
let currentHighlightMode = 'meaning';
let activeTranslationTab = 'DBH';
let showContext = false;
let appInitialized = false;
let differenceBadgeJobId = 0;
let highDiffIndexReady = false;
let highDiffIndexStarted = false;
let pendingHighDiffRender = false;
let lastHighDiffRenderAt = 0;
const differenceScoreCache = new Map();
const highDiffIds = new Set();
const requestIdleWork = window.requestIdleCallback || ((callback) => {
    return window.setTimeout(() => callback({
        didTimeout: true,
        timeRemaining: () => 0
    }), 1);
});

const sidebarSearch = document.getElementById('sidebar-search');
const bookFilter = document.getElementById('book-filter');
const diffOnlyFilter = document.getElementById('diff-only-filter');
const toggleBtns = document.querySelectorAll('.toggle-btn[data-mode]');
const readingModeBtns = document.querySelectorAll('.reading-mode-btn[data-reading-mode]');
const showContextToggle = document.getElementById('show-context-toggle');

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
const btnPrevVerse = document.getElementById('btn-prev-verse');
const btnNextVerse = document.getElementById('btn-next-verse');
const translationTabs = document.getElementById('translation-tabs');
const comparisonTable = document.getElementById('comparison-table');
const phraseGrid = document.getElementById('phrase-grid');
const differenceSummary = document.getElementById('difference-summary');
const coverageSummary = document.getElementById('coverage-summary');
const contextLabelEl = document.getElementById('context-label');

const categoryRules = {
    "Kingdom of God": ["kingdom", "heaven", "kingdom of heaven"],
    "Parables": ["parable", "likened", "like unto"],
    "Discipleship / Cost of Following": ["follow me", "take up your cross", "deny yourself", "disciple"],
    "Love / Forgiveness": ["forgive", "love", "mercy", "enemy"],
    "Prayer / Spiritual Practice": ["pray", "prayer", "fasting", "hallowed be"],
    "Wealth / Money": ["rich", "money", "treasure", "wealth", "mammon", "camel"],
    "Judgment / Warnings": ["judge", "condemn", "hell", "weeping", "gnashing"],
    "Identity (\"I am\")": ["i am", "bread of life", "light of the world", "good shepherd"],
    "Faith / Healing": ["faith", "believe", "healed", "made whole", "cured", "physician"]
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const [response] = await Promise.all([
            fetch('data/jesus_verses_final.json'),
            loadJesusSpeechOverrides()
        ]);
        dataset = await response.json();
        allVerseIds = Object.keys(dataset);

        buildBookFilter();
        buildCategoryMap();
        renderHomePage();

        requestIdleWork(() => initializeAppShell({ renderComparison: false }));
        requestIdleWork(() => ensureHighDiffIndex());
        loadHighlightReviewLayer().then(() => {
            differenceScoreCache.clear();
            highDiffIds.clear();
            highDiffIndexReady = false;
            highDiffIndexStarted = false;
            requestIdleWork(() => ensureHighDiffIndex());
            if (document.body.classList.contains('home-active')) renderHomePage();
            if (appInitialized) {
                handleSearch(sidebarSearch.value.toLowerCase().trim());
                if (readingMode === 'speech' && activeSpeechBlockId) {
                    renderSpeechBlockComparison(activeSpeechBlockId);
                } else if (activeVerseId) {
                    renderComparison(activeVerseId);
                }
            }
        });

        if (DEV_MODE) {
            const { runHighlightStressTest } = await import('./dev/stressTest.js');
            await runHighlightStressTest({
                dataset,
                allVerseIds,
                getDisplayText: getTranslationText,
                processWords,
                generateHighlightedNodes: (words, setA, setB) => htmlToNodes(renderHighlightedText(
                    words.join(' '),
                    buildHighlightSpans(words.join(' '), [Array.from(setA).join(' '), Array.from(setB).join(' ')], 'meaning'),
                    'meaning'
                ))
            });
        }
    } catch (e) {
        console.error("Failed to load dataset", e);
        const errorItem = document.createElement('li');
        errorItem.className = 'load-error';
        errorItem.textContent = 'Failed to load data';
        verseListEl.replaceChildren(errorItem);
    }
});

function initializeAppShell({ renderComparison: shouldRenderComparison = true } = {}) {
    if (appInitialized || allVerseIds.length === 0) return;
    appInitialized = true;

    renderVerses(getVisibleVerseIds(), verseListEl);
    renderSpeechBlockList();
    renderCategories();

    if (!activeVerseId && dataset[HOME_CONFIG.featuredVerseId]) {
        activeVerseId = HOME_CONFIG.featuredVerseId;
        document.querySelectorAll(`.list-item[data-id="${cssEscape(activeVerseId)}"]`).forEach(el => el.classList.add('active'));
    }

    if (shouldRenderComparison && activeVerseId) renderComparison(activeVerseId);
}

async function loadHighlightReviewLayer() {
    try {
        const response = await fetch('dev/highlight_review_overrides.json');
        if (!response.ok) return;
        setHighlightReviewLayer(await response.json());
    } catch (error) {
        console.info('Highlight review layer not loaded; using default rules.', error);
    }
}

function buildBookFilter() {
    const books = [];
    allVerseIds.forEach(id => {
        const book = dataset[id]?.book;
        if (book && !books.includes(book)) books.push(book);
    });

    books.forEach(book => {
        const option = document.createElement('option');
        option.value = book;
        option.textContent = book;
        bookFilter.appendChild(option);
    });
}

function buildCategoryMap() {
    for (const cat in categoryRules) categoryMap[cat] = [];

    allVerseIds.forEach(id => {
        const v = dataset[id];
        if (!v?.translations) return;

        const combinedText = TRANSLATIONS.map(name => getTranslationText(id, v, name)).join(" ").toLowerCase();
        for (const [category, keywords] of Object.entries(categoryRules)) {
            const matched = keywords.some(kw => new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i').test(combinedText));
            if (matched) categoryMap[category].push(id);
        }
    });
}

toggleBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        toggleBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentMode = e.target.dataset.mode;
        if (currentMode === 'study') setReadingMode('verse');
        sidebarSearch.value = "";
        updateViewLayer();
        handleSearch("");
    });
});

readingModeBtns.forEach(btn => {
    btn.addEventListener('click', () => setReadingMode(btn.dataset.readingMode));
});

showContextToggle.addEventListener('change', () => {
    showContext = showContextToggle.checked;
    if (readingMode === 'speech' && activeSpeechBlockId) {
        renderSpeechBlockComparison(activeSpeechBlockId);
    } else if (activeVerseId) {
        renderComparison(activeVerseId);
    }
});

btnBackCategories.addEventListener('click', () => {
    activeCategory = null;
    sidebarSearch.value = "";
    handleSearch("");
    updateViewLayer();
});

bookFilter.addEventListener('change', () => handleSearch(sidebarSearch.value.toLowerCase().trim()));
diffOnlyFilter.addEventListener('change', () => {
    window.requestAnimationFrame(() => {
        if (diffOnlyFilter.checked) ensureHighDiffIndex();
        handleSearch(sidebarSearch.value.toLowerCase().trim());
    });
});
sidebarSearch.addEventListener('input', (e) => handleSearch(e.target.value.toLowerCase().trim()));

document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-nav-target]');
    if (navBtn) {
        const target = navBtn.dataset.navTarget;
        if (target === 'browse') {
            if (document.body.classList.contains('app-active')) {
                showHomePage();
            }
            const browseSection = document.getElementById('home-browse');
            if (browseSection) browseSection.scrollIntoView({ behavior: 'smooth' });
        } else if (target === 'compare') {
            switchToAppMode('verse');
            if (!activeVerseId) setActiveVerse(HOME_CONFIG.featuredVerseId);
        } else if (target === 'sources') {
            if (document.body.classList.contains('app-active')) {
                showHomePage();
            }
            const sourcesSection = document.getElementById('home-sources');
            if (sourcesSection) sourcesSection.scrollIntoView({ behavior: 'smooth' });
        }
    }
});

const homeLink = document.querySelector("#home-link");
if (homeLink) {
    homeLink.addEventListener("click", () => {
        showHomePage();
    });
}

const startBtn = document.getElementById('start-btn');
if (startBtn) {
    startBtn.addEventListener('click', () => {
        switchToAppMode('verse');
        setActiveVerse(HOME_CONFIG.featuredVerseId);
    });
}

btnPrevVerse.addEventListener('click', () => moveActiveVerse(-1));
btnNextVerse.addEventListener('click', () => moveActiveVerse(1));

translationTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-translation-tab]');
    if (!btn) return;
    activeTranslationTab = btn.dataset.translationTab;
    translationTabs.querySelectorAll('.translation-tab').forEach(item => {
        const isActive = item === btn;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', String(isActive));
    });
    if (readingMode === 'speech' && activeSpeechBlockId) {
        renderSpeechBlockComparison(activeSpeechBlockId);
    } else if (activeVerseId) {
        renderComparison(activeVerseId);
    }
});

function updateViewLayer() {
    [viewVerse, viewSpeechBlocks, viewStudyEmpty, viewStudyDetail].forEach(el => el.classList.remove('active'));
    [comparisonView, categoriesDashboard].forEach(el => el.classList.remove('active'));

    if (readingMode === 'speech') {
        viewSpeechBlocks.classList.add('active');
        comparisonView.classList.add('active');
        renderSpeechBlockList();
        if (!activeSpeechBlockId && getVisibleSpeechBlocks().length > 0) {
            setActiveSpeechBlock(getVisibleSpeechBlocks()[0].id);
        } else if (activeSpeechBlockId) {
            renderSpeechBlockComparison(activeSpeechBlockId);
        }
    } else if (currentMode === 'verse') {
        viewVerse.classList.add('active');
        comparisonView.classList.add('active');
        renderVerses(getVisibleVerseIds(), verseListEl);
    } else if (activeCategory) {
        viewStudyDetail.classList.add('active');
        studyDetailTitle.textContent = activeCategory;
        renderVerses(getVisibleVerseIds(categoryMap[activeCategory]), studyVerseListEl);
        comparisonView.classList.add('active');
    } else {
        viewStudyEmpty.classList.add('active');
        categoriesDashboard.classList.add('active');
    }
}

function setReadingMode(mode) {
    readingMode = mode === 'speech' ? 'speech' : 'verse';
    if (readingMode === 'speech') {
        currentMode = 'verse';
        toggleBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === 'verse'));
    }
    readingModeBtns.forEach(btn => {
        const isActive = btn.dataset.readingMode === readingMode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });
    sidebarSearch.value = "";
    updateViewLayer();
    handleSearch("");
}

function renderVerses(ids, containerDOM) {
    const frag = document.createDocumentFragment();

    ids.forEach(id => {
        const v = dataset[id];
        if (!v) return;

        const li = document.createElement('li');
        li.className = 'list-item';
        if (id === activeVerseId) li.classList.add('active');
        li.dataset.id = id;
        li.dataset.type = 'verse';

        const ref = document.createElement('span');
        ref.className = 'verse-ref';
        ref.textContent = `${v.book} ${v.chapter}:${v.verse} `;

        li.append(ref);

        if (differenceScoreCache.has(id)) {
            li.appendChild(createDifferenceBadge(differenceScoreCache.get(id)));
        }
        frag.appendChild(li);
    });

    containerDOM.replaceChildren(frag);
    scheduleDifferenceBadgeHydration(ids, containerDOM);
}

function createDifferenceBadge(score) {
    const badge = document.createElement('span');
    badge.className = `diff-badge ${score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low'}`;
    badge.textContent = score >= 10 ? 'high' : score >= 5 ? 'med' : 'low';
    return badge;
}

function scheduleDifferenceBadgeHydration(ids, containerDOM) {
    const jobId = ++differenceBadgeJobId;
    const pending = ids.filter(id => !differenceScoreCache.has(id));
    if (pending.length === 0) return;
    const itemById = new Map(Array.from(containerDOM.querySelectorAll('.list-item')).map(item => [item.dataset.id, item]));

    const hydrateChunk = (deadline) => {
        let processedCount = 0;
        while (
            pending.length > 0 &&
            jobId === differenceBadgeJobId &&
            (deadline.timeRemaining() > 4 || deadline.didTimeout || processedCount < 4) &&
            processedCount < 12
        ) {
            const id = pending.shift();
            const verse = dataset[id];
            if (verse) {
                const score = getDifferenceScoreCached(verse, id);
                updateHighDiffIndex(id, score);
                const item = itemById.get(id);
                if (item && !item.querySelector('.diff-badge')) {
                    item.appendChild(createDifferenceBadge(score));
                }
            }
            processedCount += 1;
        }

        if (pending.length > 0 && jobId === differenceBadgeJobId) {
            requestIdleWork(hydrateChunk, { timeout: 700 });
        }
    };

    requestIdleWork(hydrateChunk, { timeout: 700 });
}

function renderSpeechBlockList() {
    const frag = document.createDocumentFragment();

    getVisibleSpeechBlocks().forEach(block => {
        const li = document.createElement('li');
        li.className = 'list-item speech-block-item';
        if (block.id === activeSpeechBlockId) li.classList.add('active');
        li.dataset.id = block.id;
        li.dataset.type = 'speech-block';

        const title = document.createElement('span');
        title.className = 'verse-ref';
        title.textContent = block.title;

        const range = document.createElement('span');
        range.className = 'speech-block-range';
        range.textContent = block.startRef === block.endRef ? block.startRef : `${block.startRef}-${block.endRef.replace(`${block.book} `, '')}`;

        li.append(title, range);
        frag.appendChild(li);
    });

    speechBlockListEl.replaceChildren(frag);
}

function renderCategories(filterQuery = "") {
    const frag = document.createDocumentFragment();

    for (const [category, vIds] of Object.entries(categoryMap)) {
        if (filterQuery && !category.toLowerCase().includes(filterQuery)) continue;
        const count = vIds.length;
        if (count === 0 && !filterQuery) continue;

        const card = document.createElement('div');
        card.className = 'dashboard-card';
        card.dataset.category = category;
        card.dataset.type = 'category';

        const title = document.createElement('h3');
        title.textContent = category;
        const countLabel = document.createElement('span');
        countLabel.className = 'card-count';
        countLabel.textContent = `${count} Verses`;
        card.append(title, countLabel);
        frag.appendChild(card);
    }

    dashboardGrid.replaceChildren(frag);
}

function renderHomePage() {
    const demoVerseEl = document.getElementById('demo-verse');
    const verse = dataset[HOME_CONFIG.featuredVerseId];
    if (verse && demoVerseEl) {
        const processed = buildProcessedTranslations(verse, HOME_CONFIG.featuredVerseId);
        const compContainer = document.createElement('div');
        compContainer.className = 'comparison-table';

        compContainer.appendChild(createTranslationCard('DBH', processed, true));
        compContainer.appendChild(createTranslationCard('NRSVUE', processed, true));
        compContainer.appendChild(createTranslationCard('LAMSA', processed, true));

        demoVerseEl.replaceChildren(compContainer);
    }

    const browseGrid = document.getElementById('browse-grid');
    if (browseGrid) {
        const frag = document.createDocumentFragment();
        HOME_CONFIG.browsePaths.forEach(path => {
            const card = document.createElement('button');
            card.className = 'browse-card';
            card.type = 'button';
            card.textContent = path.label;
            card.addEventListener('click', () => {
                switchToAppMode('verse');
                setActiveVerse(path.verseId);
            });
            frag.appendChild(card);
        });
        browseGrid.replaceChildren(frag);
    }
}

function switchToAppMode(mode) {
    initializeAppShell();
    document.body.classList.remove('home-active');
    document.body.classList.add('app-active');

    if (mode === 'verse' && readingMode !== 'verse') setReadingMode('verse');

    const targetBtn = document.querySelector(`.toggle-btn[data-mode="${mode}"]`);
    if (targetBtn && !targetBtn.classList.contains('active')) {
        targetBtn.click();
    }

    if (activeVerseId && !comparisonTable.hasChildNodes()) {
        renderComparison(activeVerseId);
    }
}

function showHomePage() {
    document.body.classList.add("home-active");
    document.body.classList.remove("app-active");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

document.getElementById('sidebar-content').addEventListener('click', (e) => {
    const li = e.target.closest('.list-item');
    if (!li) return;
    if (li.dataset.type === 'speech-block') {
        setActiveSpeechBlock(li.dataset.id);
        return;
    }
    if (li.dataset.type === 'verse') setActiveVerse(li.dataset.id);
});

dashboardGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.dashboard-card');
    if (!card) return;
    activeCategory = card.dataset.category;
    sidebarSearch.value = "";
    updateViewLayer();
});

function handleSearch(query) {
    if (readingMode === 'speech') {
        renderSpeechBlockList();
    } else if (currentMode === 'verse') {
        renderVerses(getVisibleVerseIds(allVerseIds, query), verseListEl);
    } else if (currentMode === 'study') {
        if (activeCategory) {
            renderVerses(getVisibleVerseIds(categoryMap[activeCategory], query), studyVerseListEl);
        } else {
            renderCategories(query);
        }
    }
}

function getVisibleSpeechBlocks(query = sidebarSearch.value.toLowerCase().trim()) {
    const selectedBook = bookFilter.value;
    return SPEECH_BLOCKS.filter(block => {
        if (selectedBook && block.book !== selectedBook) return false;
        if (!query) return true;
        return `${block.title} ${block.startRef} ${block.endRef} ${block.contextLabel}`.toLowerCase().includes(query);
    });
}

function getVisibleVerseIds(sourceIds = allVerseIds, query = sidebarSearch.value.toLowerCase().trim()) {
    const selectedBook = bookFilter.value;
    return sourceIds.filter(id => {
        const v = dataset[id];
        if (!v) return false;
        if (selectedBook && v.book !== selectedBook) return false;
        if (diffOnlyFilter.checked && !highDiffIds.has(id)) return false;
        if (!query) return true;

        const ref = `${v.book} ${v.chapter}:${v.verse}`.toLowerCase();
        if (ref.includes(query)) return true;
        return TRANSLATIONS.some(name => getTranslationText(id, v, name).toLowerCase().includes(query));
    });
}

function setActiveVerse(id) {
    initializeAppShell({ renderComparison: false });
    if (!dataset[id]) return;
    readingMode = 'verse';
    readingModeBtns.forEach(btn => {
        const isActive = btn.dataset.readingMode === 'verse';
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });
    activeVerseId = id;
    document.querySelectorAll('.list-item.active').forEach(el => el.classList.remove('active'));
    document.querySelectorAll(`.list-item[data-id="${cssEscape(id)}"]`).forEach(el => el.classList.add('active'));
    renderComparison(id);
}

function setActiveSpeechBlock(blockId) {
    const block = SPEECH_BLOCKS.find(item => item.id === blockId);
    if (!block) return;
    readingMode = 'speech';
    readingModeBtns.forEach(btn => {
        const isActive = btn.dataset.readingMode === 'speech';
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });
    activeSpeechBlockId = blockId;
    document.querySelectorAll('.list-item.active').forEach(el => el.classList.remove('active'));
    document.querySelectorAll(`.list-item[data-id="${cssEscape(blockId)}"]`).forEach(el => el.classList.add('active'));
    renderSpeechBlockComparison(blockId);
}

function moveActiveVerse(direction) {
    if (readingMode === 'speech') {
        const visibleBlocks = getVisibleSpeechBlocks();
        const currentIndex = visibleBlocks.findIndex(block => block.id === activeSpeechBlockId);
        if (currentIndex === -1 || visibleBlocks.length === 0) return;
        const nextIndex = Math.max(0, Math.min(visibleBlocks.length - 1, currentIndex + direction));
        setActiveSpeechBlock(visibleBlocks[nextIndex].id);
        return;
    }

    const source = currentMode === 'study' && activeCategory ? categoryMap[activeCategory] : allVerseIds;
    const visible = getVisibleVerseIds(source);
    const currentIndex = visible.indexOf(activeVerseId);
    if (currentIndex === -1 || visible.length === 0) return;
    const nextIndex = Math.max(0, Math.min(visible.length - 1, currentIndex + direction));
    setActiveVerse(visible[nextIndex]);
}

function renderComparison(id) {
    const verse = dataset[id];
    if (!verse) return;

    activeReference.textContent = verse.reference;
    activeAnchor.textContent = verse.anchor?.BSB ? verse.anchor.BSB : '';
    renderContextLabel(showContext ? getSmallestBlockForVerseId(id)?.contextLabel : '');

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
    activeAnchor.textContent = block.startRef === block.endRef ? block.startRef : `${block.startRef}-${block.endRef.replace(`${block.book} `, '')}`;
    renderContextLabel(showContext ? block.contextLabel : '');

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
        TRANSLATIONS.forEach(name => {
            rows.appendChild(createTranslationCard(name, processed, true));
        });
    } else {
        rows.appendChild(createTranslationCard(activeTranslationTab, processed, false));
    }

    comparisonTable.replaceChildren(rows);
}

function renderSpeechBlockRows(block, processed) {
    const rows = document.createDocumentFragment();

    if (activeTranslationTab === 'Compare') {
        TRANSLATIONS.forEach(name => rows.appendChild(createSpeechBlockTranslationCard(name, block, processed, true)));
    } else {
        rows.appendChild(createSpeechBlockTranslationCard(activeTranslationTab, block, processed, false));
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
    const currentText = processed[name].text;
    const spans = processed[name].highlights || [];
    text.innerHTML = renderHighlightedText(currentText, spans, currentHighlightMode);

    row.append(label, text);
    return row;
}

function createSpeechBlockTranslationCard(name, block, processed, compact) {
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
        const verseText = formatDisplayText(getTranslationText(verseId, verse, name));
        if (!verseText) return;

        const segment = document.createElement('span');
        segment.className = 'speech-verse-segment';

        const ref = document.createElement('span');
        ref.className = 'inline-verse-ref';
        ref.textContent = verse.reference || `${verse.book} ${verse.chapter}:${verse.verse}`;

        const words = document.createElement('span');
        words.className = 'speech-verse-text';
        const otherTexts = TRANSLATIONS
            .filter(item => item !== name)
            .map(item => formatDisplayText(getTranslationText(verseId, verse, item)));
        const spans = buildHighlightSpans(verseText, otherTexts, currentHighlightMode, name);
        words.innerHTML = renderHighlightedText(verseText, spans, currentHighlightMode);

        segment.append(ref, document.createTextNode(' '), words, document.createTextNode(' '));
        text.appendChild(segment);
    });

    row.append(label, text);
    return row;
}

function renderPhraseGrid(processed) {
    const frag = document.createDocumentFragment();
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
        frag.appendChild(row);
    });
    phraseGrid.replaceChildren(frag);
}

function renderDifferenceSummary(processed) {
    const groups = buildDifferenceGroups(processed);
    if (groups.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No major word-level differences detected.';
        differenceSummary.replaceChildren(empty);
        return;
    }

    const table = document.createElement('div');
    table.className = 'difference-table';

    groups.slice(0, 12).forEach(group => {
        const item = document.createElement('div');
        item.className = group.critical ? 'key-difference-item critical' : 'key-difference-item';

        const word = document.createElement('div');
        word.className = group.critical ? 'difference-phrase critical' : 'difference-phrase';
        word.textContent = group.term;

        const meta = document.createElement('div');
        meta.className = 'difference-meta';
        meta.textContent = `Unique to ${group.translations.join(', ')}`;

        item.append(word, meta);
        table.appendChild(item);
    });
    differenceSummary.replaceChildren(table);
}

function renderCoverage(processed) {
    const frag = document.createDocumentFragment();
    TRANSLATIONS.forEach(name => {
        const item = document.createElement('div');
        item.className = 'coverage-item';
        const status = processed[name].text ? 'Present' : 'Missing';
        const label = document.createElement('span');
        label.textContent = name;
        const value = document.createElement('strong');
        value.textContent = status;
        item.append(label, value);
        frag.appendChild(item);
    });
    coverageSummary.replaceChildren(frag);
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
    const visible = getVisibleVerseIds(source);
    const index = visible.indexOf(activeVerseId);
    btnPrevVerse.disabled = index <= 0;
    btnNextVerse.disabled = index === -1 || index >= visible.length - 1;
}

function buildProcessedTranslations(verse, verseId = '') {
    const processed = {};
    TRANSLATIONS.forEach(name => {
        const text = formatDisplayText(getTranslationText(verseId, verse, name));
        const tokens = tokenizeText(text).map(token => token.normalized);
        processed[name] = {
            text,
            tokens,
            tokenSet: new Set(tokens),
            highlights: []
        };
    });

    TRANSLATIONS.forEach(name => {
        const otherTranslationTexts = TRANSLATIONS
            .filter(item => item !== name)
            .map(item => processed[item].text);
        processed[name].highlights = buildHighlightSpans(processed[name].text, otherTranslationTexts, currentHighlightMode, name);
    });

    return processed;
}

function buildProcessedSpeechBlock(block) {
    const processed = {};

    TRANSLATIONS.forEach(name => {
        const text = block.verseIds
            .map(verseId => formatDisplayText(getTranslationText(verseId, dataset[verseId], name)))
            .filter(Boolean)
            .join(' ');
        const tokens = tokenizeText(text).map(token => token.normalized);
        processed[name] = {
            text,
            tokens,
            tokenSet: new Set(tokens),
            highlights: []
        };
    });

    TRANSLATIONS.forEach(name => {
        const otherTranslationTexts = TRANSLATIONS
            .filter(item => item !== name)
            .map(item => processed[item].text);
        processed[name].highlights = buildHighlightSpans(processed[name].text, otherTranslationTexts, currentHighlightMode, name);
    });

    return processed;
}

function buildDifferenceGroups(processed) {
    const map = new Map();
    TRANSLATIONS.forEach(name => {
        processed[name].highlights.forEach(span => {
            const key = `${span.normalized}:${span.type}`;
            if (!map.has(key)) {
                map.set(key, {
                    term: span.text,
                    translations: [],
                    critical: span.type === 'critical',
                    type: span.type
                });
            }
            map.get(key).translations.push(name);
        });
    });

    return Array.from(map.values()).sort((a, b) => {
        if (a.critical !== b.critical) return a.critical ? -1 : 1;
        return a.term.localeCompare(b.term);
    });
}

function splitPhrases(text) {
    if (!text) return ['Missing translation'];
    return text
        .split(/(?<=[.;:!?])\s+|,\s+|—/)
        .map(part => part.trim())
        .filter(Boolean)
        .slice(0, 12);
}

function phraseHasHighlights(phrase, highlights) {
    const phraseTokens = new Set(tokenizeText(phrase).map(token => token.normalized));
    return highlights.some(span => span.normalized.split(/\s+/).some(token => phraseTokens.has(token)));
}

function getDifferenceScore(verse, verseId = '') {
    const displayVerse = {
        ...verse,
        translations: Object.fromEntries(TRANSLATIONS.map(name => [
            name,
            getTranslationText(verseId, verse, name)
        ]))
    };
    const highlights = analyzeVerseHighlights(displayVerse, TRANSLATIONS, 'meaning');
    return TRANSLATIONS.reduce((score, name) => score + highlights[name].reduce((total, span) => {
        if (span.type === 'critical') return total + 3;
        if (span.type === 'interpretive') return total + 2;
        return total + 1;
    }, 0), 0);
}

function getDifferenceScoreCached(verse, verseId = '') {
    if (differenceScoreCache.has(verseId)) return differenceScoreCache.get(verseId);
    const score = getDifferenceScore(verse, verseId);
    differenceScoreCache.set(verseId, score);
    updateHighDiffIndex(verseId, score);
    return score;
}

function updateHighDiffIndex(verseId, score) {
    if (score >= 10) {
        highDiffIds.add(verseId);
    } else {
        highDiffIds.delete(verseId);
    }
}

function ensureHighDiffIndex() {
    if (highDiffIndexReady || highDiffIndexStarted || allVerseIds.length === 0) return;
    highDiffIndexStarted = true;
    const pending = allVerseIds.filter(id => !differenceScoreCache.has(id));

    const buildChunk = (deadline) => {
        let processedCount = 0;
        while (
            pending.length > 0 &&
            (deadline.timeRemaining() > 5 || deadline.didTimeout || processedCount < 8) &&
            processedCount < 20
        ) {
            const id = pending.shift();
            const verse = dataset[id];
            if (verse) getDifferenceScoreCached(verse, id);
            processedCount += 1;
        }

        const now = Date.now();
        if (diffOnlyFilter.checked && !pendingHighDiffRender && now - lastHighDiffRenderAt > 120) {
            pendingHighDiffRender = true;
            lastHighDiffRenderAt = now;
            window.requestAnimationFrame(() => {
                pendingHighDiffRender = false;
                handleSearch(sidebarSearch.value.toLowerCase().trim());
            });
        }

        if (pending.length > 0) {
            requestIdleWork(buildChunk, { timeout: 250 });
            return;
        }

        highDiffIndexReady = true;
        if (diffOnlyFilter.checked) handleSearch(sidebarSearch.value.toLowerCase().trim());
    };

    requestIdleWork(buildChunk, { timeout: 250 });
}

function getBlocksForVerseId(verseId) {
    return SPEECH_BLOCKS.filter(block => block.verseIds.includes(verseId));
}

function getSmallestBlockForVerseId(verseId) {
    return getBlocksForVerseId(verseId).sort((a, b) => a.verseIds.length - b.verseIds.length)[0] || null;
}

function getVersesForBlock(blockId) {
    const block = SPEECH_BLOCKS.find(item => item.id === blockId);
    return block ? block.verseIds.map(verseId => dataset[verseId]).filter(Boolean) : [];
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

function getTranslationText(verseId, verse, translationName) {
    return getDisplayJesusText(verseId, verse, translationName);
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return value.replace(/"/g, '\\"');
}

function htmlToNodes(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    return Array.from(template.content.childNodes);
}
