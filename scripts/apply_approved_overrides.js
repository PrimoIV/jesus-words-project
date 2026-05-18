import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const REVIEW_FILE = path.join(ROOT, 'dev/reports/jesus_speech_override_review.csv');
const OVERRIDES_FILE = path.join(ROOT, 'dev/jesus_speech_overrides.json');
const REQUIRED_COLUMNS = ['id', 'translation', 'decision', 'finalText', 'notes'];
const NARRATOR_FRAGMENTS = [
    'Jesus said',
    'Jesus answered',
    'saying to him',
    'said to them',
    'him, “',
    'to him,',
    'to them,'
];
const NON_JESUS_ANSWERS = [
    'Yes, Lord',
    'My Lord',
    'Rabbi',
    'Teacher',
    'Legion',
    'We do not know',
    'Caesar',
    'Seven',
    'Twelve',
    'No'
];

if (!fs.existsSync(REVIEW_FILE)) {
    throw new Error('Missing dev/reports/jesus_speech_override_review.csv. Run create_override_review_sheet.js first.');
}

const rows = parseCsv(fs.readFileSync(REVIEW_FILE, 'utf8'));
const missingColumns = REQUIRED_COLUMNS.filter(column => !rows.columns.includes(column));
if (missingColumns.length > 0) {
    throw new Error(`Review CSV is missing required columns: ${missingColumns.join(', ')}`);
}

const overrides = fs.existsSync(OVERRIDES_FILE)
    ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'))
    : {};
const summary = {
    approvedRows: 0,
    skippedRows: 0,
    updatedVerseIds: 0,
    emptyOverrides: 0
};
const updatedVerseIds = new Set();

rows.records.forEach((row, index) => {
    if (String(row.decision || '').trim().toLowerCase() !== 'approve') {
        summary.skippedRows += 1;
        return;
    }

    const finalText = row.finalText ?? '';
    validateApprovedRow(row, index + 2);

    if (!overrides[row.id]) overrides[row.id] = {};
    overrides[row.id][row.translation] = finalText;
    summary.approvedRows += 1;
    if (finalText === '') summary.emptyOverrides += 1;
    updatedVerseIds.add(row.id);
});

summary.updatedVerseIds = updatedVerseIds.size;
fs.writeFileSync(OVERRIDES_FILE, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');

console.log(JSON.stringify(summary, null, 2));

function validateApprovedRow(row, lineNumber) {
    const finalText = row.finalText ?? '';
    const notes = row.notes || '';

    if (finalText === '' && !/intentional empty/i.test(notes)) {
        throw new Error(`Line ${lineNumber}: approved empty finalText requires notes to include "intentional empty".`);
    }

    const narratorFragment = NARRATOR_FRAGMENTS.find(fragment => finalText.includes(fragment));
    if (narratorFragment) {
        throw new Error(`Line ${lineNumber}: finalText contains narrator fragment "${narratorFragment}".`);
    }

    const nonJesusAnswer = NON_JESUS_ANSWERS.find(fragment => {
        if (fragment === 'No') return /^No[.!?]?$/i.test(finalText.trim());
        return new RegExp(`\\b${escapeRegExp(fragment)}\\b`, 'i').test(finalText);
    });
    if (nonJesusAnswer) {
        throw new Error(`Line ${lineNumber}: finalText contains likely non-Jesus answer "${nonJesusAnswer}".`);
    }
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        const next = text[i + 1];

        if (inQuotes && char === '"' && next === '"') {
            field += '"';
            i += 1;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (!inQuotes && char === ',') {
            row.push(field);
            field = '';
        } else if (!inQuotes && (char === '\n' || char === '\r')) {
            if (char === '\r' && next === '\n') i += 1;
            row.push(field);
            if (row.some(value => value !== '')) rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }

    if (field !== '' || row.length > 0) {
        row.push(field);
        if (row.some(value => value !== '')) rows.push(row);
    }

    const columns = rows.shift() || [];
    return {
        columns,
        records: rows.map(values => Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ''])))
    };
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
