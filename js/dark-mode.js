/* dark-mode.js - toggles dark mode and persists preference */
document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('dark-mode-toggle');
    const body = document.body;

    function applyPreference(pref) {
        const isDark = pref === 'dark';
        if (isDark) {
            body.classList.add('dark-mode');
            toggle?.classList.add('active'); // shows sun icon (click to go light)
        } else {
            body.classList.remove('dark-mode');
            toggle?.classList.remove('active'); // shows moon icon (click to go dark)
        }
    }

    // Read saved preference
    const saved = localStorage.getItem('jw:theme');
    if (saved) applyPreference(saved);

    toggle?.addEventListener('click', () => {
        const isDark = body.classList.toggle('dark-mode');
        localStorage.setItem('jw:theme', isDark ? 'dark' : 'light');
        // Update active class for icon swapping
        toggle.classList.toggle('active', isDark);
    });
});
