/* notes.js - add/edit/save notes per section/verse, persistent in localStorage */
document.addEventListener('DOMContentLoaded', () => {
	// Listen for content card rendering
	const contentArea = document.getElementById('content-area');
	if (!contentArea) return;

	// Observe changes to contentArea (for dynamic tab loads)
	const observer = new MutationObserver(() => {
		attachNotesUI();
	});
	observer.observe(contentArea, { childList: true });

	function getNotes() {
		return JSON.parse(localStorage.getItem('jw:notes') || '{}');
	}
	function saveNotes(notes) {
		localStorage.setItem('jw:notes', JSON.stringify(notes));
	}

	function attachNotesUI() {
		// For each content card, add a notes textarea
		const cards = contentArea.querySelectorAll('.content-card');
		if (!cards.length) return;
		const notes = getNotes();
		cards.forEach((card, idx) => {
			// Use heading as unique key (could be improved)
			const heading = card.querySelector('h3')?.textContent || card.querySelector('h2')?.textContent || `section${idx}`;
			let noteKey = heading.replace(/\s+/g, '_').toLowerCase();
			// Avoid duplicate note areas
			if (card.querySelector('.notes-area')) return;
			const notesDiv = document.createElement('div');
			notesDiv.className = 'notes-area';
			notesDiv.style.marginTop = '1.2rem';
			notesDiv.innerHTML = `
				<label style="font-size:0.95em; color:var(--text-color); opacity:0.7;">My Notes:</label>
				<textarea style="width:100%; min-height:60px; border-radius:8px; border:1px solid var(--border-color); margin-top:0.3em; padding:0.5em; background:var(--card-bg); color:var(--text-color); resize:vertical;" placeholder="Add your notes here...">${notes[noteKey]||''}</textarea>
			`;
			const textarea = notesDiv.querySelector('textarea');
			textarea.addEventListener('input', () => {
				const updated = getNotes();
				updated[noteKey] = textarea.value;
				saveNotes(updated);
			});
			card.appendChild(notesDiv);
		});
	}

	// Initial attach (in case content is already loaded)
	attachNotesUI();
});
