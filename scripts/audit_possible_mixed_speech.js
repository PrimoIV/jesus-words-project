import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const SOURCE_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const REPORT_DIR = path.join(ROOT, 'dev/reports');
const REPORT_FILE = path.join(REPORT_DIR, 'possible_mixed_speech_audit.json');
const TRANSLATIONS = ['DBH', 'NRSVUE', 'LAMSA'];

const PHRASE_PATTERNS = [
    { label: 'Jesus said', pattern: /\bJesus\s+said\b/i },
    { label: 'Jesus asked', pattern: /\bJesus\s+asked\b/i },
    { label: 'Peter said', pattern: /\bPeter\s+said\b/i },
    { label: 'they said', pattern: /\bthey\s+said\b/i },
    { label: 'answered him', pattern: /\banswered\s+him\b/i },
    { label: 'answered them', pattern: /\banswered\s+them\b/i },
    { label: 'said to him', pattern: /\bsaid\s+to\s+him\b/i },
    { label: 'said to them', pattern: /\bsaid\s+to\s+them\b/i },
    { label: 'Master,', pattern: /\bMaster,\s*/i },
    { label: 'Teacher,', pattern: /\bTeacher,\s*/i }
];
const NAMED_SPEAKER_PATTERN = /\b(Peter|Simon Peter|disciples|Pharisees|Jews|crowd)\b/i;
const JESUS_ATTRIBUTION_PATTERN = /\bJesus\s+(said|asked|answered)\b/i;
const MEDIUM_NARRATION_PATTERNS = /\b(answered\s+him|answered\s+them|said\s+to\s+him|said\s+to\s+them)\b/i;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error('Missing source dataset: data/jesus_verses_final.json.');
}

const dataset = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
const findings = [];

Object.entries(dataset).forEach(([id, verse]) => {
    const translationFindings = {};

    TRANSLATIONS.forEach(name => {
        const text = verse.translations?.[name] || '';
        const matches = PHRASE_PATTERNS
            .filter(item => item.pattern.test(text))
            .map(item => item.label);

        if (countQuoteSegments(text) > 1) matches.push('multiple quote segments');

        if (matches.length > 0) {
            const severityInfo = classifySeverity(text, matches);
            translationFindings[name] = {
                severity: severityInfo.severity,
                recommendedAction: severityInfo.recommendedAction,
                matches: Array.from(new Set(matches)),
                text
            };
        }
    });

    if (Object.keys(translationFindings).length > 0) {
        const severity = getVerseSeverity(translationFindings);
        findings.push({
            id,
            reference: verse.reference || `${verse.book || ''} ${verse.chapter || ''}:${verse.verse || ''}`.trim(),
            severity,
            recommendedAction: getRecommendedAction(translationFindings, severity),
            translations: translationFindings
        });
    }
});

findings.sort((a, b) => {
    const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return severityDiff || a.reference.localeCompare(b.reference);
});

const severityCounts = findings.reduce((counts, finding) => {
    counts[finding.severity] += 1;
    return counts;
}, { high: 0, medium: 0, low: 0 });

const report = {
    generatedAt: new Date().toISOString(),
    sourceFile: path.relative(ROOT, SOURCE_FILE).replace(/\\/g, '/'),
    summary: {
        totalVerses: Object.keys(dataset).length,
        possibleMixedSpeechVerses: findings.length,
        severityCounts,
        patterns: PHRASE_PATTERNS.map(item => item.label).concat('multiple quote segments')
    },
    findings
};

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Possible mixed speech audit written to ${path.relative(ROOT, REPORT_FILE).replace(/\\/g, '/')}`);
console.log(`${findings.length} possible mixed-speech verses found.`);
console.log(`Severity counts: high=${severityCounts.high}, medium=${severityCounts.medium}, low=${severityCounts.low}`);

function countQuoteSegments(text) {
    const curlyPairs = text.match(/“[^”]+”/g) || [];
    const straightPairs = text.match(/"[^"]+"/g) || [];
    return curlyPairs.length + straightPairs.length;
}

function classifySeverity(text, matches) {
    const hasNamedSpeaker = NAMED_SPEAKER_PATTERN.test(text) || matches.includes('they said');
    const hasMultipleQuotes = matches.includes('multiple quote segments');
    const hasAddressAfterAttribution = JESUS_ATTRIBUTION_PATTERN.test(text) && /\b(Master|Teacher),/i.test(text);

    if (hasNamedSpeaker || hasMultipleQuotes || hasAddressAfterAttribution) {
        return {
            severity: 'high',
            recommendedAction: hasNamedSpeaker ? 'contains_non_jesus_speaker' : 'review_for_override'
        };
    }

    if (
        (JESUS_ATTRIBUTION_PATTERN.test(text) && hasAdditionalNarration(text)) ||
        MEDIUM_NARRATION_PATTERNS.test(text)
    ) {
        return {
            severity: 'medium',
            recommendedAction: 'review_for_override'
        };
    }

    return {
        severity: 'low',
        recommendedAction: 'likely_safe_attribution'
    };
}

function hasAdditionalNarration(text) {
    const withoutQuotedText = text
        .replace(/“[^”]+”/g, '')
        .replace(/"[^"]+"/g, '')
        .trim();
    return withoutQuotedText.split(/\s+/).filter(Boolean).length > 3;
}

function getVerseSeverity(translationFindings) {
    return Object.values(translationFindings)
        .map(item => item.severity)
        .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0];
}

function getRecommendedAction(translationFindings, severity) {
    const actions = Object.values(translationFindings)
        .filter(item => item.severity === severity)
        .map(item => item.recommendedAction);
    if (actions.includes('contains_non_jesus_speaker')) return 'contains_non_jesus_speaker';
    if (actions.includes('review_for_override')) return 'review_for_override';
    return 'likely_safe_attribution';
}
