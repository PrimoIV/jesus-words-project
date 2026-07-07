const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INPUT_FILE = path.join(ROOT, 'data/translation_verse_maps/lamsa_epub_verse_map.json');
const OUTPUT_FILE = path.join(ROOT, 'data/translation_verse_maps/lamsa_epub_verse_map_normalized.json');
const REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_epub_normalization_report.json');

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const { data: inputMap, duplicateKeys } = readJsonObjectWithDuplicateCheck(INPUT_FILE);
    const normalizedMap = {};
    const changedVerses = [];
    const paragraphMarkerRemoved = [];
    const whitespaceCollapsed = [];
    const bracketNoteVerses = [];
    const emptyVerseIds = [];
    const validationErrors = [];

    for (const [verseId, rawText] of Object.entries(inputMap)) {
        if (typeof rawText !== 'string') {
            validationErrors.push(`${verseId} has non-string verse text`);
            continue;
        }

        const withoutParagraphMarker = rawText.replace(/^\u00b6\s*/, '');
        const normalizedText = withoutParagraphMarker.replace(/\s+/g, ' ').trim();

        normalizedMap[verseId] = normalizedText;

        if (withoutParagraphMarker !== rawText) {
            paragraphMarkerRemoved.push(verseId);
        }
        if (normalizedText !== withoutParagraphMarker) {
            whitespaceCollapsed.push(verseId);
        }
        if (normalizedText !== rawText) {
            changedVerses.push({
                verseId,
                before: rawText,
                after: normalizedText,
                changes: [
                    withoutParagraphMarker !== rawText ? 'leading_paragraph_marker_removed' : null,
                    normalizedText !== withoutParagraphMarker ? 'whitespace_collapsed' : null
                ].filter(Boolean)
            });
        }
        if (/\[[^\]]+\]/.test(normalizedText)) {
            bracketNoteVerses.push(verseId);
        }
        if (!normalizedText) {
            emptyVerseIds.push(verseId);
        }
    }

    if (duplicateKeys.length > 0) {
        validationErrors.push(`Duplicate verse IDs in ${relativeToRoot(INPUT_FILE)}: ${duplicateKeys.join(', ')}`);
    }

    const normalizedDuplicateKeys = getDuplicateItems(scanRootObjectKeys(`${JSON.stringify(normalizedMap, null, 2)}\n`));
    if (normalizedDuplicateKeys.length > 0) {
        validationErrors.push(`Duplicate verse IDs in normalized output: ${normalizedDuplicateKeys.join(', ')}`);
    }

    const report = {
        generatedAt: new Date().toISOString(),
        inputFile: relativeToRoot(INPUT_FILE),
        outputFile: relativeToRoot(OUTPUT_FILE),
        rules: [
            'Remove leading paragraph marker from EPUB verse text.',
            'Collapse repeated whitespace.',
            'Preserve bracketed explanatory notes.',
            'Preserve punctuation, capitalization, spelling, and wording.',
            'Do not remove narration.',
            'Do not extract Jesus speech.',
            'Do not guess corrections.'
        ],
        summary: {
            totalVerses: Object.keys(inputMap).length,
            changedVerses: changedVerses.length,
            paragraphMarkersRemoved: paragraphMarkerRemoved.length,
            whitespaceCollapsed: whitespaceCollapsed.length,
            bracketNoteVerses: bracketNoteVerses.length,
            emptyVerseTexts: emptyVerseIds.length,
            duplicateVerseIds: duplicateKeys.length,
            validationPassed: validationErrors.length === 0
        },
        paragraphMarkerRemoved,
        whitespaceCollapsed,
        bracketNoteVerses,
        emptyVerseIds,
        duplicateVerseIds: duplicateKeys,
        changedVerses,
        validationErrors
    };

    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);

    if (validationErrors.length > 0) {
        console.error(`LAMSA EPUB normalization failed with ${validationErrors.length} validation error(s).`);
        console.error(`Report saved to ${relativeToRoot(REPORT_FILE)}`);
        process.exit(1);
    }

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(normalizedMap, null, 2)}\n`);

    console.log(`LAMSA EPUB normalization complete: ${Object.keys(normalizedMap).length} verses.`);
    console.log(`Changed verses: ${changedVerses.length}`);
    console.log(`Leading paragraph markers removed: ${paragraphMarkerRemoved.length}`);
    console.log(`Bracket-note verses: ${bracketNoteVerses.length}`);
    console.log(`Normalized map saved to ${relativeToRoot(OUTPUT_FILE)}`);
    console.log(`Report saved to ${relativeToRoot(REPORT_FILE)}`);
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
        return parsedA.book.localeCompare(parsedB.book)
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
