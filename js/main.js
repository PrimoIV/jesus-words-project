/* =========================
   MAIN.JS - Jesus Words Project
   ========================= */
console.log("main.js loaded");

/* ---------
   TAB SYSTEM (keeps responsibility for tabs/content)
   --------- */
document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.tab-button');
  const contentArea = document.getElementById('content-area');
  const tabContents = document.querySelectorAll('.tab-content');
  const searchPanel = document.getElementById('search-panel');
  const searchInput = document.getElementById('search-input');
    // === Persistent User Settings (localStorage) ===
    const SETTINGS_KEY = 'jesusWordsUserSettings';
    // Default settings
    const defaultSettings = {
      darkMode: false,
      highContrast: false,
      largeText: false,
      reduceMotion: false,
      translationViews: {} // { verse: 'side' | 'nrsv' | 'lamsa' | 'hart' }
    };
    // Load settings from localStorage
    function loadSettings() {
      try {
        return Object.assign({}, defaultSettings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
      } catch (e) {
        return { ...defaultSettings };
      }
    }
    // Save settings to localStorage
    function saveSettings(settings) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
    let userSettings = loadSettings();

    // === Apply settings to UI ===
    function applySettings() {
      document.body.classList.toggle('dark-mode', !!userSettings.darkMode);
      document.body.classList.toggle('high-contrast', !!userSettings.highContrast);
      document.body.classList.toggle('large-text', !!userSettings.largeText);
      document.body.classList.toggle('reduce-motion', !!userSettings.reduceMotion);
      // Update toggles if present
      const darkToggle = document.getElementById('dark-mode-toggle');
      if (darkToggle) darkToggle.checked = !!userSettings.darkMode;
      const hcToggle = document.getElementById('high-contrast-toggle');
      if (hcToggle) hcToggle.checked = !!userSettings.highContrast;
      const largeToggle = document.getElementById('large-text-toggle');
      if (largeToggle) largeToggle.checked = !!userSettings.largeText;
      const rmToggle = document.getElementById('reduce-motion-toggle');
      if (rmToggle) rmToggle.checked = !!userSettings.reduceMotion;
    }
    // Initial application
    applySettings();

    // === Listen for toggle changes and save ===
    function setupSettingsListeners() {
      const darkToggle = document.getElementById('dark-mode-toggle');
      if (darkToggle) darkToggle.addEventListener('change', e => {
        userSettings.darkMode = !!darkToggle.checked;
        saveSettings(userSettings);
        applySettings();
      });
      const hcToggle = document.getElementById('high-contrast-toggle');
      if (hcToggle) hcToggle.addEventListener('change', e => {
        userSettings.highContrast = !!hcToggle.checked;
        saveSettings(userSettings);
        applySettings();
      });
      const largeToggle = document.getElementById('large-text-toggle');
      if (largeToggle) largeToggle.addEventListener('change', e => {
        userSettings.largeText = !!largeToggle.checked;
        saveSettings(userSettings);
        applySettings();
      });
      const rmToggle = document.getElementById('reduce-motion-toggle');
      if (rmToggle) rmToggle.addEventListener('change', e => {
        userSettings.reduceMotion = !!rmToggle.checked;
        saveSettings(userSettings);
        applySettings();
      });
    }
    setupSettingsListeners();

  // Hide all tab content and panels
  function hideAllTabs() {
    tabContents.forEach(tab => (tab.style.display = 'none'));
    if (contentArea) contentArea.style.display = 'none';
    if (searchPanel) searchPanel.style.display = 'none';
  }

  // Show a tab content div (if present), or the search panel
  function showTab(tabName) {
    hideAllTabs();
    if (tabName === 'search') {
      if (searchPanel) searchPanel.style.display = 'block';
      if (searchInput) setTimeout(() => searchInput.focus(), 50);
    } else {
      if (contentArea) contentArea.style.display = 'block';
      const tab = document.querySelector(`#${tabName}`);
      if (tab) tab.style.display = 'block';
    }
  }

  // Load content dynamically from JSON (multi-translation aware)
  function loadTab(tabName) {
    if (!contentArea) return;
    contentArea.innerHTML = `<p>Loading <strong>${tabName}</strong>...</p>`;

    // Only Jesus-words tabs use multi-translation
    const jesusTabs = ['sermon', 'parables', 'sayings'];
    if (jesusTabs.includes(tabName)) {
      // Fetch all three translations in parallel
      Promise.all([
        fetch('data/nrsv.json').then(r => r.json()),
        fetch('data/lamsa.json').then(r => r.json()),
        fetch('data/hart.json').then(r => r.json())
      ]).then(([nrsv, lamsa, hart]) => {
        renderJesusWordsTab(tabName, nrsv, lamsa, hart);
      }).catch(err => {
        contentArea.innerHTML = `<p>Error loading translations.</p>`;
        console.error('Failed to load translation JSONs:', err);
      });
      return;
    }

    // Home and other tabs: fallback to old logic
    const dataFiles = {
      home: 'data/home.json',
      search: 'data/home.json' // fallback for now
    };
    const file = dataFiles[tabName];
    if (!file) {
      contentArea.innerHTML = `<p>No content yet for <strong>${tabName}</strong>.</p>`;
      return;
    }
    fetch(file)
      .then(response => response.json())
      .then(data => {
        renderTabContent(data);
      })
      .catch(err => {
        contentArea.innerHTML = `<p>Error loading content.</p>`;
        console.error(`Failed to load ${file}:`, err);
      });
  }

  // Render Jesus-words tab with side-by-side translations and layered commentary
  function renderJesusWordsTab(tabName, nrsv, lamsa, hart) {
    // For now, use a static list of verses (expand as needed)
    const verses = Object.keys(nrsv);
    let html = `<div class="content-card"><h2>${tabName === 'sermon' ? 'Sermon on the Mount' : tabName.charAt(0).toUpperCase() + tabName.slice(1)}</h2></div>`;
    verses.forEach(verse => {
      const n = nrsv[verse] || {};
      const l = lamsa[verse] || {};
      const h = hart[verse] || {};
      // Advanced difference highlighting for all three translations
      const diffs = getTranslationDiffsAdv(n.text, l.text, h.text, n.redLetterRanges, l.redLetterRanges, h.redLetterRanges);
      html += `
      <div class="verse-card" data-verse="${verse}">
        <div class="verse-header">
          <span class="verse-ref"><b>${verse}</b></span>
          <div class="view-toggle-wrap">
            <label for="view-toggle-${verse}" class="sr-only">Toggle translation view</label>
            <select class="view-toggle" id="view-toggle-${verse}">
              <option value="side">Side-by-side</option>
              <option value="nrsv">NRSV only</option>
              <option value="lamsa">Lamsa only</option>
              <option value="hart">Hart only</option>
            </select>
          </div>
        </div>
        <div class="translation-side-by-side side-by-side-active highlight-differences" data-verse="${verse}">
          <div class="translation-col sync-scroll" data-trans="nrsv">
            <div class="translation-label"><b>NRSV</b></div>
            <div class="translation-text">${diffs.nrsv}</div>
          </div>
          <div class="translation-col sync-scroll" data-trans="lamsa">
            <div class="translation-label"><b>Lamsa</b></div>
            <div class="translation-text">${diffs.lamsa}</div>
          </div>
          <div class="translation-col sync-scroll" data-trans="hart">
            <div class="translation-label"><b>Hart</b></div>
            <div class="translation-text">${diffs.hart}</div>
          </div>
        </div>
        <button class="commentary-toggle" aria-expanded="false" aria-controls="commentary-${verse}">Show Commentary</button>
        <div class="commentary-section" id="commentary-${verse}" style="display:none;">
          ${renderLayeredCommentary(n.commentary, l.commentary, h.commentary)}
        </div>
    </div>`;
  });
  contentArea.innerHTML = html;

    // Commentary toggle logic
    const toggles = contentArea.querySelectorAll('.commentary-toggle');
    toggles.forEach(btn => {
      btn.addEventListener('click', function() {
        const card = btn.closest('.verse-card');
        const comm = card.querySelector('.commentary-section');
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        if (expanded) {
          comm.classList.remove('open');
          setTimeout(() => { comm.style.display = 'none'; }, 500);
        } else {
          comm.style.display = 'block';
          setTimeout(() => { comm.classList.add('open'); }, 10);
        }
        btn.setAttribute('aria-expanded', (!expanded).toString());
        btn.textContent = expanded ? 'Show Commentary' : 'Hide Commentary';
      });
    });

    // Synchronized vertical scrolling for translation columns in each card
    const verseCards = contentArea.querySelectorAll('.verse-card');
    verseCards.forEach(card => {
      const cols = card.querySelectorAll('.translation-col.sync-scroll');
      cols.forEach(col => {
        col.addEventListener('scroll', function(e) {
          if (col._syncingScroll) return;
          cols.forEach(other => {
            if (other !== col) {
              other._syncingScroll = true;
              other.scrollTop = col.scrollTop;
              setTimeout(() => { other._syncingScroll = false; }, 1);
            }
          });
        });
      });
      // View toggle logic
      const toggle = card.querySelector('.view-toggle');
      const sideBySide = card.querySelector('.translation-side-by-side');
      const colN = card.querySelector('.translation-col[data-trans="nrsv"]');
      const colL = card.querySelector('.translation-col[data-trans="lamsa"]');
      const colH = card.querySelector('.translation-col[data-trans="hart"]');
      // Restore saved translation view if present
      const verse = card.getAttribute('data-verse');
      if (verse && userSettings.translationViews[verse]) {
        toggle.value = userSettings.translationViews[verse];
        const val = toggle.value;
        if (val === 'side') {
          sideBySide.classList.add('side-by-side-active');
          sideBySide.classList.remove('single-translation');
          colN.style.display = '';
          colL.style.display = '';
          colH.style.display = '';
        } else {
          sideBySide.classList.remove('side-by-side-active');
          sideBySide.classList.add('single-translation');
          colN.style.display = val === 'nrsv' ? '' : 'none';
          colL.style.display = val === 'lamsa' ? '' : 'none';
          colH.style.display = val === 'hart' ? '' : 'none';
        }
      }
      toggle.addEventListener('change', function() {
        const val = toggle.value;
        // Save per-verse translation view
        if (verse) {
          userSettings.translationViews[verse] = val;
          saveSettings(userSettings);
        }
        if (val === 'side') {
          sideBySide.classList.add('side-by-side-active');
          sideBySide.classList.remove('single-translation');
          colN.style.display = '';
          colL.style.display = '';
          colH.style.display = '';
        } else {
          sideBySide.classList.remove('side-by-side-active');
          sideBySide.classList.add('single-translation');
          colN.style.display = val === 'nrsv' ? '' : 'none';
          colL.style.display = val === 'lamsa' ? '' : 'none';
          colH.style.display = val === 'hart' ? '' : 'none';
        }
      });
    });

    // Per-layer commentary toggles (modern, with chevrons and animation)
    const layerToggles = contentArea.querySelectorAll('.comm-layer-toggle');
    layerToggles.forEach(btn => {
      btn.addEventListener('click', function() {
        // Use aria-controls to select the correct content by ID
        const contentId = btn.getAttribute('aria-controls');
        const content = contentId ? document.getElementById(contentId) : null;
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        const chevron = btn.querySelector('.chevron');
        if (content) {
          if (expanded) {
            content.style.maxHeight = '0px';
            content.style.opacity = '0';
            btn.setAttribute('aria-expanded', 'false');
            btn.classList.remove('open');
            if (chevron) chevron.textContent = '▶'; // Right chevron when closed
            setTimeout(() => { content.style.display = 'none'; }, 300);
          } else {
            content.style.display = 'block';
            setTimeout(() => {
              content.style.maxHeight = content.scrollHeight + 'px';
              content.style.opacity = '1';
            }, 10);
            btn.setAttribute('aria-expanded', 'true');
            btn.classList.add('open');
            if (chevron) chevron.textContent = '▼'; // Down chevron when open
          }
        }
      });
    });
  }

  // Escape HTML for safe rendering
  function escapeHTML(str) {
    if (typeof str !== 'string') str = String(str);
    return str.replace(/[&<>"']/g, function(m) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m];
    });
  }

  // Render JSON content into the content area (multi-translation card layout)
  function renderTabContent(data) {
    let html = `<div class="content-card"><h2>${data.title}</h2></div>`;
    // Determine if this is a Jesus-words section (sermon, parables, sayings)
    const isJesusWords = ["Sermon on the Mount", "Parables of Jesus", "Sayings and Teachings of Jesus"].includes(data.title);
    if (data.sections) {
      data.sections.forEach(section => {
        if (isJesusWords) {
          // Highlight differences between translations and wrap Jesus' words in red
          const diffs = getTranslationDiffs(section.nrsv, section.lamsa, section.hart);
          html += `<div class="verse-card">
            <div class="verse-header">
              <span class="verse-ref"><b>${section.verse || ''}</b></span>
            </div>
            <div class="translation-side-by-side side-by-side-active highlight-differences">
              <div class="translation-col">
                <div class="translation-label"><b>NRSV</b></div>
                <div class="translation-text">${diffs.nrsv}</div>
              </div>
              <div class="translation-col">
                <div class="translation-label"><b>Lamsa</b></div>
                <div class="translation-text">${diffs.lamsa}</div>
              </div>
              <div class="translation-col">
                <div class="translation-label"><b>Hart</b></div>
                <div class="translation-text">${diffs.hart}</div>
              </div>
            </div>
            <button class="commentary-toggle" aria-expanded="false" aria-controls="commentary-${section.verse}">Show Commentary</button>
            <div class="commentary-section" id="commentary-${section.verse}" style="display:none;">
              <div class="commentary-type commentary-esoteric">${section.commentary || ''}</div>
            </div>
          </div>`;
        } else {
          // Home/instructions: render plain, no red-letter, center title
          html += `<div class="content-card">
            <h3 style="text-align:center;">${section.verse || ''}</h3>
            <p>${section.nrsv || ''}</p>
            <div class="commentary-type commentary-esoteric">${section.commentary || ''}</div>
          </div>`;
        }
      });
    }
    contentArea.innerHTML = html;

    // Commentary toggle logic (only for Jesus-words sections)
    if (isJesusWords) {
      const toggles = contentArea.querySelectorAll('.commentary-toggle');
      toggles.forEach(btn => {
        btn.addEventListener('click', function() {
          const card = btn.closest('.verse-card');
          const comm = card.querySelector('.commentary-section');
          const expanded = btn.getAttribute('aria-expanded') === 'true';
          if (expanded) {
            comm.classList.remove('open');
            setTimeout(() => { comm.style.display = 'none'; }, 500);
          } else {
            comm.style.display = 'block';
            setTimeout(() => { comm.classList.add('open'); }, 10);
          }
          btn.setAttribute('aria-expanded', (!expanded).toString());
          btn.textContent = expanded ? 'Show Commentary' : 'Hide Commentary';
        });
      });
    }
  }

  // Enhanced word-level diff for three translations, with red-letter for Jesus' words
  function getTranslationDiffs(nrsv, lamsa, hart) {
    // Split into words
    const n = (nrsv || '').split(/(\s+)/);
    const l = (lamsa || '').split(/(\s+)/);
    const h = (hart || '').split(/(\s+)/);
    // Find words that differ at each position
    const maxLen = Math.max(n.length, l.length, h.length);
    let outN = '', outL = '', outH = '';
    for (let i = 0; i < maxLen; i++) {
      const nw = n[i] || '';
      const lw = l[i] || '';
      const hw = h[i] || '';
      // Assume all words are Jesus' words, so wrap all in red-letter
      const redN = `<span class='red-letter'>${nw}</span>`;
      const redL = `<span class='red-letter'>${lw}</span>`;
      const redH = `<span class='red-letter'>${hw}</span>`;
      if (nw !== lw || nw !== hw || lw !== hw) {
        // Highlight differences, add tooltip with all versions
        outN += `<span class="diff" title="Lamsa: ${lw}\nHart: ${hw}">${redN}</span>`;
        outL += `<span class="diff" title="NRSV: ${nw}\nHart: ${hw}">${redL}</span>`;
        outH += `<span class="diff" title="NRSV: ${nw}\nLamsa: ${lw}">${redH}</span>`;
      } else {
        outN += redN;
        outL += redL;
        outH += redH;
      }
    }
    return { nrsv: outN, lamsa: outL, hart: outH };
  }

  // Advanced word-level diff for three translations, with red-letter for Jesus' words and tooltips for nuance/context
  function getTranslationDiffsAdv(nrsv, lamsa, hart, nRanges, lRanges, hRanges) {
    // Split into words (keep spaces)
    const n = (nrsv || '').split(/(\s+)/);
    const l = (lamsa || '').split(/(\s+)/);
    const h = (hart || '').split(/(\s+)/);
    const maxLen = Math.max(n.length, l.length, h.length);
    let outN = '', outL = '', outH = '';
    for (let i = 0; i < maxLen; i++) {
      const nw = n[i] || '';
      const lw = l[i] || '';
      const hw = h[i] || '';
      // Red-letter for each translation
      const redN = wrapRedLetter(nw, i, n, nRanges);
      const redL = wrapRedLetter(lw, i, l, lRanges);
      const redH = wrapRedLetter(hw, i, h, hRanges);
      if (nw !== lw || nw !== hw || lw !== hw) {
        // Highlight differences, add tooltip with all versions and nuance
        outN += `<span class="diff" title="Lamsa: ${lw}\nHart: ${hw}">${redN}</span>`;
        outL += `<span class="diff" title="NRSV: ${nw}\nHart: ${hw}">${redL}</span>`;
        outH += `<span class="diff" title="NRSV: ${nw}\nLamsa: ${lw}">${redH}</span>`;
      } else {
        outN += redN;
        outL += redL;
        outH += redH;
      }
    }
    return { nrsv: outN, lamsa: outL, hart: outH };
  }
  // Helper: wrap word in red-letter if in redLetterRanges

  // Render layered commentary for a verse (NRSV, Lamsa, Hart)
  function renderLayeredCommentary(nComment, lComment, hComment) {
    // If all are empty or missing, show a message
    if (!(nComment || lComment || hComment)) {
      return '<div class="no-commentary">No commentary available for this verse.</div>';
    }
    return `
      <div class="commentary-columns">
        ${nComment ? `<div class="commentary-col"><b>NRSV Commentary</b><div>${escapeHTML(nComment)}</div></div>` : ''}
        ${lComment ? `<div class="commentary-col"><b>Lamsa Commentary</b><div>${escapeHTML(lComment)}</div></div>` : ''}
        ${hComment ? `<div class="commentary-col"><b>Hart Commentary</b><div>${escapeHTML(hComment)}</div></div>` : ''}
      </div>
    `;
  }
  function wrapRedLetter(word, idx, arr, ranges) {
    if (!ranges || !ranges.length) return escapeHTML(word);
    // Calculate char offset for this word
    let offset = 0;
    for (let i = 0; i < idx; i++) offset += (arr[i] || '').length;
    // If this offset is in any range, wrap
    for (const [start, end] of ranges) {
      if (offset >= start && offset < end) {
        return `<span class='red-letter'>${escapeHTML(word)}</span>`;
      }
    }
    return escapeHTML(word);
  }

  // Render layered commentary for a verse (NRSV, Lamsa, Hart)
  function renderLayeredCommentary(nComment, lComment, hComment) {
    // If all are empty or missing, show a message
    if (!(nComment || lComment || hComment)) {
      return '<div class="no-commentary">No commentary available for this verse.</div>';
    }
    return `
      <div class="commentary-columns">
        ${nComment ? `<div class="commentary-col"><b>NRSV Commentary</b><div>${escapeHTML(nComment)}</div></div>` : ''}
        ${lComment ? `<div class="commentary-col"><b>Lamsa Commentary</b><div>${escapeHTML(lComment)}</div></div>` : ''}
        ${hComment ? `<div class="commentary-col"><b>Hart Commentary</b><div>${escapeHTML(hComment)}</div></div>` : ''}
      </div>
    `;
  }

  // Set up click listeners for tab buttons
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs
      tabs.forEach(t => t.classList.remove('active'));
      // Add active class to clicked tab
      tab.classList.add('active');

      // buttons in the markup use data-section
      const selected = tab.dataset.section || tab.dataset.tab;
      if (selected) {
        showTab(selected);
        loadTab(selected); // Always loadTab, even for 'search' and 'home'
        // Reset search input/results if leaving search
        if (selected !== 'search') {
          const searchInput = document.getElementById('search-input');
          const searchResults = document.getElementById('search-results');
          if (searchInput) searchInput.value = '';
          if (searchResults) searchResults.innerHTML = '';
        }
      }
    });
  });

  // Start on home tab by default
  showTab('home');
  loadTab('home');
  // Set home tab as active
  const homeTab = document.querySelector('[data-section="home"]');
  if (homeTab) homeTab.classList.add('active');
  // End of DOMContentLoaded
});

