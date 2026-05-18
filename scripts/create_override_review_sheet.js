import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DRAFT_FILE = path.join(ROOT, 'dev/reports/jesus_speech_override_draft.json');
const EXISTING_OVERRIDES_FILE = path.join(ROOT, 'dev/jesus_speech_overrides.json');
const OUTPUT_FILE = path.join(ROOT, 'dev/reports/jesus_speech_override_review_v2.csv');
const BOM = '\uFEFF';
const TRANSLATIONS = ['DBH', 'NRSVUE', 'LAMSA'];
const COLUMNS = [
    'id',
    'reference',
    'translation',
    'original',
    'proposedText',
    'confidence',
    'speakerRisk',
    'reason',
    'decision',
    'finalText',
    'notes'
];

if (!fs.existsSync(DRAFT_FILE)) {
    throw new Error('Missing dev/reports/jesus_speech_override_draft.json. Run draft_jesus_speech_overrides.js first.');
}

const draft = JSON.parse(fs.readFileSync(DRAFT_FILE, 'utf8'));
const existingOverrides = fs.existsSync(EXISTING_OVERRIDES_FILE)
    ? JSON.parse(fs.readFileSync(EXISTING_OVERRIDES_FILE, 'utf8'))
    : {};
const rows = [];

(draft.drafts || [])
    .filter(item => !existingOverrides[item.id])
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach(item => {
        TRANSLATIONS.forEach(translation => {
            const proposal = item.translations?.[translation] || {};
            const proposedText = proposal.proposedText ?? '';
            rows.push({
                id: item.id,
                reference: item.reference || '',
                translation,
                original: proposal.original || '',
                proposedText,
                confidence: proposal.confidence || '',
                speakerRisk: proposal.speakerRisk || '',
                reason: proposal.reason || '',
                decision: '',
                finalText: proposedText,
                notes: ''
            });
        });
    });

const csv = [
    COLUMNS.join(','),
    ...rows.map(row => COLUMNS.map(column => csvEscape(row[column])).join(','))
].join('\n');

fs.writeFileSync(OUTPUT_FILE, `${BOM}${csv}\n`, 'utf8');

const nonNullProposals = rows.filter(row => row.proposedText !== '').length;
const nullProposals = rows.length - nonNullProposals;

console.log(`Review CSV written to ${path.relative(ROOT, OUTPUT_FILE).replace(/\\/g, '/')}`);
console.log(`Rows: ${rows.length}`);
console.log(`Non-null proposals: ${nonNullProposals}`);
console.log(`Null proposals: ${nullProposals}`);

function csvEscape(value) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}
