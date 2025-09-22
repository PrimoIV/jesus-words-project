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

  // Hide all tab content
  function hideAllTabs() {
    tabContents.forEach(tab => (tab.style.display = 'none'));
  }

  // Show a tab content div (if present)
  function showTab(tabName) {
    hideAllTabs();
    const tab = document.querySelector(`#${tabName}`);
    if (tab) tab.style.display = 'block';
  }

  // Load content dynamically from JSON
  function loadTab(tabName) {
    if (!contentArea) return;
    contentArea.innerHTML = `<p>Loading <strong>${tabName}</strong>...</p>`;

    const dataFiles = {
      home: 'data/home.json',
      sermon: 'data/sermon.json',
      parables: 'data/parables.json',
      sayings: 'data/sayings.json'
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

  // Render JSON content into the content area
  function renderTabContent(data) {
    let html = `<div class="content-card"><h2>${data.title}</h2></div>`;
    if (data.sections) {
      data.sections.forEach(section => {
        html += `<div class="content-card">
          <h3>${section.heading}</h3>
          <p>${section.text}</p>
        </div>`;
      });
    }
    contentArea.innerHTML = html;
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
      console.log('Clicked tab:', selected);
      if (selected) {
        showTab(selected);
        loadTab(selected);
      }
    });
  });

  // Start on home tab by default
  showTab('home');
  loadTab('home');
  // Set home tab as active
  const homeTab = document.querySelector('[data-section="home"]');
  if (homeTab) homeTab.classList.add('active');
});
