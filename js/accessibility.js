(function(){
  // accessibility.js - render options and toggle accessibility classes
  document.addEventListener('DOMContentLoaded', () => {
    const accToggle = document.getElementById('accessibility-toggle');
    const accMenu = document.getElementById('accessibility-menu');

    // Toggle menu visibility
    function toggleMenu() {
      const isHidden = accMenu.hasAttribute('hidden');
      if (isHidden) {
        positionMenu();
        accMenu.removeAttribute('hidden');
        // Add backdrop for click-outside-to-close
        setTimeout(() => {
          document.addEventListener('click', handleOutsideClick);
        }, 100);
      } else {
        closeMenu();
      }
    }

    function positionMenu() {
      if (!accToggle || !accMenu) return;
      
      // Temporarily show menu to get its dimensions
      accMenu.style.visibility = 'hidden';
      accMenu.style.display = 'block';
      accMenu.removeAttribute('hidden');
      
      const buttonRect = accToggle.getBoundingClientRect();
      const menuRect = accMenu.getBoundingClientRect();
      
      // Position menu above the button with some spacing
      const topPosition = buttonRect.top - menuRect.height - 10;
      const leftPosition = buttonRect.left;
      
      // Make sure menu doesn't go off screen
      const finalTop = Math.max(10, topPosition);
      const finalLeft = Math.min(leftPosition, window.innerWidth - menuRect.width - 10);
      
      accMenu.style.position = 'fixed';
      accMenu.style.top = `${finalTop}px`;
      accMenu.style.left = `${finalLeft}px`;
      accMenu.style.bottom = 'auto';
      accMenu.style.visibility = 'visible';
      accMenu.style.display = 'block';
    }

    function closeMenu() {
      accMenu.setAttribute('hidden', '');
      document.removeEventListener('click', handleOutsideClick);
    }

    function handleOutsideClick(e) {
      if (!accMenu.contains(e.target) && !accToggle.contains(e.target)) {
        closeMenu();
      }
    }

    accToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    const accOptions = [
      { id: 'high-contrast', label: 'High Contrast Mode', icon: '🔆' },
      { id: 'large-text', label: 'Increase Font Size', icon: '🔤' },
      { id: 'reduce-motion', label: 'Reduce Motion', icon: '⏸️' },
      { id: 'simplified-view', label: 'Simplified View', icon: '📄' }
    ];

    function renderAccessibilityOptions() {
      if (!accMenu) return;
      const list = accMenu.querySelector('ul');
      list.innerHTML = '';
      accOptions.forEach(opt => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.innerHTML = `${opt.icon} ${opt.label}`;
        button.setAttribute('data-option', opt.id);
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleAccessibility(opt.id);
          updateButtonStates();
        });
        li.appendChild(button);
        list.appendChild(li);
      });
      updateButtonStates();
    }

    function toggleAccessibility(optionId) {
      document.body.classList.toggle(optionId);
      console.log('Toggled accessibility:', optionId);
      
      // Save accessibility preferences
      const preferences = JSON.parse(localStorage.getItem('jw:accessibility') || '{}');
      preferences[optionId] = document.body.classList.contains(optionId);
      localStorage.setItem('jw:accessibility', JSON.stringify(preferences));
    }

    function updateButtonStates() {
      accOptions.forEach(opt => {
        const button = accMenu.querySelector(`[data-option="${opt.id}"]`);
        if (button) {
          const isActive = document.body.classList.contains(opt.id);
          button.setAttribute('aria-pressed', isActive);
        }
      });
    }

    // Load saved accessibility preferences
    function loadAccessibilityPreferences() {
      const preferences = JSON.parse(localStorage.getItem('jw:accessibility') || '{}');
      Object.keys(preferences).forEach(optionId => {
        if (preferences[optionId]) {
          document.body.classList.add(optionId);
        }
      });
    }

    loadAccessibilityPreferences();
    renderAccessibilityOptions();
  });
})();