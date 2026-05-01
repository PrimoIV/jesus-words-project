// js/dev/stressTest.js

export async function runHighlightStressTest({
    dataset,
    allVerseIds,
    processWords,
    generateHighlightedHTML
}) {
    try {
        const res = await fetch("./dev/test-data/test_verses.json");
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

            const trans = v.translations || {};
            const dbhText = trans.DBH || "";
            const nrsvueText = trans.NRSVUE || "";
            const lamsaText = trans.LAMSA || "";

            const dbhProc = processWords(dbhText);
            const nrsvueProc = processWords(nrsvueText);
            const lamsaProc = processWords(lamsaText);

            const htmlDbh = generateHighlightedHTML(
                dbhProc.words,
                nrsvueProc.tokenSet,
                lamsaProc.tokenSet
            );

            const chunksDbh = (htmlDbh.match(/<span/g) || []).length;

            console.log(ref, "=>", chunksDbh, "chunks", htmlDbh);
        }

        console.log("=== Highlight Stress Test End ===");
    } catch (err) {
        console.error("Stress test failed:", err);
    }
}
