const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'jesus_verses_final.json');
const AUDIT_FILE = path.join(ROOT, 'dev', 'reports', 'speech_contamination_audit.json');
const REPORT_DIR = path.join(ROOT, 'dev', 'reports');
const OUTPUT_FILE = path.join(REPORT_DIR, 'jesus_verses_with_speech_candidates.json');
const CSV_FILE = path.join(REPORT_DIR, 'speech_candidate_review.csv');
const SUMMARY_FILE = path.join(REPORT_DIR, 'speech_candidate_summary.json');

const TRANSLATION_KEYS = ['NRSVUE', 'DBH', 'LAMSA'];
const SPEECH_STATUSES = ['verified', 'candidate', 'needs_review', 'clean_raw', 'rejected'];
const HARMLESS_LOW_FLAGS = new Set(['quote_artifact', 'embedded_quote']);
const SAFE_RAW_BRACKET_FLAGS = new Set([
    'bracket_or_editorial_material',
    'anchor_mismatch_risk',
    'quote_artifact',
    'embedded_quote'
]);
const BLOCKING_BRACKET_FLAGS = new Set(['other_speaker', 'pre_speech_narration', 'post_speech_narration']);
const PURITY_FAIL_PATTERNS = [
    { label: 'leading addressee fragment', regex: /^to\s+(?:him|her|them),\s*/i },
    { label: 'leading saying formula', regex: /^saying\s+to\s+(?:him|her|them),\s*/i },
    { label: 'leading plainly formula', regex: /^plainly,\s*/i },
    { label: 'Jesus said', regex: /\bJesus\s+said\b/i },
    { label: 'Jesus says', regex: /\bJesus\s+says\b/i },
    { label: 'Jesus answered', regex: /\bJesus\s+answered\b/i },
    { label: 'Jesus replied', regex: /\bJesus\s+replied\b/i },
    { label: 'Jesus then said', regex: /\bJesus\s+then\s+said\b/i },
    { label: 'Jesus began', regex: /\bJesus\s+began\b/i },
    { label: 'Jesus looked', regex: /\bJesus\s+looked\b/i },
    { label: 'Jesus sent', regex: /\bJesus\s+sent\b/i },
    { label: 'Jesus spoke', regex: /\bJesus\s+spoke\b/i },
    { label: 'Jesus charged', regex: /\bJesus\s+charged\b/i },
    { label: 'Then Jesus', regex: /\bThen\s+Jesus\b/i },
    { label: 'And Jesus', regex: /\bAnd\s+Jesus\b/i },
    { label: 'But Jesus', regex: /\bBut\s+Jesus\b/i },
    { label: 'When Jesus', regex: /\bWhen\s+Jesus\b/i },
    { label: 'When he entered', regex: /\bWhen\s+he\s+entered\b/i },
    { label: 'he said to them', regex: /\bhe\s+said\s+to\s+them\b/i },
    { label: 'he said to him', regex: /\bhe\s+said\s+to\s+him\b/i },
    { label: 'he said to Peter', regex: /\bhe\s+said\s+to\s+Peter\b/i },
    { label: 'he pointed and said', regex: /\bhe\s+pointed\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'he spoke and said', regex: /\bhe\s+spoke\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'he turned and said', regex: /\bhe\s+turned\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'he looked and said', regex: /\bhe\s+looked\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'he touched and said', regex: /\bhe\s+touched\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'he stretched and said', regex: /\bhe\s+stretched\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'charged them and said', regex: /\bcharged\s+them\s+and\s+said\b/i },
    { label: 'said to him, Yes', regex: /\bsaid\s+to\s+him,\s*Yes\b/i },
    { label: 'They said to him', regex: /\bThey\s+said\s+to\s+him\b/i },
    { label: 'They say to him', regex: /\bThey\s+say\s+to\s+him\b/i },
    { label: 'They reasoned', regex: /\bthey\s+(?:reasoned|discussed)\s+(?:with|among)\s+themselves\b/i },
    { label: 'Peter said', regex: /\bPeter\s+said\b/i },
    { label: 'Thomas answered', regex: /\bThomas\s+answered\b/i },
    { label: 'She said to him', regex: /\bShe\s+said\s+to\s+him\b/i },
    { label: 'And immediately', regex: /\bAnd\s+immediately\b/i },
    { label: 'Immediately he', regex: /\bImmediately\s+he\b/i },
    { label: 'Immediately his', regex: /\bImmediately\s+his\b/i },
    { label: 'servant was healed', regex: /\bservant\s+was\s+healed\b/i },
    { label: 'boy was healed', regex: /\bboy\s+was\s+healed\b/i },
    { label: 'woman was healed', regex: /\bwoman\s+was\s+healed\b/i },
    { label: 'daughter was healed', regex: /\bdaughter\s+was\s+healed\b/i },
    { label: 'leprosy left him', regex: /\bleprosy\s+left\s+him\b/i },
    { label: 'skin disease was cleansed', regex: /\bskin\s+disease\s+was\s+cleansed\b/i },
    { label: 'followed him', regex: /\bfollowed\s+him\b/i },
    { label: 'got up and followed', regex: /\bgot\s+up\s+and\s+followed\b/i },
    { label: 'laughed at him', regex: /\blaughed\s+at\s+him\b/i }
];
const PURITY_EXCEPTION_PATTERNS = [
    /\bTruly\s+I\s+say\s+to\s+you\b/i,
    /\bI\s+say\s+to\s+you\b/i,
    /\bBut\s+I\s+say\s+to\s+you\b/i,
    /\bAmen,\s+I\s+tell\s+you\b/i,
    /\bIt\s+is\s+written\b/i,
    /\bYou\s+have\s+heard\s+that\s+it\s+was\s+said\b/i
];

main();

function main() {
    let dataset;
    let audit;

    try {
        dataset = loadJson(DATA_FILE, 'source dataset');
        audit = loadJson(AUDIT_FILE, 'speech contamination audit');
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    const output = {};
    const reviewRows = [];

    Object.entries(dataset).forEach(([id, record]) => {
        const speechText = createTranslationMap('');
        const speechStatus = createTranslationMap('needs_review');
        const speechAudit = {};

        TRANSLATION_KEYS.forEach(translationKey => {
            const auditEntry = getAuditEntry(audit, id, translationKey);
            const decision = decideSpeechText(record, auditEntry, translationKey);
            const notes = auditEntry.notes.concat(decision.notes);

            speechText[translationKey] = decision.speechText;
            speechStatus[translationKey] = decision.speechStatus;
            speechAudit[translationKey] = {
                source: decision.source,
                severity: auditEntry.severity,
                flags: auditEntry.flags,
                confidence: auditEntry.confidence,
                recommendedAction: auditEntry.recommendedAction,
                notes
            };

            reviewRows.push({
                id,
                reference: record.reference || buildReference(record),
                translationKey,
                speechStatus: decision.speechStatus,
                severity: auditEntry.severity,
                confidence: auditEntry.confidence,
                flags: auditEntry.flags.join('; '),
                rawText: auditEntry.rawText || stringValue(record.translations && record.translations[translationKey]),
                speechText: decision.speechText,
                bsbAnchor: auditEntry.bsbAnchor || stringValue(record.anchor && record.anchor.BSB),
                notes: notes.join(' | ')
            });
        });

        output[id] = {
            ...record,
            speechText,
            speechStatus,
            speechAudit
        };
    });

    const summary = buildSummary(output, reviewRows);

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    fs.writeFileSync(CSV_FILE, `\uFEFF${toCsv(reviewRows)}\n`, 'utf8');
    fs.writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    printSummary(summary);
}

function loadJson(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing ${label}: ${path.relative(ROOT, filePath).replace(/\\/g, '/')}`);
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Could not parse ${path.relative(ROOT, filePath).replace(/\\/g, '/')}: ${error.message}`);
    }
}

function decideSpeechText(record, auditEntry, translationKey) {
    const flags = new Set(auditEntry.flags);
    const rawText = stringValue(record.translations && record.translations[translationKey]);
    const suggestion = cleanSpeechText(auditEntry.suggestedSpeechText, true);
    const cleanRaw = cleanSpeechText(rawText, false);
    const onlyHarmlessLowFlags = auditEntry.severity === 'low' && auditEntry.flags.every(flag => HARMLESS_LOW_FLAGS.has(flag));

    if (auditEntry.severity === 'clean') {
        return enforcePurity({
            speechText: cleanRaw,
            speechStatus: 'clean_raw',
            source: 'raw_translation',
            notes: []
        });
    }

    if (onlyHarmlessLowFlags) {
        return enforcePurity({
            speechText: cleanRaw,
            speechStatus: 'clean_raw',
            source: 'raw_translation',
            notes: []
        });
    }

    if ((auditEntry.recommendedAction === 'auto_extract_candidate' || auditEntry.recommendedAction === 'remove_non_speech') && suggestion) {
        const suggestionPreservesBrackets = flags.has('bracket_or_editorial_material') && hasBracketedMaterial(suggestion);
        if (suggestionPreservesBrackets && hasBlockingBracketFlag(flags)) {
            return {
                speechText: '',
                speechStatus: 'needs_review',
                source: 'blank',
                notes: ['Bracketed audit suggestion left for review because another contamination flag is present.']
            };
        }

        return enforcePurity({
            speechText: suggestion,
            speechStatus: 'candidate',
            source: suggestionPreservesBrackets ? 'audit_suggestion_with_brackets' : 'audit_suggestion',
            notes: suggestionPreservesBrackets
                ? ['Bracketed Jesus speech preserved from audit suggestion.']
                : []
        });
    }

    if (flags.has('other_speaker') && !suggestion) {
        return {
            speechText: '',
            speechStatus: 'needs_review',
            source: 'blank',
            notes: []
        };
    }

    if (isSafeRawBracketCandidate(flags, cleanRaw)) {
        return enforcePurity({
            speechText: cleanRaw,
            speechStatus: 'candidate',
            source: 'audit_suggestion_with_brackets',
            notes: ['Bracketed Jesus speech preserved from raw translation because no narration or other-speaker flags remain.']
        });
    }

    return {
        speechText: '',
        speechStatus: 'needs_review',
        source: 'blank',
        notes: []
    };
}

function enforcePurity(decision) {
    const matches = getPurityMatches(decision.speechText);
    if (matches.length === 0) return decision;

    return {
        speechText: '',
        speechStatus: 'needs_review',
        source: 'blank',
        notes: decision.notes.concat(`Candidate blanked by purity guard: ${matches.join('; ')}.`)
    };
}

function getPurityMatches(text) {
    return PURITY_FAIL_PATTERNS
        .filter(pattern => pattern.regex.test(text))
        .map(pattern => pattern.label);
}

function isSafeRawBracketCandidate(flags, speechText) {
    if (!flags.has('bracket_or_editorial_material')) return false;
    if (!hasBracketedMaterial(speechText)) return false;
    return Array.from(flags).every(flag => SAFE_RAW_BRACKET_FLAGS.has(flag));
}

function hasBlockingBracketFlag(flags) {
    return Array.from(BLOCKING_BRACKET_FLAGS).some(flag => flags.has(flag));
}

function hasBracketedMaterial(text) {
    return /\[[^\]]+\]/.test(text);
}

function isPurityException(text) {
    return PURITY_EXCEPTION_PATTERNS.some(regex => regex.test(text));
}

function getAuditEntry(audit, id, translationKey) {
    const entry = audit[id] && audit[id].translations && audit[id].translations[translationKey];
    if (!entry) {
        return {
            rawText: '',
            bsbAnchor: '',
            flags: [],
            severity: 'high',
            confidence: 0,
            recommendedAction: 'manual_review',
            suggestedSpeechText: '',
            notes: ['Missing audit entry.']
        };
    }

    return {
        rawText: stringValue(entry.rawText),
        bsbAnchor: stringValue(entry.bsbAnchor),
        flags: Array.isArray(entry.flags) ? entry.flags : [],
        severity: stringValue(entry.severity) || 'high',
        confidence: typeof entry.confidence === 'number' ? entry.confidence : 0,
        recommendedAction: stringValue(entry.recommendedAction) || 'manual_review',
        suggestedSpeechText: stringValue(entry.suggestedSpeechText),
        notes: Array.isArray(entry.notes) ? entry.notes.map(String) : []
    };
}

function cleanSpeechText(value, fromSuggestion) {
    let text = stringValue(value)
        .trim()
        .replace(/\s+/g, ' ');

    text = stripOuterQuotes(text);

    if (fromSuggestion) {
        text = text.replace(/\s+([,.;:!?])/g, '$1');
        text = text.replace(/\s+/g, ' ').trim();
    }

    return text;
}

function stripOuterQuotes(value) {
    let text = value.trim();

    while (text.length > 0 && /^["“”‘’]/.test(text)) {
        text = text.slice(1).trimStart();
    }

    while (text.length > 0 && /["“”‘’]$/.test(text)) {
        text = text.slice(0, -1).trimEnd();
    }

    return text;
}

function buildSummary(output, reviewRows) {
    const countBySpeechStatus = createStatusCounts();
    const countByTranslationAndStatus = {};
    TRANSLATION_KEYS.forEach(key => {
        countByTranslationAndStatus[key] = createStatusCounts();
    });

    reviewRows.forEach(row => {
        countBySpeechStatus[row.speechStatus] += 1;
        countByTranslationAndStatus[row.translationKey][row.speechStatus] += 1;
    });

    return {
        generatedAt: new Date().toISOString(),
        sourceFile: path.relative(ROOT, DATA_FILE).replace(/\\/g, '/'),
        auditFile: path.relative(ROOT, AUDIT_FILE).replace(/\\/g, '/'),
        totalRecords: Object.keys(output).length,
        totalTranslationStrings: reviewRows.length,
        countBySpeechStatus,
        countByTranslationAndStatus,
        blankSpeechTextCount: reviewRows.filter(row => !row.speechText).length,
        candidateCount: countBySpeechStatus.candidate,
        cleanRawCount: countBySpeechStatus.clean_raw,
        needsReviewCount: countBySpeechStatus.needs_review,
        examplesNeedsReview: reviewRows
            .filter(row => row.speechStatus === 'needs_review')
            .slice(0, 50)
            .map(exampleRow),
        examplesCandidate: reviewRows
            .filter(row => row.speechStatus === 'candidate')
            .slice(0, 50)
            .map(exampleRow),
        examplesBlank: reviewRows
            .filter(row => !row.speechText)
            .slice(0, 50)
            .map(exampleRow)
    };
}

function exampleRow(row) {
    return {
        id: row.id,
        reference: row.reference,
        translationKey: row.translationKey,
        speechStatus: row.speechStatus,
        severity: row.severity,
        flags: row.flags,
        rawText: truncate(row.rawText, 220),
        speechText: truncate(row.speechText, 220),
        notes: truncate(row.notes, 260)
    };
}

function createStatusCounts() {
    return SPEECH_STATUSES.reduce((counts, status) => {
        counts[status] = 0;
        return counts;
    }, {});
}

function createTranslationMap(value) {
    return TRANSLATION_KEYS.reduce((map, key) => {
        map[key] = value;
        return map;
    }, {});
}

function toCsv(rows) {
    const columns = [
        'id',
        'reference',
        'translationKey',
        'speechStatus',
        'severity',
        'confidence',
        'flags',
        'rawText',
        'speechText',
        'bsbAnchor',
        'notes'
    ];

    const lines = [columns.join(',')];
    rows.forEach(row => {
        lines.push(columns.map(column => csvEscape(row[column])).join(','));
    });

    return lines.join('\r\n');
}

function printSummary(summary) {
    console.log('Speech text candidate generation complete.');
    console.log(`Records written: ${summary.totalRecords}`);
    console.log(`Translation strings processed: ${summary.totalTranslationStrings}`);
    console.log(`Candidates: ${summary.candidateCount}`);
    console.log(`Clean raw: ${summary.cleanRawCount}`);
    console.log(`Needs review: ${summary.needsReviewCount}`);
    console.log(`Blank speechText: ${summary.blankSpeechTextCount}`);
    console.log('Output files:');
    console.log(`- ${path.relative(ROOT, OUTPUT_FILE).replace(/\\/g, '/')}`);
    console.log(`- ${path.relative(ROOT, CSV_FILE).replace(/\\/g, '/')}`);
    console.log(`- ${path.relative(ROOT, SUMMARY_FILE).replace(/\\/g, '/')}`);
}

function buildReference(record) {
    const book = record.book || record.bookCode || '';
    const chapter = record.chapter || '';
    const verse = record.verse || '';
    return `${book} ${chapter}:${verse}`.trim();
}

function stringValue(value) {
    return typeof value === 'string' ? value : '';
}

function truncate(value, maxLength) {
    const text = stringValue(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}...`;
}

function csvEscape(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}
