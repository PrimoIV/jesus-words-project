import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEECH_BLOCKS, SPEECH_BLOCK_SKIPPED_IDS } from '../js/speechBlocks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const SOURCE_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const REPORT_DIR = path.join(ROOT, 'dev/reports');
const REPORT_FILE = path.join(REPORT_DIR, 'speech_blocks_audit.json');
const REQUIRED_FIELDS = ['id', 'title', 'verseIds', 'startRef', 'endRef', 'contextLabel'];

if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error('Missing source dataset: data/jesus_verses_final.json.');
}

const dataset = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
const report = {
    generatedAt: new Date().toISOString(),
    sourceFile: path.relative(ROOT, SOURCE_FILE).replace(/\\/g, '/'),
    summary: {
        totalBlocks: SPEECH_BLOCKS.length,
        validBlocks: 0,
        invalidBlocks: 0,
        totalVerseRefs: 0,
        missingVerseRefs: 0,
        skippedIds: SPEECH_BLOCK_SKIPPED_IDS.length
    },
    blocks: [],
    skippedIds: SPEECH_BLOCK_SKIPPED_IDS
};

SPEECH_BLOCKS.forEach(block => {
    const missingFields = REQUIRED_FIELDS.filter(field => {
        if (field === 'verseIds') return !Array.isArray(block.verseIds) || block.verseIds.length === 0;
        return !block[field];
    });
    const missingVerseIds = (block.verseIds || []).filter(verseId => !dataset[verseId]);
    const valid = missingFields.length === 0 && missingVerseIds.length === 0;

    report.summary.totalVerseRefs += Array.isArray(block.verseIds) ? block.verseIds.length : 0;
    report.summary.missingVerseRefs += missingVerseIds.length;
    report.summary.validBlocks += valid ? 1 : 0;
    report.summary.invalidBlocks += valid ? 0 : 1;

    report.blocks.push({
        id: block.id || null,
        title: block.title || null,
        startRef: block.startRef || null,
        endRef: block.endRef || null,
        verseCount: Array.isArray(block.verseIds) ? block.verseIds.length : 0,
        missingFields,
        missingVerseIds,
        valid
    });
});

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Speech block audit written to ${path.relative(ROOT, REPORT_FILE).replace(/\\/g, '/')}`);
console.log(`${report.summary.validBlocks}/${report.summary.totalBlocks} blocks valid; ${report.summary.missingVerseRefs} missing verse references.`);
