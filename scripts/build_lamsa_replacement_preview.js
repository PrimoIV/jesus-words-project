const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OLD_MAP_FILE = path.join(ROOT, 'data/translation_verse_maps/lamsa_verse_map.json');
const NORMALIZED_EPUB_FILE = path.join(ROOT, 'data/translation_verse_maps/lamsa_epub_verse_map_normalized.json');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const JSON_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_replacement_preview.json');
const CSV_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_replacement_preview.csv');

const BOOK_ORDER = new Map([
    ['MAT', 1],
    ['MRK', 2],
    ['LUK', 3],
    ['JHN', 4],
    ['REV', 5]
]);

const CATEGORY_NAMES = [
    'exact_match',
    'punctuation_only',
    'minor_wording',
    'major_wording',
    'missing_in_epub'
];

const SPECIAL_CHECK_IDS = [
    'MAT_27_46',
    'MRK_15_34',
    'MAT_4_17',
    'MAT_8_3',
    'MAT_8_13',
    'MAT_9_9',
    'MAT_9_28',
    'LUK_8_45',
    'MRK_4_40',
    'MRK_4_41'
];

const SUSPICIOUS_PATTERNS = [
    { name: 'literal: few this', regex: /\bfew this\b/i },
    { name: 'literal: pine hundred', regex: /\bpine hundred\b/i },
    { name: 'literal: muck him', regex: /\bmuck him\b/i },
    { name: 'literal: land it came to pass', regex: /\bland it came to pass\b/i },
    { name: 'literal: clone to you', regex: /\bclone to you\b/i },
    { name: 'literal: clays', regex: /\bclays\b/i },
    { name: 'mojibake characters', regex: /(?:\u00c3|\u00c2|\u00e2\u20ac|\u00e2\u20ac\u2122|\u00e2\u20ac\u0153|\u00e2\u20ac\ufffd|\u00ef\u00bf\u00bd|\u00f0|\u00fe|\ufffd)/i },
    { name: 'replacement character', regex: /\ufffd/ },
    { name: 'isolated lowercase letter at verse start', regex: /^[a-z](?:\s|(?=[^\p{L}]))/u },
    { name: 'OCR-like digit inside word', regex: /(?:\b[\p{L}]*\d[\p{L}]+\b|\b[\p{L}]+\d[\p{L}]*\b)/iu },
    { name: 'OCR-like common substitution', regex: /\b(?:frorn|corne|tirne|thc|tbe|rnay|rnight|rnan|rnen|rny|rnyself|rnode|rnodern)\b/i }
];

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const oldMapInput = readJsonObjectWithDuplicateCheck(OLD_MAP_FILE);
    const normalizedEpubInput = readJsonObjectWithDuplicateCheck(NORMALIZED_EPUB_FILE);
    const datasetInput = readJsonObjectWithDuplicateCheck(DATASET_FILE);
    const oldMap = oldMapInput.data;
    const normalizedEpubMap = normalizedEpubInput.data;
    const dataset = datasetInput.data;
    const validationErrors = [];

    addDuplicateValidation(validationErrors, OLD_MAP_FILE, oldMapInput.duplicateKeys);
    addDuplicateValidation(validationErrors, NORMALIZED_EPUB_FILE, normalizedEpubInput.duplicateKeys);
    addDuplicateValidation(validationErrors, DATASET_FILE, datasetInput.duplicateKeys);

    if (/\bfew this\b/i.test(normalizedEpubMap.MRK_15_34 || '')) {
        validationErrors.push('MRK_15_34 in the normalized EPUB map contains the forbidden source corruption "few this"');
    }

    const productionLamsaIds = Object.entries(dataset)
        .filter(([, record]) => typeof record?.translations?.LAMSA === 'string' && record.translations.LAMSA.trim())
        .map(([verseId]) => verseId)
        .sort(compareVerseIds);

    const categories = Object.fromEntries(CATEGORY_NAMES.map(name => [name, []]));
    const rows = [];
    const missingInEpub = [];
    const oldMapDatasetMismatches = [];

    for (const verseId of productionLamsaIds) {
        const record = dataset[verseId];
        const oldLamsaRaw = record.translations.LAMSA;
        const newLamsaRaw = Object.prototype.hasOwnProperty.call(normalizedEpubMap, verseId)
            ? normalizedEpubMap[verseId]
            : null;
        const category = classifyDifference(oldLamsaRaw, newLamsaRaw);
        const notes = buildNotes(oldLamsaRaw, newLamsaRaw);
        const oldMapText = Object.prototype.hasOwnProperty.call(oldMap, verseId) ? oldMap[verseId] : null;

        if (oldMapText === null) {
            notes.push('missing_in_old_lamsa_map');
        } else if (oldMapText !== oldLamsaRaw) {
            notes.push('old_map_dataset_mismatch');
            oldMapDatasetMismatches.push(verseId);
        }

        const row = {
            verseId,
            reference: record.reference || null,
            oldLamsaRaw,
            newLamsaRaw,
            category,
            oldSuspicious: findSuspiciousPatterns(oldLamsaRaw),
            newSuspicious: typeof newLamsaRaw === 'string' ? findSuspiciousPatterns(newLamsaRaw) : [],
            currentSpeechText: getCurrentSpeechText(record),
            needsSpeechRegeneration: newLamsaRaw === null || oldLamsaRaw !== newLamsaRaw,
            notes
        };

        if (newLamsaRaw === null) {
            missingInEpub.push(verseId);
        }

        rows.push(row);
        categories[category].push(row);
    }

    if (missingInEpub.length > 0) {
        validationErrors.push(`${missingInEpub.length} production LAMSA verse(s) are missing from the normalized EPUB map`);
    }

    const specialChecks = Object.fromEntries(SPECIAL_CHECK_IDS.map(verseId => {
        const previewRow = rows.find(row => row.verseId === verseId);
        if (previewRow) {
            return [verseId, { inProductionDataset: true, ...previewRow }];
        }

        const datasetRecord = dataset[verseId] || null;
        const oldLamsaRaw = typeof datasetRecord?.translations?.LAMSA === 'string'
            ? datasetRecord.translations.LAMSA
            : (Object.prototype.hasOwnProperty.call(oldMap, verseId) ? oldMap[verseId] : null);
        const newLamsaRaw = Object.prototype.hasOwnProperty.call(normalizedEpubMap, verseId)
            ? normalizedEpubMap[verseId]
            : null;

        return [verseId, {
            inProductionDataset: false,
            reference: datasetRecord?.reference || null,
            oldLamsaRaw,
            newLamsaRaw,
            category: oldLamsaRaw === null ? 'not_in_production_dataset' : classifyDifference(oldLamsaRaw, newLamsaRaw),
            oldSuspicious: typeof oldLamsaRaw === 'string' ? findSuspiciousPatterns(oldLamsaRaw) : [],
            newSuspicious: typeof newLamsaRaw === 'string' ? findSuspiciousPatterns(newLamsaRaw) : [],
            currentSpeechText: datasetRecord ? getCurrentSpeechText(datasetRecord) : null,
            needsSpeechRegeneration: typeof oldLamsaRaw === 'string' && oldLamsaRaw !== newLamsaRaw,
            notes: [
                'not_in_production_dataset',
                ...buildNotes(oldLamsaRaw, newLamsaRaw)
            ]
        }];
    }));

    const sourceCorruptionFixedRows = rows.filter(row => row.notes.includes('source_corruption_fixed'));
    const bracketNoteRows = rows.filter(row => row.notes.includes('bracket_note_present'));
    const narrationGlossRiskRows = rows.filter(row => row.notes.includes('narration_or_gloss_risk'));
    const rowsNeedingSpeechRegeneration = rows.filter(row => row.needsSpeechRegeneration);

    const report = {
        generatedAt: new Date().toISOString(),
        inputs: {
            oldLamsaMap: relativeToRoot(OLD_MAP_FILE),
            normalizedEpubMap: relativeToRoot(NORMALIZED_EPUB_FILE),
            dataset: relativeToRoot(DATASET_FILE)
        },
        outputs: {
            jsonReport: relativeToRoot(JSON_REPORT_FILE),
            csvReport: relativeToRoot(CSV_REPORT_FILE)
        },
        summary: {
            totalProductionLamsaVersesChecked: rows.length,
            exactMatches: categories.exact_match.length,
            punctuationOnlyDifferences: categories.punctuation_only.length,
            minorWordingDifferences: categories.minor_wording.length,
            majorWordingDifferences: categories.major_wording.length,
            sourceCorruptionsFixed: sourceCorruptionFixedRows.length,
            bracketNoteVerses: bracketNoteRows.length,
            narrationGlossRiskVerses: narrationGlossRiskRows.length,
            missingInEpub: categories.missing_in_epub.length,
            needsSpeechRegeneration: rowsNeedingSpeechRegeneration.length,
            oldMapDatasetMismatches: oldMapDatasetMismatches.length,
            duplicateVerseIds: oldMapInput.duplicateKeys.length + normalizedEpubInput.duplicateKeys.length + datasetInput.duplicateKeys.length,
            validationPassed: validationErrors.length === 0
        },
        validationErrors,
        specialChecks,
        categories,
        rows
    };

    fs.mkdirSync(path.dirname(JSON_REPORT_FILE), { recursive: true });
    fs.writeFileSync(JSON_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(CSV_REPORT_FILE, toCsv(rows));

    printSummary(report);

    if (validationErrors.length > 0) {
        console.error(`LAMSA replacement preview failed with ${validationErrors.length} validation error(s).`);
        process.exit(1);
    }
}

function addDuplicateValidation(validationErrors, file, duplicateKeys) {
    if (duplicateKeys.length === 0) return;
    validationErrors.push(`Duplicate verse IDs in ${relativeToRoot(file)}: ${duplicateKeys.join(', ')}`);
}

function classifyDifference(oldText, newText) {
    if (newText === null) return 'missing_in_epub';
    if (oldText === newText) return 'exact_match';
    if (normalizeWithoutPunctuation(oldText) === normalizeWithoutPunctuation(newText)) {
        return 'punctuation_only';
    }

    const differenceScore = getDifferenceScore(oldText, newText);
    const tokenOverlap = getTokenOverlap(oldText, newText);
    const oldTokenCount = tokenizeForComparison(oldText).length;
    const newTokenCount = tokenizeForComparison(newText).length;
    const tokenCountGap = Math.abs(oldTokenCount - newTokenCount);

    if (differenceScore <= 0.18 || (differenceScore <= 0.28 && tokenOverlap >= 0.82 && tokenCountGap <= 8)) {
        return 'minor_wording';
    }

    return 'major_wording';
}

function buildNotes(oldText, newText) {
    const notes = [];
    const oldValue = typeof oldText === 'string' ? oldText : '';
    const newValue = typeof newText === 'string' ? newText : '';

    if (/\bfew this\b/i.test(oldValue)) {
        notes.push('source_corruption_fixed');
    }
    if (/\[[^\]]+\]/.test(newValue)) {
        notes.push('bracket_note_present');
    }
    if (/\bwhich means\b/i.test(oldValue) || /\bwhich means\b/i.test(newValue) || /\[[^\]]+\]/.test(oldValue) || /\[[^\]]+\]/.test(newValue)) {
        notes.push('narration_or_gloss_risk');
    }
    if (newText === null) {
        notes.push('missing_in_epub');
    }

    return notes;
}

function getCurrentSpeechText(record) {
    if (typeof record?.speechText?.LAMSA === 'string') {
        return record.speechText.LAMSA;
    }
    if (typeof record?.currentSpeechText?.LAMSA === 'string') {
        return record.currentSpeechText.LAMSA;
    }
    return null;
}

function findSuspiciousPatterns(text) {
    return SUSPICIOUS_PATTERNS.flatMap(pattern => {
        const match = text.match(pattern.regex);
        return match ? [{ name: pattern.name, match: match[0] }] : [];
    });
}

function normalizeWhitespace(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function normalizeWithoutPunctuation(text) {
    return normalizeWhitespace(text)
        .replace(/[\p{P}\p{S}]+/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeForComparison(text) {
    return normalizeWithoutPunctuation(text).toLowerCase();
}

function tokenizeForComparison(text) {
    const normalized = normalizeForComparison(text);
    return normalized ? normalized.split(/\s+/) : [];
}

function getDifferenceScore(oldText, newText) {
    const oldNormalized = normalizeForComparison(oldText);
    const newNormalized = normalizeForComparison(newText);
    const maxLength = Math.max(oldNormalized.length, newNormalized.length);
    if (maxLength === 0) return 0;
    return Number((levenshteinDistance(oldNormalized, newNormalized) / maxLength).toFixed(4));
}

function getTokenOverlap(oldText, newText) {
    const oldTokens = new Set(tokenizeForComparison(oldText));
    const newTokens = new Set(tokenizeForComparison(newText));
    const maxSize = Math.max(oldTokens.size, newTokens.size);
    if (maxSize === 0) return 1;

    let shared = 0;
    for (const token of oldTokens) {
        if (newTokens.has(token)) shared++;
    }
    return shared / maxSize;
}

function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    let current = new Array(b.length + 1);

    for (let i = 1; i <= a.length; i++) {
        current[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost
            );
        }
        [previous, current] = [current, previous];
    }

    return previous[b.length];
}

function toCsv(rows) {
    const csvRows = [
        [
            'verseId',
            'reference',
            'oldLamsaRaw',
            'newLamsaRaw',
            'category',
            'oldSuspicious',
            'newSuspicious',
            'currentSpeechText',
            'needsSpeechRegeneration',
            'notes'
        ]
    ];

    for (const row of rows) {
        csvRows.push([
            row.verseId,
            row.reference || '',
            row.oldLamsaRaw,
            row.newLamsaRaw || '',
            row.category,
            formatSuspicious(row.oldSuspicious),
            formatSuspicious(row.newSuspicious),
            row.currentSpeechText || '',
            row.needsSpeechRegeneration ? 'true' : 'false',
            row.notes.join('; ')
        ]);
    }

    return `${csvRows.map(row => row.map(csvValue).join(',')).join('\n')}\n`;
}

function formatSuspicious(items) {
    return items.map(item => `${item.name}: ${item.match}`).join('; ');
}

function csvValue(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function readJsonObjectWithDuplicateCheck(file) {
    const raw = fs.readFileSync(file, 'utf8');
    const keys = scanRootObjectKeys(raw);
    const duplicateKeys = getDuplicateItems(keys);
    const data = JSON.parse(raw);

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(`${relativeToRoot(file)} must contain a JSON object`);
    }

    return { data, duplicateKeys };
}

function getDuplicateItems(items) {
    const seen = new Set();
    const duplicates = new Set();
    for (const item of items) {
        if (seen.has(item)) {
            duplicates.add(item);
        } else {
            seen.add(item);
        }
    }
    return [...duplicates].sort(compareVerseIds);
}

function scanRootObjectKeys(json) {
    let index = skipWhitespace(json, 0);
    if (json[index] !== '{') return [];
    index++;

    const keys = [];
    while (index < json.length) {
        index = skipWhitespace(json, index);
        if (json[index] === '}') break;
        if (json[index] !== '"') {
            throw new Error(`Expected JSON object key at offset ${index}`);
        }

        const key = readJsonString(json, index);
        keys.push(key.value);
        index = skipWhitespace(json, key.end);

        if (json[index] !== ':') {
            throw new Error(`Expected colon after JSON object key at offset ${index}`);
        }

        index = skipJsonValue(json, index + 1);
        index = skipWhitespace(json, index);

        if (json[index] === ',') {
            index++;
            continue;
        }
        if (json[index] === '}') break;

        throw new Error(`Expected comma or end of JSON object at offset ${index}`);
    }

    return keys;
}

function skipJsonValue(json, index) {
    index = skipWhitespace(json, index);

    if (json[index] === '"') {
        return readJsonString(json, index).end;
    }

    if (json[index] === '{' || json[index] === '[') {
        const stack = [json[index]];
        index++;

        while (index < json.length && stack.length > 0) {
            const char = json[index];
            if (char === '"') {
                index = readJsonString(json, index).end;
                continue;
            }
            if (char === '{' || char === '[') {
                stack.push(char);
            } else if (char === '}' || char === ']') {
                const open = stack.pop();
                if ((open === '{' && char !== '}') || (open === '[' && char !== ']')) {
                    throw new Error(`Mismatched JSON delimiter at offset ${index}`);
                }
            }
            index++;
        }

        return index;
    }

    while (index < json.length && !/[,\]}]/.test(json[index])) {
        index++;
    }

    return index;
}

function readJsonString(json, index) {
    let cursor = index + 1;
    while (cursor < json.length) {
        if (json[cursor] === '\\') {
            cursor += 2;
            continue;
        }
        if (json[cursor] === '"') {
            return {
                value: JSON.parse(json.slice(index, cursor + 1)),
                end: cursor + 1
            };
        }
        cursor++;
    }

    throw new Error(`Unterminated JSON string at offset ${index}`);
}

function skipWhitespace(text, index) {
    while (index < text.length && /\s/.test(text[index])) {
        index++;
    }
    return index;
}

function compareVerseIds(a, b) {
    const parsedA = parseVerseId(a);
    const parsedB = parseVerseId(b);
    if (parsedA && parsedB) {
        return (BOOK_ORDER.get(parsedA.book) || 99) - (BOOK_ORDER.get(parsedB.book) || 99)
            || parsedA.chapter - parsedB.chapter
            || parsedA.verse - parsedB.verse;
    }
    if (parsedA) return -1;
    if (parsedB) return 1;
    return a.localeCompare(b);
}

function parseVerseId(id) {
    const match = id.match(/^([A-Z]+)_(\d+)_(\d+)$/);
    return match
        ? { book: match[1], chapter: Number(match[2]), verse: Number(match[3]) }
        : null;
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function printSummary(report) {
    const summary = report.summary;
    console.log('LAMSA replacement preview complete.');
    console.log(`Total production LAMSA verses checked: ${summary.totalProductionLamsaVersesChecked}`);
    console.log(`Exact matches: ${summary.exactMatches}`);
    console.log(`Punctuation-only differences: ${summary.punctuationOnlyDifferences}`);
    console.log(`Minor wording differences: ${summary.minorWordingDifferences}`);
    console.log(`Major wording differences: ${summary.majorWordingDifferences}`);
    console.log(`Source corruptions fixed: ${summary.sourceCorruptionsFixed}`);
    console.log(`Bracket-note verses: ${summary.bracketNoteVerses}`);
    console.log(`Narration/gloss risk verses: ${summary.narrationGlossRiskVerses}`);
    console.log(`Missing in EPUB: ${summary.missingInEpub}`);
    console.log(`Needs speech regeneration: ${summary.needsSpeechRegeneration}`);
    console.log(`JSON report saved to ${relativeToRoot(JSON_REPORT_FILE)}`);
    console.log(`CSV report saved to ${relativeToRoot(CSV_REPORT_FILE)}`);
}
