

import { processWords, generateHighlightedHTML } from './highlightEngine.js';

const DEV_MODE = true;

let dataset = {};
let allVerseIds = [];
let activeVerseId = null;

// Application State
let currentMode = 'verse'; // 'verse' | 'study'
let activeCategory = null;
let categoryMap = {};

// DOM Elements
const sidebarSearch = document.getElementById('sidebar-search');
const toggleBtns = document.querySelectorAll('.toggle-btn');

const viewVerse = document.getElementById('view-verse');
const viewStudyEmpty = document.getElementById('view-study-empty');
const viewStudyDetail = document.getElementById('view-study-detail');

const verseListEl = document.getElementById('verse-list');
const studyVerseListEl = document.getElementById('study-verse-list');
const dashboardGrid = document.getElementById('dashboard-grid');

const btnBackCategories = document.getElementById('btn-back-categories');
const studyDetailTitle = document.getElementById('study-detail-title');

const comparisonView = document.getElementById('comparison-view');
const categoriesDashboard = document.getElementById('categories-dashboard');

const colDbh = document.getElementById('col-dbh');
const colNrsvue = document.getElementById('col-nrsvue');
const colLamsa = document.getElementById('col-lamsa');

// Nuanced Rule Set
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

// ----------------------
// Initialization
// ----------------------
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('data/jesus_verses.json');
        dataset = await response.json();
        allVerseIds = Object.keys(dataset);

        buildCategoryMap();

        // Initial Render
        renderVerses(allVerseIds, verseListEl);

        if (allVerseIds.length > 0) {
            activeVerseId = allVerseIds[0];
            renderComparison(activeVerseId);
        }

        renderCategories();

        // DEV ONLY: run stress test AFTER data is ready
        if (DEV_MODE) {
            const { runHighlightStressTest } = await import('./dev/stressTest.js');
            await runHighlightStressTest({
                dataset,
                allVerseIds,
                processWords,
                generateHighlightedHTML
            });
        }

    } catch (e) {
        console.error("Failed to load dataset", e);
        verseListEl.innerHTML = '<li style="padding:10px; color:red;">Failed to load data</li>';
    }
});
// ----------------------
// Calculate categories at runtime
// ----------------------
function buildCategoryMap() {
    for (const cat in categoryRules) categoryMap[cat] = [];

    allVerseIds.forEach(id => {
        const v = dataset[id];
        if (!v.translations) return;

        const combinedText = Object.values(v.translations).join(" ").toLowerCase();

        for (const [category, keywords] of Object.entries(categoryRules)) {
            const matched = keywords.some(kw => {
                const regex = new RegExp(`\\b${kw}\\b`, 'i');
                return regex.test(combinedText);
            });

            if (matched) categoryMap[category].push(id);
        }
    });
}

// ----------------------
// View Toggles
// ----------------------
toggleBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        toggleBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        currentMode = e.target.dataset.mode;
        updateViewLayer();
        sidebarSearch.value = "";
        handleSearch("");
    });
});

btnBackCategories.addEventListener('click', () => {
    activeCategory = null;
    sidebarSearch.value = "";
    handleSearch("");
    updateViewLayer();
});

function updateViewLayer() {
    // Hide all layers
    [viewVerse, viewStudyEmpty, viewStudyDetail].forEach(el => el.classList.remove('active'));
    [comparisonView, categoriesDashboard].forEach(el => el.classList.remove('active'));

    if (currentMode === 'verse') {
        viewVerse.classList.add('active');
        comparisonView.classList.add('active');
    } else if (currentMode === 'study') {
        if (activeCategory) {
            viewStudyDetail.classList.add('active');
            studyDetailTitle.textContent = activeCategory;

            const verses = categoryMap[activeCategory];
            renderVerses(verses, studyVerseListEl);
            comparisonView.classList.add('active');

            // Auto-select first verse to avoid empty screen
            if (verses && verses.length > 0) {
                activeVerseId = verses[0];
                renderComparison(verses[0]);

                document.querySelectorAll('.list-item.active').forEach(el => el.classList.remove('active'));
                const firstLi = studyVerseListEl.firstElementChild;
                if (firstLi) firstLi.classList.add('active');
            }
        } else {
            viewStudyEmpty.classList.add('active');
            categoriesDashboard.classList.add('active');
        }
    }
}

// ----------------------
// Render Functions
// ----------------------
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

        li.innerHTML = `<span class="book-name">${v.book}</span> ${v.chapter}:${v.verse}`;
        frag.appendChild(li);
    });

    containerDOM.innerHTML = '';
    containerDOM.appendChild(frag);
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

        card.innerHTML = `
            <h3>${category}</h3>
            <span class="card-count">${count} Verses</span>
        `;

        frag.appendChild(card);
    }

    dashboardGrid.innerHTML = '';
    dashboardGrid.appendChild(frag);
}

// ----------------------
// Global click handler for verse lists in sidebar
// ----------------------
document.getElementById('sidebar-content').addEventListener('click', (e) => {
    const li = e.target.closest('.list-item');
    if (!li || li.dataset.type !== 'verse') return;

    const id = li.dataset.id;
    if (id === activeVerseId) return;

    document.querySelectorAll('.list-item.active').forEach(el => el.classList.remove('active'));
    li.classList.add('active');

    activeVerseId = id;
    renderComparison(id);
});

// ----------------------
// Click handler for dashboard cards
// ----------------------
dashboardGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.dashboard-card');
    if (!card) return;

    activeCategory = card.dataset.category;
    sidebarSearch.value = "";
    updateViewLayer();
});

// ----------------------
// Search Logic
// ----------------------
sidebarSearch.addEventListener('input', (e) => {
    handleSearch(e.target.value.toLowerCase().trim());
});

function handleSearch(query) {
    if (currentMode === 'verse') {
        renderVerses(filterVerses(allVerseIds, query), verseListEl);
    } else if (currentMode === 'study') {
        if (activeCategory) {
            renderVerses(filterVerses(categoryMap[activeCategory], query), studyVerseListEl);
        } else {
            renderCategories(query);
        }
    }
}

function filterVerses(sourceIds, query) {
    if (!query) return sourceIds;

    return sourceIds.filter(id => {
        const v = dataset[id];
        if (!v) return false;

        const ref = `${v.book} ${v.chapter}:${v.verse}`.toLowerCase();
        if (ref.includes(query)) return true;

        if (v.translations) {
            for (let t of Object.values(v.translations)) {
                if (t.toLowerCase().includes(query)) return true;
            }
        }

        return false;
    });
}

// ----------------------
// Verse Comparison Rendering
// ----------------------
function renderComparison(id) {
    const v = dataset[id];
    if (!v) return;

    const trans = v.translations || {};

    const dbhText = trans.DBH || '';
    const nrsvueText = trans.NRSVUE || '';
    const lamsaText = trans.LAMSA || '';

    const dbhProc = processWords(dbhText);
    const nrsvueProc = processWords(nrsvueText);
    const lamsaProc = processWords(lamsaText);

    colDbh.innerHTML = generateHighlightedHTML(dbhProc.words, nrsvueProc.tokenSet, lamsaProc.tokenSet);
    colNrsvue.innerHTML = generateHighlightedHTML(nrsvueProc.words, dbhProc.tokenSet, lamsaProc.tokenSet);
    colLamsa.innerHTML = generateHighlightedHTML(lamsaProc.words, dbhProc.tokenSet, nrsvueProc.tokenSet);
}

