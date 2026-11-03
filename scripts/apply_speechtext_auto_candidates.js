const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATASET_FILE = path.join(ROOT, 'data', 'jesus_verses_final.json');
const REVIEW_FILE = path.join(ROOT, 'dev', 'reports', 'speech_contamination_review.csv');
const REPORT_FILE = path.join(ROOT, 'dev', 'reports', 'speechtext_auto_apply_preview.json');
const APPLY = process.argv.includes('--apply');

const TRANSLATIONS = new Set(['DBH', 'NRSVUE', 'LAMSA']);

main();

function main() {
    const dataset = readJson(DATASET_FILE);
    const csv = fs.readFileSync(REVIEW_FILE, 'utf8');
    const rows = parseCsv(csv);

    const applied = [];
    const skipped = [];

    for (const row of rows.slice(1)) {
        const [
            id,
            reference,
            translation,
            severity,
            confidence,
            flags,
            action,
            rawText,
            suggestedSpeechText,
            bsbAnchor,
            notes
        ] = row;

        if (!id || !TRANSLATIONS.has(translation)) continue;

        if (action !== 'auto_extract_candidate') {
            skipped.push({ id, reference, translation, reason: `action=${action || 'blank'}` });
            continue;
        }

        if (!suggestedSpeechText || !suggestedSpeechText.trim()) {
            skipped.push({ id, reference, translation, reason: 'blank suggestedSpeechText' });
            continue;
        }

        const verse = dataset[id];
        if (!verse) {
            skipped.push({ id, reference, translation, reason: 'verse missing from dataset' });
            continue;
        }

        const cleanText = normalizeSpeechText(suggestedSpeechText);

        if (!cleanText) {
            skipped.push({ id, reference, translation, reason: 'cleanText empty after normalization' });
            continue;
        }

        if (!verse.speechText || typeof verse.speechText !== 'object') {
            verse.speechText = {};
        }

        const before = verse.speechText[translation] || '';
        verse.speechText[translation] = cleanText;

        applied.push({
            id,
            reference,
            translation,
            before,
            after: cleanText
        });
    }

    const report = {
        mode: APPLY ? 'apply' : 'preview',
        source: path.relative(ROOT, REVIEW_FILE),
        dataset: path.relative(ROOT, DATASET_FILE),
        appliedCount: applied.length,
        skippedCount: skipped.length,
        applied,
        skippedSample: skipped.slice(0, 200)
    };

    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

    if (APPLY) {
        const backupFile = DATASET_FILE.replace(
            /\.json$/,
            `.backup-before-speechtext-auto-${timestamp()}.json`
        );
        fs.copyFileSync(DATASET_FILE, backupFile);
        fs.writeFileSync(DATASET_FILE, JSON.stringify(dataset, null, 2) + '\n');
        console.log(`Applied ${applied.length} speechText values.`);
        console.log(`Backup written: ${path.relative(ROOT, backupFile)}`);
    } else {
        console.log(`Preview only. Would apply ${applied.length} speechText values.`);
        console.log('Run with --apply to write changes.');
    }

    console.log(`Report written: ${path.relative(ROOT, REPORT_FILE)}`);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeSpeechText(value) {
    return String(value)
        .replace(/\s+/g, ' ')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .trim();
}

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                field += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            row.push(field);
            field = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') i++;
            row.push(field);
            if (row.some(cell => cell.trim() !== '')) rows.push(row);
            row = [];
            field = '';
            continue;
        }

        field += char;
    }

    row.push(field);
    if (row.some(cell => cell.trim() !== '')) rows.push(row);

    return rows;
}
