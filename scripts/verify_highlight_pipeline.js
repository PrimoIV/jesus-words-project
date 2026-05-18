import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    analyzeVerseHighlights,
    formatDisplayText,
    setHighlightReviewLayer
} from '../js/highlightEngine.js';
import { getDisplayJesusText, setJesusSpeechOverrides } from '../js/jesusSpeechText.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const JESUS_SPEECH_OVERRIDES_FILE = path.join(ROOT, 'dev/jesus_speech_overrides.json');
const REVIEW_FILE = path.join(ROOT, 'dev/highlight_review_overrides.json');
const REPORT_FILE = path.join(ROOT, 'dev/reports/highlight_report.json');
const TRANSLATIONS = ['DBH', 'NRSVUE', 'LAMSA'];
const KNOWN_VERSES = ['LUK_8_45'];

const checks = [];

try {
    const dataset = readJson(DATASET_FILE);
    const jesusSpeechOverrides = readJson(JESUS_SPEECH_OVERRIDES_FILE);
    const reviewLayer = fs.existsSync(REVIEW_FILE) ? readJson(REVIEW_FILE) : { overrides: [] };
    const report = fs.existsSync(REPORT_FILE) ? readJson(REPORT_FILE) : null;

    setJesusSpeechOverrides(jesusSpeechOverrides);
    setHighlightReviewLayer(reviewLayer);

    check('dataset loads', () => assert.ok(Object.keys(dataset).length > 0));
    check('Jesus-speech overrides load', () => assert.ok(Object.keys(jesusSpeechOverrides).length > 0));

    check('LUK_8_45 display text is cleaned Jesus speech', () => {
        assert.equal(getDisplayJesusText('LUK_8_45', dataset.LUK_8_45, 'DBH'), 'Who touches me?');
        assert.equal(getDisplayJesusText('LUK_8_45', dataset.LUK_8_45, 'NRSVUE'), 'Who touched me?');
        assert.equal(getDisplayJesusText('LUK_8_45', dataset.LUK_8_45, 'LAMSA'), 'Who touched me?');
    });

    check('display text differs from raw text where override exists', () => {
        Object.entries(jesusSpeechOverrides).forEach(([id, overrides]) => {
            const verse = dataset[id];
            assert.ok(verse, `${id} exists in dataset`);
            TRANSLATIONS.forEach(name => {
                if (typeof overrides[name] !== 'string') return;
                const raw = verse.translations?.[name] || '';
                const display = getDisplayJesusText(id, verse, name);
                assert.notEqual(display, raw, `${id} ${name} display should differ from raw`);
            });
        });
    });

    check('known verse highlights are computed from display text', () => {
        KNOWN_VERSES.forEach(id => {
            const verse = dataset[id];
            const displayVerse = buildDisplayVerse(id, verse);
            const displayHighlights = analyzeVerseHighlights(displayVerse, TRANSLATIONS, 'meaning');
            const rawHighlights = analyzeVerseHighlights(verse, TRANSLATIONS, 'meaning');
            assert.notDeepEqual(compactHighlights(displayHighlights), compactHighlights(rawHighlights), `${id} raw and display highlights should differ`);
        });
    });

    check('highlight report uses display text, not raw text', () => {
        assert.ok(report, 'highlight report exists');
        assert.equal(report.jesusSpeechOverridesFile, 'dev/jesus_speech_overrides.json');

        KNOWN_VERSES.forEach(id => {
            const verse = dataset[id];
            const reportEntry = report.verses.find(item => item.id === id);
            assert.ok(reportEntry, `${id} exists in highlight report`);

            const displayHighlights = analyzeVerseHighlights(buildDisplayVerse(id, verse), TRANSLATIONS, 'meaning');
            assert.deepEqual(reportEntry.highlights, compactHighlights(displayHighlights), `${id} report highlights should match display pipeline`);

            const serialized = JSON.stringify(reportEntry.highlights).toLowerCase();
            ['peter', 'crowds', 'master', 'teacher', 'pressing', 'jostling'].forEach(term => {
                assert.ok(!serialized.includes(term), `${id} report should not include raw mixed-speech term: ${term}`);
            });
        });
    });
} catch (error) {
    checks.push({ name: 'unexpected verification error', passed: false, message: error.message });
}

const failed = checks.filter(item => !item.passed);
checks.forEach(item => {
    console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}${item.message ? `: ${item.message}` : ''}`);
});
console.log(`Highlight pipeline verification: ${checks.length - failed.length}/${checks.length} passed.`);

if (failed.length > 0) {
    process.exitCode = 1;
}

function check(name, fn) {
    try {
        fn();
        checks.push({ name, passed: true });
    } catch (error) {
        checks.push({ name, passed: false, message: error.message });
    }
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildDisplayVerse(id, verse) {
    return {
        ...verse,
        translations: Object.fromEntries(TRANSLATIONS.map(name => [
            name,
            formatDisplayText(getDisplayJesusText(id, verse, name))
        ]))
    };
}

function compactHighlights(highlightsByTranslation) {
    return Object.fromEntries(TRANSLATIONS.map(name => [
        name,
        highlightsByTranslation[name].map(span => ({
            text: span.text,
            type: span.type,
            reason: span.reason,
            matchedGroup: span.matchedGroup,
            matchedTerms: span.matchedTerms || null,
            semanticConfidence: span.semanticConfidence ?? null,
            semanticConfidenceReasons: span.semanticConfidenceReasons || null
        }))
    ]));
}
