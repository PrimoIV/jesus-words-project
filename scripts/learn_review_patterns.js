const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'dev', 'reports');
const INPUT_FILE = path.join(REPORT_DIR, 'speech_manual_review_sheet.csv');
const OUTPUT_FILE = path.join(REPORT_DIR, 'approved_review_patterns.json');

main();

function main() {
    let rows;
    try {
        rows = loadCsv(INPUT_FILE, 'manual review sheet').rows;
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    const approvedRows = rows.filter(row => getStatus(row) === 'approved');
    const rawEqualsSuggestedRows = [];
    const narrationRemovedRows = [];
    const speakerSetupRemovedRows = [];
    const footnoteMarkerRemovedRows = [];
    const bracketedTextRetainedRows = [];
    const translatorGlossRetainedRows = [];
    const whitespaceRows = [];
    const prefixCounts = new Map();
    const suffixCounts = new Map();
    const reviewNoteCounts = new Map();

    approvedRows.forEach((row, index) => {
        const rawText = stringValue(row.rawText);
        const suggestedText = stringValue(row.suggestedManualSpeechText);
        const reviewNote = stringValue(row.reviewNote).trim();
        const notes = stringValue(row.notes);
        const flags = splitList(row.flags);
        const diff = describeEdgeRemoval(rawText, suggestedText);
        const example = exampleRow(row, index);

        if (rawText === suggestedText) {
            rawEqualsSuggestedRows.push(example);
        }

        if (looksLikeNarrationRemoved(row, diff)) {
            narrationRemovedRows.push({
                ...example,
                removedPrefix: truncate(cleanRemovedSegment(diff.removedPrefix), 180),
                removedSuffix: truncate(cleanRemovedSegment(diff.removedSuffix), 180)
            });
        }

        if (looksLikeSpeakerSetupRemoved(row, diff)) {
            speakerSetupRemovedRows.push({
                ...example,
                removedPrefix: truncate(cleanRemovedSegment(diff.removedPrefix), 180)
            });
        }

        if (looksLikeFootnoteMarkerRemoved(rawText, suggestedText, reviewNote, notes)) {
            footnoteMarkerRemovedRows.push(example);
        }

        if (hasRetainedBracketedText(rawText, suggestedText)) {
            bracketedTextRetainedRows.push({
                ...example,
                retainedBrackets: getBracketMatches(suggestedText)
            });
        }

        if (hasRetainedTranslatorGloss(rawText, suggestedText, reviewNote, notes)) {
            translatorGlossRetainedRows.push({
                ...example,
                retainedGlosses: getParentheticalMatches(suggestedText).concat(getGlossPhraseMatches(suggestedText))
            });
        }

        if (rawText !== rawText.trim() || suggestedText !== suggestedText.trim()) {
            whitespaceRows.push({
                ...example,
                rawTextHasOuterWhitespace: rawText !== rawText.trim(),
                suggestedManualSpeechTextHasOuterWhitespace: suggestedText !== suggestedText.trim()
            });
        }

        addCount(reviewNoteCounts, reviewNote || '(blank)', example);

        const removedPrefix = cleanRemovedSegment(diff.removedPrefix);
        const removedSuffix = cleanRemovedSegment(diff.removedSuffix);
        if (removedPrefix) addCount(prefixCounts, removedPrefix, example);
        if (removedSuffix) addCount(suffixCounts, removedSuffix, example);

        if (!removedPrefix && rawText !== suggestedText && startsAfterQuoteArtifact(rawText, suggestedText)) {
            addCount(prefixCounts, '(quote artifact only)', example);
        }

        if (!removedSuffix && rawText !== suggestedText && endsAfterQuoteArtifact(rawText, suggestedText)) {
            addCount(suffixCounts, '(quote artifact only)', example);
        }

        flags.forEach(flag => {
            if (flag === 'long_prefix_before_quote' && removedPrefix) {
                addCount(prefixCounts, removedPrefix, example);
            }
            if (flag === 'long_suffix_after_quote' && removedSuffix) {
                addCount(suffixCounts, removedSuffix, example);
            }
        });
    });

    const output = {
        generatedAt: new Date().toISOString(),
        sourceFile: relativePath(INPUT_FILE),
        totalRows: rows.length,
        totalApprovedRows: approvedRows.length,
        rawTextEqualsSuggestedManualSpeechText: {
            count: rawEqualsSuggestedRows.length,
            examples: rawEqualsSuggestedRows.slice(0, 25)
        },
        narrationRemovedRows: {
            count: narrationRemovedRows.length,
            examples: narrationRemovedRows.slice(0, 25)
        },
        speakerSetupRemovedRows: {
            count: speakerSetupRemovedRows.length,
            examples: speakerSetupRemovedRows.slice(0, 25)
        },
        footnoteMarkersRemovedRows: {
            count: footnoteMarkerRemovedRows.length,
            examples: footnoteMarkerRemovedRows.slice(0, 25)
        },
        bracketedTextRetainedRows: {
            count: bracketedTextRetainedRows.length,
            examples: bracketedTextRetainedRows.slice(0, 25)
        },
        translatorGlossesRetainedRows: {
            count: translatorGlossRetainedRows.length,
            examples: translatorGlossRetainedRows.slice(0, 25)
        },
        commonRemovedPrefixes: topCounts(prefixCounts, 30),
        commonRemovedSuffixes: topCounts(suffixCounts, 30),
        commonReviewNoteValues: topCounts(reviewNoteCounts, 30),
        approvedRowsWithLeadingOrTrailingWhitespace: {
            count: whitespaceRows.length,
            examples: whitespaceRows
        }
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

    console.log('Approved review patterns learned.');
    console.log(`Approved rows: ${output.totalApprovedRows}`);
    console.log(`Raw equals suggested: ${output.rawTextEqualsSuggestedManualSpeechText.count}`);
    console.log(`Narration removed: ${output.narrationRemovedRows.count}`);
    console.log(`Speaker setup removed: ${output.speakerSetupRemovedRows.count}`);
    console.log(`Footnote markers removed: ${output.footnoteMarkersRemovedRows.count}`);
    console.log(`Bracketed text retained: ${output.bracketedTextRetainedRows.count}`);
    console.log(`Translator glosses retained: ${output.translatorGlossesRetainedRows.count}`);
    console.log(`Approved whitespace issues: ${output.approvedRowsWithLeadingOrTrailingWhitespace.count}`);
    console.log(`Output file: ${relativePath(OUTPUT_FILE)}`);
}

function loadCsv(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing ${label}: ${relativePath(filePath)}`);
    }

    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const table = parseCsv(text);
    if (table.length === 0) return { headers: [], rows: [] };

    const headers = table[0].map(header => header.trim());
    const rows = table.slice(1)
        .filter(cells => cells.some(cell => stringValue(cell).trim() !== ''))
        .map((cells, index) => {
            const row = { __rowNumber: index + 2 };
            headers.forEach((header, columnIndex) => {
                row[header] = cells[columnIndex] === undefined ? '' : cells[columnIndex];
            });
            return row;
        });

    return { headers, rows };
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];

        if (inQuotes) {
            if (char === '"' && next === '"') {
                cell += '"';
                index += 1;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                cell += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(cell);
            cell = '';
        } else if (char === '\r') {
            if (next === '\n') index += 1;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else if (char === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += char;
        }
    }

    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    return rows;
}

function describeEdgeRemoval(rawText, suggestedText) {
    if (!rawText || !suggestedText || rawText === suggestedText) {
        return {
            removedPrefix: '',
            removedSuffix: '',
            matchedSuggestedText: rawText === suggestedText
        };
    }

    const directIndex = rawText.indexOf(suggestedText);
    if (directIndex >= 0) {
        return {
            removedPrefix: rawText.slice(0, directIndex),
            removedSuffix: rawText.slice(directIndex + suggestedText.length),
            matchedSuggestedText: true
        };
    }

    const artifactNormalizedRaw = normalizeQuoteAndFootnoteArtifacts(rawText);
    const artifactNormalizedSuggested = normalizeQuoteAndFootnoteArtifacts(suggestedText);
    const normalizedIndex = artifactNormalizedRaw.indexOf(artifactNormalizedSuggested);
    if (normalizedIndex >= 0) {
        return {
            removedPrefix: artifactNormalizedRaw.slice(0, normalizedIndex),
            removedSuffix: artifactNormalizedRaw.slice(normalizedIndex + artifactNormalizedSuggested.length),
            matchedSuggestedText: true
        };
    }

    let prefixLength = 0;
    const maxPrefix = Math.min(rawText.length, suggestedText.length);
    while (prefixLength < maxPrefix && rawText[prefixLength] === suggestedText[prefixLength]) {
        prefixLength += 1;
    }

    let suffixLength = 0;
    const rawRemainder = rawText.length - prefixLength;
    const suggestedRemainder = suggestedText.length - prefixLength;
    while (
        suffixLength < rawRemainder &&
        suffixLength < suggestedRemainder &&
        rawText[rawText.length - 1 - suffixLength] === suggestedText[suggestedText.length - 1 - suffixLength]
    ) {
        suffixLength += 1;
    }

    return {
        removedPrefix: rawText.slice(0, prefixLength),
        removedSuffix: rawText.slice(rawText.length - suffixLength),
        unmatchedRawMiddle: rawText.slice(prefixLength, rawText.length - suffixLength),
        unmatchedSuggestedMiddle: suggestedText.slice(prefixLength, suggestedText.length - suffixLength),
        matchedSuggestedText: false
    };
}

function looksLikeNarrationRemoved(row, diff) {
    const reviewNote = stringValue(row.reviewNote);
    const flags = splitList(row.flags);
    const removedText = `${diff.removedPrefix} ${diff.removedSuffix}`;

    return /removed narration/i.test(reviewNote) ||
        flags.some(flag => ['pre_speech_narration', 'post_speech_narration', 'long_prefix_before_quote', 'long_suffix_after_quote'].includes(flag)) &&
            hasNarrationCue(removedText);
}

function looksLikeSpeakerSetupRemoved(row, diff) {
    const reviewNote = stringValue(row.reviewNote);
    const removedText = diff.removedPrefix;

    return /removed speaker setup/i.test(reviewNote) ||
        /\b(?:Jesus|he)\s+(?:said|answered|replied|asked|ordered|commanded|charged|began)\b/i.test(removedText) ||
        /\bsaid\s+to\s+(?:him|them|her|Peter|the\s+\w+)\b/i.test(removedText);
}

function looksLikeFootnoteMarkerRemoved(rawText, suggestedText, reviewNote, notes) {
    return /footnote|asterisk marker/i.test(`${reviewNote} ${notes}`) ||
        (/[†‡§*]|\{\d+\}/.test(rawText) && !/[†‡§*]|\{\d+\}/.test(suggestedText));
}

function hasRetainedBracketedText(rawText, suggestedText) {
    return getBracketMatches(rawText).some(match => suggestedText.includes(match));
}

function hasRetainedTranslatorGloss(rawText, suggestedText, reviewNote, notes) {
    const combined = `${rawText} ${suggestedText} ${reviewNote} ${notes}`;
    if (!/(translator gloss|which means|that is|meaning|literally|i\.e\.|\([^)]*\))/i.test(combined)) return false;

    const parentheticals = getParentheticalMatches(rawText);
    if (parentheticals.some(match => suggestedText.includes(match))) return true;

    return /\b(which\s+means|that\s+is|meaning|literally|i\.e\.)\b/i.test(suggestedText) ||
        /translator gloss retained/i.test(reviewNote);
}

function hasNarrationCue(text) {
    return /\b(?:Jesus|disciples|Peter|crowds?|people)\b/i.test(text) ||
        /\b(?:said|answered|replied|asked|ordered|commanded|charged|began|went|left|followed|healed|cleansed|opened|fled)\b/i.test(text) ||
        /\b(?:Then|And|But|When|As|After|While)\b/i.test(text);
}

function startsAfterQuoteArtifact(rawText, suggestedText) {
    return normalizeQuoteAndFootnoteArtifacts(rawText).startsWith(normalizeQuoteAndFootnoteArtifacts(suggestedText));
}

function endsAfterQuoteArtifact(rawText, suggestedText) {
    return normalizeQuoteAndFootnoteArtifacts(rawText).endsWith(normalizeQuoteAndFootnoteArtifacts(suggestedText));
}

function normalizeQuoteAndFootnoteArtifacts(text) {
    return stringValue(text)
        .replace(/[“”"]/g, '')
        .replace(/[†‡§*]/g, '')
        .replace(/\{\d+\}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitList(value) {
    return stringValue(value)
        .split(';')
        .map(item => item.trim())
        .filter(Boolean);
}

function getBracketMatches(text) {
    return stringValue(text).match(/\[[^\]]+\]/g) || [];
}

function getParentheticalMatches(text) {
    return stringValue(text).match(/\([^)]*\)/g) || [];
}

function getGlossPhraseMatches(text) {
    return stringValue(text).match(/\b(?:which\s+means|that\s+is|meaning|literally|i\.e\.)\b[^.;,)]*/gi) || [];
}

function addCount(map, value, example) {
    const key = value.trim();
    if (!key) return;

    if (!map.has(key)) {
        map.set(key, { count: 0, examples: [] });
    }

    const entry = map.get(key);
    entry.count += 1;
    if (entry.examples.length < 8) {
        entry.examples.push(example);
    }
}

function topCounts(map, limit) {
    return Array.from(map.entries())
        .map(([value, entry]) => ({
            value,
            count: entry.count,
            examples: entry.examples
        }))
        .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
        .slice(0, limit);
}

function exampleRow(row, index) {
    return {
        rowNumber: row.__rowNumber || index + 2,
        id: stringValue(row.id),
        reference: stringValue(row.reference),
        translationKey: stringValue(row.translationKey),
        flags: stringValue(row.flags),
        reviewNote: stringValue(row.reviewNote),
        rawText: truncate(stringValue(row.rawText), 220),
        suggestedManualSpeechText: truncate(stringValue(row.suggestedManualSpeechText), 220)
    };
}

function cleanRemovedSegment(value) {
    return stringValue(value)
        .replace(/[“”"‘’]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getStatus(row) {
    return stringValue(row.approvalStatus).trim().toLowerCase();
}

function stringValue(value) {
    return typeof value === 'string' ? value : '';
}

function truncate(value, maxLength) {
    const text = stringValue(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}...`;
}

function relativePath(filePath) {
    return path.relative(ROOT, filePath).replace(/\\/g, '/');
}
