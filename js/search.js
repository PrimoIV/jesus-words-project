/* search.js - basic search over JSON data files */
document.addEventListener('DOMContentLoaded', () => {
		const input = document.getElementById('search-input');
		const results = document.getElementById('search-results');

		// Index all translations and commentary layers for every verse
		const files = [
			'data/sermon.json',
			'data/parables.json',
			'data/sayings.json',
			'data/home.json',
			'data/nrsv.json',
			'data/lamsa.json',
			'data/hart.json'
		];
		let indexed = [];

		function indexFiles() {
				Promise.all(files.map(f => fetch(f).then(r => r.json()).catch(()=>null)))
				.then(dataArr => {
					indexed = [];
							// Index structured (sections-based) files
							dataArr.forEach((obj, idx) => {
								if (!obj) return;
								const title = obj.title || files[idx];
								if (obj.sections) {
									obj.sections.forEach(sec => {
										// Index only the actual words of Jesus from all translations
										['nrsv','lamsa','hart'].forEach(tr => {
											if (sec[tr]) {
												indexed.push({
													type: 'translation',
													translation: tr,
													verse: sec.verse || '',
													text: sec[tr],
													commentary: '',
													title
												});
											}
										});
										// Do NOT index commentary at all
									});
								}
							});
							// Index verse-based translation files (nrsv/lamsa/hart.json)
							['nrsv','lamsa','hart'].forEach((tr, i) => {
								const obj = dataArr[4+i];
								if (!obj) return;
								Object.entries(obj).forEach(([verse, val]) => {
									if (val.text) {
										indexed.push({
											type: 'translation',
											translation: tr,
											verse,
											text: val.text,
											commentary: '',
											title: tr.toUpperCase()
										});
									}
									// Do NOT index commentary at all
								});
							});
				});
		}

		function highlight(text, q) {
			if (!q) return text;
			// Escape regex special chars
			const escQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			return text.replace(new RegExp(escQ, 'gi'), m => `<mark>${m}</mark>`);
		}

		function renderResults(items, q) {
			if (!results) return;
			if (!items.length) {
				results.innerHTML = `<div class="content-card"><p>No results for <strong>${q}</strong></p></div>`;
				return;
			}
			results.innerHTML = items.map((it, idx) => {
				// Add data attributes for tab and verse for navigation
				let tab = '';
				// Try to infer tab from title or verse
				if (it.title && it.title.toLowerCase().includes('sermon')) tab = 'sermon';
				else if (it.title && it.title.toLowerCase().includes('parable')) tab = 'parables';
				else if (it.title && it.title.toLowerCase().includes('saying')) tab = 'sayings';
				else if (it.verse && it.verse.match(/^matthew|^luke|^john|^mark/i)) {
					// Guess based on verse location
					if (it.verse.toLowerCase().includes('matthew 5') || it.verse.toLowerCase().includes('matthew 6') || it.verse.toLowerCase().includes('matthew 7')) tab = 'sermon';
					else if (it.verse.toLowerCase().includes('luke 10') || it.verse.toLowerCase().includes('luke 15') || it.verse.toLowerCase().includes('matthew 13')) tab = 'parables';
					else tab = 'sayings';
				}
				return `<div class="content-card search-result-card" tabindex="0" data-tab="${tab}" data-verse="${it.verse || ''}">
					<div style="font-size:0.95em; color:var(--text-color); opacity:0.7;">${it.verse ? `<b>${it.verse}</b> &mdash; ` : ''}${it.title}${it.layer ? ' ('+it.layer+')' : ''}</div>
					<div>${highlight(it.text, q)}</div>
				</div>`;
			}).join('');

			// Add click listeners to cards for navigation
			Array.from(results.querySelectorAll('.search-result-card')).forEach(card => {
				card.addEventListener('click', function() {
					const tab = card.getAttribute('data-tab');
					const verse = card.getAttribute('data-verse');
					if (!tab || !verse) return;
					// Switch to the correct tab
					const tabBtn = document.querySelector(`.tab-button[data-section="${tab}"]`);
					if (tabBtn) tabBtn.click();
					// Wait for content to load, then scroll to the verse card
					setTimeout(() => {
						const cardEl = document.querySelector(`.verse-card[data-verse="${verse}"]`);
						if (cardEl) {
							cardEl.scrollIntoView({behavior: 'smooth', block: 'center'});
							cardEl.classList.add('search-highlight');
							setTimeout(() => cardEl.classList.remove('search-highlight'), 2000);
						}
					}, 400);
				});
			});
		}

		input?.addEventListener('input', e => {
			const q = e.target.value.trim().toLowerCase();
			if (q.length < 2) { results.innerHTML = ''; return; }
			// Search all fields for the query
			const hits = indexed.filter(i =>
				(i.text && i.text.toLowerCase().includes(q)) ||
				(i.commentary && i.commentary.toLowerCase().includes(q)) ||
				(i.verse && i.verse.toLowerCase().includes(q)) ||
				(i.title && i.title.toLowerCase().includes(q))
			);
			renderResults(hits, q);
		});

		indexFiles();
});
