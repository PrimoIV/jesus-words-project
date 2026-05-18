// js/dev/stressTest.js

export async function runHighlightStressTest({
    dataset,
    allVerseIds,
    getDisplayText,
    processWords,
    generateHighlightedNodes
}) {
    try {
        if (typeof getDisplayText !== "function") {
            console.warn("Highlight stress test skipped: getDisplayText callback is required.");
            return;
        }

        const res = await fetch("./dev/test-data/test_verses.json");
        if (!res.ok) {
            console.warn("Highlight stress test skipped: test data not found.");
            return;
        }
        const verses = await res.json();

        console.log("=== Highlight Stress Test Start ===");

        for (const ref of verses) {
            const parts = ref.split(" ");
            const book = parts[0];
            const cv = parts[1].split(":");
            const chapter = cv[0];
            const verse = cv[1];

            const matchId = allVerseIds.find(id => {
                const v = dataset[id];
                return (
                    v.book === book &&
                    String(v.chapter) === String(chapter) &&
                    String(v.verse) === String(verse)
                );
            });

            if (!matchId) {
                console.warn("Missing dataset entry:", ref);
                continue;
            }

            const v = dataset[matchId];
            if (!v) {
                console.warn("Missing dataset entry:", matchId, ref);
                continue;
            }

            const dbhText = getDisplayText(matchId, v, "DBH");
            const nrsvueText = getDisplayText(matchId, v, "NRSVUE");
            const lamsaText = getDisplayText(matchId, v, "LAMSA");

            const dbhProc = processWords(dbhText);
            const nrsvueProc = processWords(nrsvueText);
            const lamsaProc = processWords(lamsaText);

            const nodesDbh = generateHighlightedNodes(
                dbhProc.words,
                nrsvueProc.tokenSet,
                lamsaProc.tokenSet
            );

            const chunksDbh = nodesDbh.filter(node => node.nodeType === Node.ELEMENT_NODE && node.matches('[data-highlight-type]')).length;

            console.log(ref, "=>", chunksDbh, "chunks", nodesDbh.map(node => node.textContent).join(""));
        }

        console.log("=== Highlight Stress Test End ===");
    } catch (err) {
        console.error("Stress test failed:", err);
    }
}
