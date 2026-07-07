const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'dev', 'reports');
const INPUT_FILE = path.join(REPORT_DIR, 'jesus_verses_with_speech_candidates_reduced.json');
const CSV_FILE = path.join(REPORT_DIR, 'speech_manual_review_sheet.csv');
const JSON_FILE = path.join(REPORT_DIR, 'speech_manual_review_sheet.json');

const TRANSLATION_KEYS = ['NRSVUE', 'DBH', 'LAMSA'];
const TRANSLATION_ORDER = new Map(TRANSLATION_KEYS.map((key, index) => [key, index]));
const BOOK_ORDER = new Map(['Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Revelation'].map((book, index) => [book, index]));
const CSV_COLUMNS = [
    'id',
    'reference',
    'book',
    'chapter',
    'verse',
    'translationKey',
    'rawText',
    'currentSpeechText',
    'bsbAnchor',
    'flags',
    'severity',
    'confidence',
    'notes',
    'suggestedManualSpeechText',
    'approvalStatus',
    'reviewNote'
];
const PATTERN_GROUPS = [
    'other_speaker_dialogue',
    'parable_dialogue',
    'lamsa_unquoted_formula',
    'bracket_editorial',
    'quote_artifact',
    'unclear_multiple_quote_blocks',
    'possible_context_only',
    'unknown'
];

main();

function main() {
    let dataset;
    try {
        dataset = loadJson(INPUT_FILE, 'reduced speech candidates');
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    const rows = [];
    Object.entries(dataset).forEach(([id, record]) => {
        TRANSLATION_KEYS.forEach(translationKey => {
            if (record.speechStatus?.[translationKey] !== 'needs_review') return;

            const audit = getSpeechAudit(record, translationKey);
            const flags = Array.isArray(audit.flags) ? audit.flags.map(String) : [];
            const notes = Array.isArray(audit.notes) ? audit.notes.map(String) : [];
            const rawText = stringValue(record.translations?.[translationKey]);
            const row = {
                id,
                reference: record.reference || buildReference(record),
                book: stringValue(record.book),
                chapter: numberOrString(record.chapter),
                verse: numberOrString(record.verse),
                translationKey,
                rawText,
                currentSpeechText: stringValue(record.speechText?.[translationKey]),
                bsbAnchor: stringValue(record.anchor?.BSB),
                flags: flags.join('; '),
                severity: stringValue(audit.severity),
                confidence: audit.confidence === undefined || audit.confidence === null ? '' : String(audit.confidence),
                notes: notes.join(' | '),
                suggestedManualSpeechText: getVerySafeExistingSuggestion(record, audit, translationKey),
                approvalStatus: '',
                reviewNote: ''
            };
            row.likelyPatternGroup = classifyLikelyPattern(row, flags, notes);
            rows.push(row);
        });
    });

    rows.sort(compareReviewRows);

    const metadata = buildMetadata(rows);
    const jsonOutput = {
        generatedAt: new Date().toISOString(),
        sourceFile: path.relative(ROOT, INPUT_FILE).replace(/\\/g, '/'),
        ...metadata,
        rows
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(CSV_FILE, `\uFEFF${toCsv(rows, CSV_COLUMNS)}\n`, 'utf8');
    fs.writeFileSync(JSON_FILE, `${JSON.stringify(jsonOutput, null, 2)}\n`, 'utf8');

    printSummary(metadata);
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

function getSpeechAudit(record, translationKey) {
    return record.speechAudit && record.speechAudit[translationKey] ? record.speechAudit[translationKey] : {};
}

function getVerySafeExistingSuggestion(record, audit, translationKey) {
    const text = stringValue(audit.suggestedManualSpeechText || audit.suggestedSpeechText);
    if (!text) return '';
    if (record.speechStatus?.[translationKey] !== 'needs_review') return '';
    if (hasObviousContamination(text)) return '';
    return text.trim();
}

function classifyLikelyPattern(row, flags, notes) {
    const flagSet = new Set(flags);
    const rawText = row.rawText;
    const combined = `${row.rawText} ${row.notes} ${notes.join(' ')}`;

    if (flagSet.has('other_speaker') || /\b(?:They|Peter|Thomas|She|disciples|Pharisees|Jews|crowd)\s+(?:said|say|answered|replied)\b/i.test(combined)) {
        return 'other_speaker_dialogue';
    }

    if (looksLikeParableDialogue(combined)) {
        return 'parable_dialogue';
    }

    if (row.translationKey === 'LAMSA' && (flagSet.has('speaker_setup') || flagSet.has('pre_speech_narration') || flagSet.has('post_speech_narration')) && !hasQuoteMarks(rawText)) {
        return 'lamsa_unquoted_formula';
    }

    if (flagSet.has('bracket_or_editorial_material')) {
        return 'bracket_editorial';
    }

    if (countQuoteBlocks(rawText) > 1 || /multiple quote|quote blocks|another speaker|unclear/i.test(combined)) {
        return 'unclear_multiple_quote_blocks';
    }

    if (flagSet.has('quote_artifact') || flagSet.has('long_prefix_before_quote') || flagSet.has('long_suffix_after_quote')) {
        return 'quote_artifact';
    }

    if (flags.length > 0 && flags.every(flag => flag === 'anchor_mismatch_risk')) {
        return 'possible_context_only';
    }

    if (flagSet.has('anchor_mismatch_risk') && !flagSet.has('speaker_setup') && !flagSet.has('pre_speech_narration') && !flagSet.has('post_speech_narration')) {
        return 'possible_context_only';
    }

    return 'unknown';
}

function looksLikeParableDialogue(text) {
    return /\b(?:parable|kingdom of heaven may be compared|master|servant|slave|slaves|tenant|tenants|landowner|bridegroom|bridesmaids|manager|steward|rich man|father said|son said|king said|lord said)\b/i.test(text) &&
        /\b(?:said|answered|replied)\b/i.test(text);
}

function hasQuoteMarks(text) {
    return /["“”]/.test(text);
}

function countQuoteBlocks(text) {
    const curlyOpens = (text.match(/“/g) || []).length;
    const straightQuotes = (text.match(/"/g) || []).length;
    if (curlyOpens > 0) return curlyOpens;
    return Math.floor(straightQuotes / 2);
}

function buildMetadata(rows) {
    const rowsByBook = {};
    const rowsByTranslation = {};
    const repeatedFlagGroups = {};
    const likelyPatternGroups = PATTERN_GROUPS.reduce((groups, group) => {
        groups[group] = { count: 0, examples: [] };
        return groups;
    }, {});

    rows.forEach(row => {
        rowsByBook[row.book || 'Unknown'] = (rowsByBook[row.book || 'Unknown'] || 0) + 1;
        rowsByTranslation[row.translationKey] = (rowsByTranslation[row.translationKey] || 0) + 1;

        const flagKey = row.flags || '(none)';
        if (!repeatedFlagGroups[flagKey]) {
            repeatedFlagGroups[flagKey] = { count: 0, examples: [] };
        }
        repeatedFlagGroups[flagKey].count += 1;
        addExample(repeatedFlagGroups[flagKey].examples, row);

        const group = likelyPatternGroups[row.likelyPatternGroup] || likelyPatternGroups.unknown;
        group.count += 1;
        addExample(group.examples, row);
    });

    return {
        totalRows: rows.length,
        rowsByBook,
        rowsByTranslation,
        repeatedFlagGroups,
        likelyPatternGroups
    };
}

function addExample(examples, row) {
    if (examples.length >= 10) return;
    examples.push({
        id: row.id,
        reference: row.reference,
        translationKey: row.translationKey,
        severity: row.severity,
        flags: row.flags,
        rawText: truncate(row.rawText, 180)
    });
}

function compareReviewRows(a, b) {
    return compareNumber(bookIndex(a.book), bookIndex(b.book)) ||
        compareNumber(Number(a.chapter) || 0, Number(b.chapter) || 0) ||
        compareNumber(Number(a.verse) || 0, Number(b.verse) || 0) ||
        compareNumber(TRANSLATION_ORDER.get(a.translationKey) ?? 99, TRANSLATION_ORDER.get(b.translationKey) ?? 99) ||
        a.id.localeCompare(b.id);
}

function bookIndex(book) {
    return BOOK_ORDER.has(book) ? BOOK_ORDER.get(book) : 999;
}

function compareNumber(a, b) {
    return a === b ? 0 : a < b ? -1 : 1;
}

function hasObviousContamination(text) {
    return [
        /\bJesus\s+(?:said|says|answered|replied|began)\b/i,
        /\b(?:Then|And|But|When)\s+Jesus\b/i,
        /\b(?:They|Peter|Thomas|She)\s+(?:said|say|answered|replied)\b/i,
        /\bAnd\s+immediately\b/i,
        /\b(?:servant|boy|woman|daughter)\s+was\s+healed\b/i,
        /\bleprosy\s+left\s+him\b/i,
        /\bfollowed\s+him\b/i
    ].some(regex => regex.test(text));
}

function toCsv(rows, columns) {
    const lines = [columns.join(',')];
    rows.forEach(row => {
        lines.push(columns.map(column => csvEscape(row[column])).join(','));
    });
    return lines.join('\r\n');
}

function printSummary(metadata) {
    console.log('Speech manual review sheet created.');
    console.log(`Manual review rows: ${metadata.totalRows}`);
    console.log(`Rows by translation: ${JSON.stringify(metadata.rowsByTranslation)}`);
    console.log(`Rows by book: ${JSON.stringify(metadata.rowsByBook)}`);
    console.log('Output files:');
    console.log(`- ${path.relative(ROOT, CSV_FILE).replace(/\\/g, '/')}`);
    console.log(`- ${path.relative(ROOT, JSON_FILE).replace(/\\/g, '/')}`);
}

function buildReference(record) {
    const book = record.book || record.bookCode || '';
    const chapter = record.chapter || '';
    const verse = record.verse || '';
    return `${book} ${chapter}:${verse}`.trim();
}

function numberOrString(value) {
    return value === undefined || value === null ? '' : String(value);
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
