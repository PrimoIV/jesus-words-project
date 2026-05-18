import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    analyzeVerseHighlights,
    buildHighlightSpansWithDiagnostics,
    formatDisplayText,
    setHighlightReviewLayer
} from '../js/highlightEngine.js';
import { getDisplayJesusText, setJesusSpeechOverrides } from '../js/jesusSpeechText.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const SOURCE_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const REPORT_DIR = path.join(ROOT, 'dev/reports');
const REPORT_FILE = path.join(REPORT_DIR, 'highlight_report.json');
const REVIEW_FILE = path.join(ROOT, 'dev/highlight_review_overrides.json');
const JESUS_SPEECH_OVERRIDES_FILE = path.join(ROOT, 'dev/jesus_speech_overrides.json');
const TRANSLATIONS = ['DBH', 'NRSVUE', 'LAMSA'];
const TYPES = ['wording', 'meaning', 'interpretive', 'critical'];
const phraseFrequency = new Map();
const interpretivePairFrequency = new Map();
const suppressedLowSignalFrequency = new Map();
const suppressedByConfidenceFrequency = new Map();
const suppressedSingleWordFrequency = new Map();
const verseCounts = [];

if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error('Missing source dataset: data/jesus_verses_final.json.');
}

const raw = fs.readFileSync(SOURCE_FILE, 'utf8');
const dataset = JSON.parse(raw);
const reviewLayer = fs.existsSync(REVIEW_FILE)
    ? JSON.parse(fs.readFileSync(REVIEW_FILE, 'utf8'))
    : { overrides: [] };
setHighlightReviewLayer(reviewLayer);
const jesusSpeechOverrides = fs.existsSync(JESUS_SPEECH_OVERRIDES_FILE)
    ? JSON.parse(fs.readFileSync(JESUS_SPEECH_OVERRIDES_FILE, 'utf8'))
    : {};
setJesusSpeechOverrides(jesusSpeechOverrides);
const verses = Object.entries(dataset);
const report = {
    generatedAt: new Date().toISOString(),
    sourceFile: path.relative(ROOT, SOURCE_FILE).replace(/\\/g, '/'),
    reviewFile: fs.existsSync(REVIEW_FILE) ? path.relative(ROOT, REVIEW_FILE).replace(/\\/g, '/') : null,
    jesusSpeechOverridesFile: fs.existsSync(JESUS_SPEECH_OVERRIDES_FILE) ? path.relative(ROOT, JESUS_SPEECH_OVERRIDES_FILE).replace(/\\/g, '/') : null,
    summary: {
        totalVerses: verses.length,
        versesWithHighlights: 0,
        totalHighlights: 0,
        suppressedLowSignalCount: 0,
        suppressedByConfidenceCount: 0,
        survivingSingleWordMeaningCount: 0,
        byType: Object.fromEntries(TYPES.map(type => [type, 0]))
    },
    verses: []
};

verses.forEach(([id, verse]) => {
    const displayVerse = {
        ...verse,
        translations: Object.fromEntries(TRANSLATIONS.map(name => [
            name,
            formatDisplayText(getDisplayJesusText(id, verse, name))
        ]))
    };
    const analyzed = analyzeVerseHighlights(displayVerse, TRANSLATIONS, 'meaning');
    const compactHighlights = {};
    let verseHighlightCount = 0;

    TRANSLATIONS.forEach(name => {
        const otherTexts = TRANSLATIONS
            .filter(item => item !== name)
            .map(item => displayVerse.translations[item] || '');
        const diagnostics = buildHighlightSpansWithDiagnostics(displayVerse.translations[name] || '', otherTexts, 'meaning', name);
        diagnostics.suppressedLowSignal.forEach(span => {
            report.summary.suppressedLowSignalCount += 1;
            incrementMap(suppressedLowSignalFrequency, span.normalized, {
                text: span.text,
                normalized: span.normalized,
                type: span.type
            });
            if (isSingleWord(span.normalized)) {
                incrementMap(suppressedSingleWordFrequency, span.normalized, {
                    text: span.text,
                    normalized: span.normalized,
                    suppression: 'low-signal'
                });
            }
        });
        diagnostics.suppressedByConfidence.forEach(span => {
            report.summary.suppressedByConfidenceCount += 1;
            incrementMap(suppressedByConfidenceFrequency, span.normalized, {
                text: span.text,
                normalized: span.normalized,
                type: span.type,
                semanticConfidence: span.semanticConfidence,
                semanticConfidenceReasons: span.semanticConfidenceReasons
            });
            if (isSingleWord(span.normalized)) {
                incrementMap(suppressedSingleWordFrequency, span.normalized, {
                    text: span.text,
                    normalized: span.normalized,
                    suppression: 'confidence',
                    semanticConfidence: span.semanticConfidence,
                    semanticConfidenceReasons: span.semanticConfidenceReasons
                });
            }
        });

        compactHighlights[name] = analyzed[name].map(span => {
            report.summary.totalHighlights += 1;
            report.summary.byType[span.type] += 1;
            verseHighlightCount += 1;
            if (span.type === 'meaning' && isSingleWord(span.normalized)) {
                report.summary.survivingSingleWordMeaningCount += 1;
            }
            incrementMap(phraseFrequency, `${span.type}:${span.normalized}`, {
                text: span.text,
                normalized: span.normalized,
                type: span.type
            });
            if (span.type === 'interpretive') {
                getInterpretivePairs(span).forEach(pair => {
                    incrementMap(interpretivePairFrequency, pair.key, {
                        source: pair.source,
                        matched: pair.matched,
                        matchedGroup: span.matchedGroup
                    });
                });
            }
            return {
                text: span.text,
                type: span.type,
                reason: span.reason,
                matchedGroup: span.matchedGroup,
                matchedTerms: span.matchedTerms || null,
                semanticConfidence: span.semanticConfidence ?? null,
                semanticConfidenceReasons: span.semanticConfidenceReasons || null
            };
        });
    });

    if (verseHighlightCount > 0) report.summary.versesWithHighlights += 1;
    verseCounts.push({
        id,
        reference: verse.reference || `${verse.book || ''} ${verse.chapter || ''}:${verse.verse || ''}`.trim(),
        highlightCount: verseHighlightCount,
        byType: Object.fromEntries(TYPES.map(type => [
            type,
            Object.values(analyzed).flat().filter(span => span.type === type).length
        ]))
    });

    report.verses.push({
        id,
        reference: verse.reference || `${verse.book || ''} ${verse.chapter || ''}:${verse.verse || ''}`.trim(),
        highlights: compactHighlights
    });
});

report.summary.top25VersesByHighlightCount = topEntries(verseCounts, item => item.highlightCount, 25);
report.summary.top50HighlightedPhrasesByFrequency = topMapEntries(phraseFrequency, 50);
report.summary.top50InterpretivePairsFound = topMapEntries(interpretivePairFrequency, 50);
report.summary.top50SuppressedLowSignalTerms = topMapEntries(suppressedLowSignalFrequency, 50);
report.summary.top50SuppressedByConfidenceTerms = topMapEntries(suppressedByConfidenceFrequency, 50);
report.summary.top50RemainingMeaningTerms = topMapEntries(
    new Map(Array.from(phraseFrequency.entries()).filter(([, value]) => value.type === 'meaning')),
    50
);
report.summary.topMeaningPhrasesLength2Plus = topMapEntries(
    new Map(Array.from(phraseFrequency.entries()).filter(([, value]) => value.type === 'meaning' && !isSingleWord(value.normalized))),
    50
);
report.summary.topSuppressedSingleWords = topMapEntries(suppressedSingleWordFrequency, 50);

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Highlight report written to ${path.relative(ROOT, REPORT_FILE).replace(/\\/g, '/')}`);
console.log(`Analyzed ${report.summary.totalVerses} verses; ${report.summary.versesWithHighlights} have highlights.`);

function incrementMap(map, key, value) {
    const current = map.get(key);
    if (current) {
        current.count += 1;
        return;
    }
    map.set(key, { ...value, count: 1 });
}

function topMapEntries(map, limit) {
    return Array.from(map.values())
        .sort((a, b) => b.count - a.count || String(a.text || a.source).localeCompare(String(b.text || b.source)))
        .slice(0, limit);
}

function topEntries(entries, getCount, limit) {
    return entries
        .filter(entry => getCount(entry) > 0)
        .sort((a, b) => getCount(b) - getCount(a) || a.reference.localeCompare(b.reference))
        .slice(0, limit);
}

function isSingleWord(normalized) {
    return !String(normalized || '').trim().includes(' ');
}

function getInterpretivePairs(span) {
    const source = span.normalized;
    const matchedTerms = span.matchedTerms || [];
    if (matchedTerms.length > 0) {
        return matchedTerms.map(matched => ({
            key: [source, matched].sort().join(' / '),
            source,
            matched
        }));
    }

    return (span.matchedGroup || [])
        .filter(term => term !== source)
        .map(matched => ({
            key: [source, matched].sort().join(' / '),
            source,
            matched
        }));
}
