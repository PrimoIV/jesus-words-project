const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OLD_FILE = path.join(ROOT, 'data/translation_verse_maps/lamsa_verse_map.json');
const NEW_FILE = path.join(ROOT, 'data/translation_verse_maps/lamsa_epub_verse_map.json');
const JSON_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_source_diff_report.json');
const CSV_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_source_diff_report.csv');

const BOOK_ORDER = new Map([
    ['MAT', 1],
    ['MRK', 2],
    ['LUK', 3],
    ['JHN', 4],
    ['REV', 5]
]);

const CATEGORY_NAMES = [
    'exact_matches',
    'whitespace_only_differences',
    'punctuation_only_differences',
    'minor_wording_differences',
    'major_wording_differences',
    'missing_old',
    'missing_new',
    'suspicious_old',
    'suspicious_new'
];

const SPECIAL_CHECK_IDS = [
    'MAT_27_46',
    'MRK_15_34',
    'MAT_4_17',
    'MAT_8_3',
    'MAT_8_13',
    'MAT_9_9',
    'MAT_9_28',
    'LUK_8_45'
];

const SUSPICIOUS_PATTERNS = [
    { name: 'literal: few this', regex: /\bfew this\b/i },
    { name: 'literal: pine hundred', regex: /\bpine hundred\b/i },
    { name: 'literal: muck him', regex: /\bmuck him\b/i },
    { name: 'literal: land it came to pass', regex: /\bland it came to pass\b/i },
    { name: 'literal: clone to you', regex: /\bclone to you\b/i },
    { name: 'literal: clays', regex: /\bclays\b/i },
    { name: 'mojibake characters', regex: /(?:Ã|Â|â€|â€™|â€œ|â€�|â€“|â€”|ï¿½|ð|þ|�)/i },
    { name: 'replacement character', regex: /�/ },
    { name: 'isolated lowercase letter at verse start', regex: /^[a-z](?:\s|(?=[^\p{L}]))/u },
    { name: 'OCR-like digit inside word', regex: /(?:\b[\p{L}]*\d[\p{L}]+\b|\b[\p{L}]+\d[\p{L}]*\b)/iu },
    { name: 'OCR-like common substitution', regex: /\b(?:frorn|corne|tirne|thc|tbe|rnay|rnight|rnan|rnen|rny|rnyself|rnode|rnodern)\b/i }
];

main();

function main() {
    const oldMap = readJson(OLD_FILE);
    const newMap = readJson(NEW_FILE);
    const categories = Object.fromEntries(CATEGORY_NAMES.map(name => [name, []]));
    const diffRows = [];
    const diffCategoryById = new Map();
    const allIds = [...new Set([...Object.keys(oldMap), ...Object.keys(newMap)])].sort(compareVerseIds);

    for (const verseId of allIds) {
        const oldText = Object.prototype.hasOwnProperty.call(oldMap, verseId) ? oldMap[verseId] : null;
        const newText = Object.prototype.hasOwnProperty.call(newMap, verseId) ? newMap[verseId] : null;
        const classification = classifyDifference(oldText, newText);
        const oldSuspicious = typeof oldText === 'string' ? findSuspiciousPatterns(oldText) : [];
        const newSuspicious = typeof newText === 'string' ? findSuspiciousPatterns(newText) : [];
        const record = {
            verseId,
            category: classification.category,
            oldText,
            newText,
            differenceScore: classification.differenceScore,
            oldSuspicious,
            newSuspicious
        };

        categories[classification.category].push(record);
        diffRows.push(record);
        diffCategoryById.set(verseId, classification.category);

        if (oldSuspicious.length > 0) {
            categories.suspicious_old.push({
                ...record,
                category: 'suspicious_old',
                suspicious: oldSuspicious
            });
        }
        if (newSuspicious.length > 0) {
            categories.suspicious_new.push({
                ...record,
                category: 'suspicious_new',
                suspicious: newSuspicious
            });
        }
    }

    const specialChecks = Object.fromEntries(SPECIAL_CHECK_IDS.map(verseId => {
        const oldText = Object.prototype.hasOwnProperty.call(oldMap, verseId) ? oldMap[verseId] : null;
        const newText = Object.prototype.hasOwnProperty.call(newMap, verseId) ? newMap[verseId] : null;
        return [verseId, {
            oldText,
            newText,
            category: diffCategoryById.get(verseId) || 'not_compared',
            oldSuspicious: typeof oldText === 'string' ? findSuspiciousPatterns(oldText) : [],
            newSuspicious: typeof newText === 'string' ? findSuspiciousPatterns(newText) : []
        }];
    }));

    const report = {
        generatedAt: new Date().toISOString(),
        oldSource: relativeToRoot(OLD_FILE),
        newSource: relativeToRoot(NEW_FILE),
        csvReport: relativeToRoot(CSV_REPORT_FILE),
        categoryDefinitions: {
            missing_old: 'Verse ID exists in the EPUB-derived new map but not in the old production Lamsa map.',
            missing_new: 'Verse ID exists in the old production Lamsa map but not in the EPUB-derived new map.',
            suspicious_old: 'Old production Lamsa text matched one or more suspicious OCR/mojibake patterns.',
            suspicious_new: 'EPUB-derived Lamsa text matched one or more suspicious OCR/mojibake patterns.'
        },
        suspiciousPatterns: SUSPICIOUS_PATTERNS.map(pattern => pattern.name),
        summary: {
            oldVerseCount: Object.keys(oldMap).length,
            newVerseCount: Object.keys(newMap).length,
            comparedVerseIds: allIds.length,
            ...Object.fromEntries(CATEGORY_NAMES.map(name => [name, categories[name].length]))
        },
        specialChecks,
        categories
    };

    fs.mkdirSync(path.dirname(JSON_REPORT_FILE), { recursive: true });
    fs.writeFileSync(JSON_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(CSV_REPORT_FILE, toCsv(diffRows, categories));

    printSummary(report);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function classifyDifference(oldText, newText) {
    if (oldText === null) {
        return { category: 'missing_old', differenceScore: null };
    }
    if (newText === null) {
        return { category: 'missing_new', differenceScore: null };
    }
    if (oldText === newText) {
        return { category: 'exact_matches', differenceScore: 0 };
    }

    const oldWhitespace = normalizeWhitespace(oldText);
    const newWhitespace = normalizeWhitespace(newText);
    if (oldWhitespace === newWhitespace) {
        return { category: 'whitespace_only_differences', differenceScore: 0 };
    }

    const oldNoPunctuation = normalizeWithoutPunctuation(oldText);
    const newNoPunctuation = normalizeWithoutPunctuation(newText);
    if (oldNoPunctuation === newNoPunctuation) {
        return { category: 'punctuation_only_differences', differenceScore: 0 };
    }

    const differenceScore = getDifferenceScore(oldText, newText);
    const tokenOverlap = getTokenOverlap(oldText, newText);
    const oldTokenCount = tokenizeForComparison(oldText).length;
    const newTokenCount = tokenizeForComparison(newText).length;
    const tokenCountGap = Math.abs(oldTokenCount - newTokenCount);

    if (differenceScore <= 0.18 || (differenceScore <= 0.28 && tokenOverlap >= 0.82 && tokenCountGap <= 8)) {
        return { category: 'minor_wording_differences', differenceScore };
    }

    return { category: 'major_wording_differences', differenceScore };
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

function findSuspiciousPatterns(text) {
    return SUSPICIOUS_PATTERNS.flatMap(pattern => {
        const match = text.match(pattern.regex);
        return match ? [{ name: pattern.name, match: match[0] }] : [];
    });
}

function toCsv(diffRows, categories) {
    const rows = [
        ['category', 'verse_id', 'difference_score', 'old_suspicious', 'new_suspicious', 'old_text', 'new_text']
    ];

    for (const row of diffRows) {
        rows.push([
            row.category,
            row.verseId,
            row.differenceScore === null ? '' : row.differenceScore,
            formatSuspicious(row.oldSuspicious),
            formatSuspicious(row.newSuspicious),
            row.oldText === null ? '' : row.oldText,
            row.newText === null ? '' : row.newText
        ]);
    }

    for (const row of categories.suspicious_old) {
        rows.push([
            'suspicious_old',
            row.verseId,
            row.differenceScore === null ? '' : row.differenceScore,
            formatSuspicious(row.oldSuspicious),
            '',
            row.oldText === null ? '' : row.oldText,
            row.newText === null ? '' : row.newText
        ]);
    }

    for (const row of categories.suspicious_new) {
        rows.push([
            'suspicious_new',
            row.verseId,
            row.differenceScore === null ? '' : row.differenceScore,
            '',
            formatSuspicious(row.newSuspicious),
            row.oldText === null ? '' : row.oldText,
            row.newText === null ? '' : row.newText
        ]);
    }

    return `${rows.map(row => row.map(csvValue).join(',')).join('\n')}\n`;
}

function formatSuspicious(items) {
    return items.map(item => `${item.name}: ${item.match}`).join('; ');
}

function csvValue(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
    console.log('LAMSA source diff complete.');
    console.log(`Old map: ${report.summary.oldVerseCount} verses.`);
    console.log(`New EPUB map: ${report.summary.newVerseCount} verses.`);
    for (const name of CATEGORY_NAMES) {
        console.log(`${name}: ${report.summary[name]}`);
    }

    console.log('\nSpecial checks:');
    for (const verseId of SPECIAL_CHECK_IDS) {
        const check = report.specialChecks[verseId];
        console.log(`${verseId} (${check.category})`);
        console.log(`  old: ${check.oldText === null ? '[missing]' : check.oldText}`);
        console.log(`  new: ${check.newText === null ? '[missing]' : check.newText}`);
    }

    console.log(`\nJSON report saved to ${relativeToRoot(JSON_REPORT_FILE)}`);
    console.log(`CSV report saved to ${relativeToRoot(CSV_REPORT_FILE)}`);
}
