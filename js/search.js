/* search.js - basic search over JSON data files */
document.addEventListener('DOMContentLoaded', () => {
	const input = document.getElementById('search-input');
	const results = document.getElementById('search-results');

	const files = ['data/home.json','data/sermon.json','data/parables.json','data/sayings.json'];
	let indexed = [];

	function indexFiles() {
		Promise.all(files.map(f => fetch(f).then(r => r.json()).catch(()=>null)))
		.then(dataArr => {
			indexed = [];
			dataArr.forEach(obj => {
				if (!obj) return;
				const title = obj.title || '';
				if (obj.sections) {
					obj.sections.forEach(sec => {
						indexed.push({title, heading: sec.heading, text: sec.text});
					});
				}
			});
		});
	}

  function renderResults(items, q) {
    if (!results) return;
    if (!items.length) {
      results.innerHTML = `<div class="content-card"><p>No results for <strong>${q}</strong></p></div>`;
      return;
    }
    results.innerHTML = items.map(it => 
      `<div class="content-card">
        <h3>${it.heading}</h3>
        <p>${it.text}</p>
        <small style="color: var(--text-color); opacity: 0.7;">From: ${it.title}</small>
      </div>`
    ).join('');
  }	input?.addEventListener('input', e => {
		const q = e.target.value.trim().toLowerCase();
		if (q.length < 2) { results.innerHTML = ''; return; }
		const hits = indexed.filter(i => (i.heading + ' ' + i.text + ' ' + i.title).toLowerCase().includes(q));
		renderResults(hits, q);
	});

	indexFiles();
});
