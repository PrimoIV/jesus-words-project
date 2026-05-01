const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SOURCE_DIR = path.join(ROOT_DIR, 'docs', 'sources', 'full_txts');
const OUTPUT_DIR = path.join(DATA_DIR, 'translation_verse_maps');
const REPORTS_DIR = path.join(ROOT_DIR, 'dev', 'reports');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const ANCHOR_FILE = path.join(DATA_DIR, 'jesus_index_bsb_anchor.json');
const NRSVUE_JSON_FILE = path.join(SOURCE_DIR, 'nrsvue_json.json');

const BOOK_MAP = {
    'Matthew': 'MAT',
    'Mark': 'MRK',
    'Luke': 'LUK',
    'John': 'JHN',
    'Acts': 'ACT',
    'Revelation': 'REV'
};

function cleanupText(text) {
    if (!text) return "";
    // Strip leading superscript verse numbers: ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ⁰
    let cleaned = text.replace(/^[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, '');
    // Collapse whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

async function run() {
    console.log('Loading anchor data...');
    const anchorData = JSON.parse(fs.readFileSync(ANCHOR_FILE, 'utf-8'));
    const anchorIds = new Set(Object.keys(anchorData));

    // --- NRSVUE (JSON) ---
    if (fs.existsSync(NRSVUE_JSON_FILE)) {
        console.log('Processing NRSVUE (JSON)...');
        const nrsvueRaw = JSON.parse(fs.readFileSync(NRSVUE_JSON_FILE, 'utf-8'));
        
        // The structure is data["New Testament"][bookName][chapter][verse]
        const nt = nrsvueRaw["New Testament"];
        const nrsvueMap = {};
        let nrsvueMatched = 0;

        if (nt) {
            for (const [bookName, chapters] of Object.entries(nt)) {
                const bookCode = BOOK_MAP[bookName];
                if (!bookCode) continue;
                
                for (const [chapterNum, verses] of Object.entries(chapters)) {
                    for (const [verseNum, text] of Object.entries(verses)) {
                        const id = `${bookCode}_${chapterNum}_${verseNum}`;
                        
                        // Only keep IDs that exist in the active anchor/index file
                        if (anchorIds.has(id)) {
                            nrsvueMap[id] = cleanupText(text);
                            nrsvueMatched++;
                        }
                    }
                }
            }
        }

        fs.writeFileSync(path.join(OUTPUT_DIR, 'nrsvue_verse_map.json'), JSON.stringify(nrsvueMap, null, 2));
        
        const missingIds = Array.from(anchorIds).filter(id => !nrsvueMap[id]);
        
        fs.writeFileSync(path.join(REPORTS_DIR, 'nrsvue_raw_mapping_audit.json'), JSON.stringify({ 
            matchedCount: nrsvueMatched, 
            missingCount: missingIds.length,
            missingIds: missingIds.slice(0, 50)
        }, null, 2));
        
        console.log(`  NRSVUE Matched: ${nrsvueMatched} / ${anchorIds.size}`);
    } else {
        console.error(`Error: NRSVUE JSON file not found at ${NRSVUE_JSON_FILE}`);
    }
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
