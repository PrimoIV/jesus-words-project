const fs = require('fs');
const path = require('path');
const {
    getDiscourseBlocksForVerseId,
    parseVerseId,
    compareVerseRefs
} = require('./load_jesus_discourse_context');

const ROOT = path.join(__dirname, '..');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const HELD_APPLY_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_held_apply_dry_run.json');
const JSON_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_neighbor_context_audit.json');
const CSV_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_neighbor_context_audit.csv');

const NEIGHBOR_OFFSETS = [-2, -1, 1, 2];
const CSV_COLUMNS = [
    'verseId',
    'neighborOfAppliedVerseId',
    'rawLamsa',
    'existingSpeechTextLAMSA',
    'speechStatusLAMSA',
    'contextRisk',
    'riskReason',
    'recommendedAction'
];

const BROAD_CONTEXT_BLOCKS = [
    block('MAT_5_1-MAT_7_29', 'sermon', 'Sermon on the Mount'),
    block('MAT_10_5-MAT_10_42', 'discourse', 'Mission Discourse'),
    block('MAT_23_1-MAT_23_39', 'discourse', 'Woes Against the Scribes and Pharisees'),
    block('MAT_24_1-MAT_25_46', 'discourse', 'Olivet Discourse'),
    block('MRK_4_1-MRK_4_34', 'parable', 'Mark Parable Discourse'),
    block('LUK_6_20-LUK_6_49', 'sermon', 'Sermon on the Plain'),
    block('LUK_11_2-LUK_11_4', 'prayer', 'Lord’s Prayer'),
    block('LUK_15_3-LUK_15_32', 'parable', 'Lost Things Parables'),
    block('LUK_16_1-LUK_16_31', 'parable', 'Steward and Rich Man Parables'),
    block('LUK_18_1-LUK_18_14', 'parable', 'Prayer Parables'),
    block('JHN_3_3-JHN_3_21', 'long_teaching', 'Jesus and Nicodemus'),
    block('JHN_5_19-JHN_5_47', 'long_teaching', 'Authority of the Son'),
    block('JHN_6_26-JHN_6_58', 'long_teaching', 'Bread of Life Discourse'),
    block('JHN_8_12-JHN_8_59', 'long_teaching', 'Light and Freedom Discourse'),
    block('JHN_10_1-JHN_10_18', 'long_teaching', 'Good Shepherd Teaching'),
    block('JHN_13_31-JHN_16_33', 'discourse', 'Farewell Discourse'),
    block('JHN_17_1-JHN_17_26', 'prayer', 'High Priestly Prayer'),
    block('MAT_26_26-MAT_26_29', 'prayer', 'Last Supper Words'),
    block('LUK_22_17-LUK_22_20', 'prayer', 'Last Supper Words'),
    block('MAT_27_46-MAT_27_46', 'crucifixion_saying', 'Matthew Crucifixion Saying'),
    block('MRK_15_34-MRK_15_34', 'crucifixion_saying', 'Mark Crucifixion Saying'),
    block('LUK_23_34-LUK_23_46', 'crucifixion_saying', 'Luke Crucifixion Sayings'),
    block('JHN_19_26-JHN_19_30', 'crucifixion_saying', 'John Crucifixion Sayings')
];

const NARRATION_OR_SETUP_PATTERNS = [
    { label: 'Jesus speaker setup', regex: /\bJesus\s+(?:said|answered|cried|met|spoke|began|commanded|asked)\b/i },
    { label: 'generic speaker setup', regex: /\b(?:he\s+said|he\s+answered|and\s+he\s+said|saying(?:\s+to\s+\w+)?)\b/i },
    { label: 'external speaker reply', regex: /\b(?:They|Peter|Thomas|She|The disciples|The Pharisees|The Jews|servants)\s+(?:said|answered|replied)\b/i },
    { label: 'narrative action', regex: /\b(?:came|went|entered|met|remembered|wept|brought|followed|touched|stretched|was\s+healed|was\s+cleansed|laid\s+hold|worshipped|took\s+bread|gave\s+it\s+to\s+them)\b/i }
];

const POSSIBLE_SPEECH_PATTERN = /\b(?:I|you|your|yours|we|us|our|my|me|Truly|Blessed|Woe|Come|Go|Let|Peace|Fear|Believe|Repent|The kingdom|Whoever|If|For)\b/i;
const INTERNAL_PARABLE_PATTERN = /\b(?:servant|servants|lord|master|king|bridegroom|virgins|talents|laborers|tenants|landowner|reapers|wheat|tares|he\s+said|they\s+said|answered|saying)\b/i;

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const dataset = readJson(DATASET_FILE);
    const heldApplyReport = readJson(HELD_APPLY_REPORT_FILE);
    const appliedVerseIds = (heldApplyReport.applyRows || []).map(row => row.verseId);
    const heldReviewVerseIds = new Set([
        ...(heldApplyReport.applyRows || []).map(row => row.verseId),
        ...(heldApplyReport.skippedRejectRows || []).map(row => row.verseId),
        ...(heldApplyReport.skippedDeferRows || []).map(row => row.verseId)
    ]);

    const neighborMap = buildNeighborMap({ dataset, appliedVerseIds });
    const rows = [...neighborMap.values()]
        .map(entry => buildAuditRow({ entry, dataset, heldReviewVerseIds }))
        .filter(row => row.riskReasons.length > 0)
        .sort(compareAuditRows)
        .map(row => ({
            verseId: row.verseId,
            neighborOfAppliedVerseId: row.neighborOfAppliedVerseId.join('; '),
            rawLamsa: row.rawLamsa,
            existingSpeechTextLAMSA: row.existingSpeechTextLAMSA,
            speechStatusLAMSA: row.speechStatusLAMSA,
            contextRisk: row.contextRisk,
            riskReason: row.riskReasons.join('; '),
            recommendedAction: row.recommendedAction
        }));

    const summary = buildSummary(rows, appliedVerseIds, heldReviewVerseIds);
    const report = {
        generatedAt: new Date().toISOString(),
        inputs: {
            dataset: relativeToRoot(DATASET_FILE),
            heldApplyReport: relativeToRoot(HELD_APPLY_REPORT_FILE)
        },
        outputs: {
            json: relativeToRoot(JSON_REPORT_FILE),
            csv: relativeToRoot(CSV_REPORT_FILE)
        },
        neighborWindow: {
            offsets: NEIGHBOR_OFFSETS,
            description: 'Same book/chapter only; applied verse itself is excluded unless it is a neighbor of another applied verse.'
        },
        summary,
        rows
    };

    fs.mkdirSync(path.dirname(JSON_REPORT_FILE), { recursive: true });
    fs.writeFileSync(JSON_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(CSV_REPORT_FILE, `${toCsv(rows)}\n`, 'utf8');

    printSummary(summary);
}

function buildNeighborMap({ dataset, appliedVerseIds }) {
    const map = new Map();

    for (const appliedVerseId of appliedVerseIds) {
        const parsed = parseVerseId(appliedVerseId);
        if (!parsed) continue;

        for (const offset of NEIGHBOR_OFFSETS) {
            const neighborVerse = parsed.verse + offset;
            if (neighborVerse < 1) continue;
            const neighborId = `${parsed.book}_${parsed.chapter}_${neighborVerse}`;
            if (!dataset[neighborId]) continue;

            if (!map.has(neighborId)) {
                map.set(neighborId, {
                    verseId: neighborId,
                    neighborOfAppliedVerseId: new Set()
                });
            }
            map.get(neighborId).neighborOfAppliedVerseId.add(appliedVerseId);
        }
    }

    return map;
}

function buildAuditRow({ entry, dataset, heldReviewVerseIds }) {
    const record = dataset[entry.verseId] || {};
    const rawLamsa = stringValue(record.translations?.LAMSA);
    const existingSpeechTextLAMSA = stringValue(record.speechText?.LAMSA);
    const speechStatusLAMSA = stringValue(record.speechStatus?.LAMSA);
    const discourseBlocks = getContextBlocks(entry.verseId);
    const riskReasons = [];

    if (!heldReviewVerseIds.has(entry.verseId)) {
        riskReasons.push('Neighbor row was not included in the held-review sheet.');
    }
    if (existingSpeechTextLAMSA) {
        riskReasons.push('Neighbor row already has LAMSA speechText present.');
    }
    if (discourseBlocks.length > 0) {
        riskReasons.push(`Neighbor occurs inside context block(s): ${discourseBlocks.map(formatContextBlock).join(' | ')}.`);
    }

    const narrationMatches = getNarrationMatches(rawLamsa);
    if (narrationMatches.length > 0) {
        riskReasons.push(`Raw LAMSA may contain narration or speaker setup: ${narrationMatches.join(', ')}.`);
    }

    if (!existingSpeechTextLAMSA && mayContainMissingSpeech(rawLamsa, discourseBlocks)) {
        riskReasons.push('Neighbor may be missing Jesus speech because the verse looked like narration or context-only text.');
    }

    if (isParableLikeContext(discourseBlocks) && INTERNAL_PARABLE_PATTERN.test(rawLamsa)) {
        riskReasons.push('Neighbor may contain internal parable narration/dialogue that should be preserved, not removed.');
    }

    return {
        verseId: entry.verseId,
        neighborOfAppliedVerseId: [...entry.neighborOfAppliedVerseId].sort(compareVerseIds),
        rawLamsa,
        existingSpeechTextLAMSA,
        speechStatusLAMSA,
        contextRisk: getContextRisk({ riskReasons, existingSpeechTextLAMSA, discourseBlocks, narrationMatches, rawLamsa }),
        riskReasons,
        recommendedAction: getRecommendedAction({ existingSpeechTextLAMSA, discourseBlocks, narrationMatches, rawLamsa, heldReviewVerseIds, verseId: entry.verseId })
    };
}

function getContextBlocks(verseId) {
    const discourseBlocks = getDiscourseBlocksForVerseId(verseId);
    const broadBlocks = BROAD_CONTEXT_BLOCKS.filter(contextBlock => isVerseIdInRange(verseId, contextBlock));
    return [...discourseBlocks, ...broadBlocks];
}

function getNarrationMatches(text) {
    return NARRATION_OR_SETUP_PATTERNS
        .filter(pattern => pattern.regex.test(text))
        .map(pattern => pattern.label);
}

function mayContainMissingSpeech(text, discourseBlocks) {
    return POSSIBLE_SPEECH_PATTERN.test(text)
        && (discourseBlocks.length > 0 || getNarrationMatches(text).length > 0);
}

function isParableLikeContext(discourseBlocks) {
    return discourseBlocks.some(block => block.type === 'parable');
}

function getContextRisk({ riskReasons, existingSpeechTextLAMSA, discourseBlocks, narrationMatches, rawLamsa }) {
    if (!riskReasons.length) return 'none';
    if (
        (!existingSpeechTextLAMSA && mayContainMissingSpeech(rawLamsa, discourseBlocks)) ||
        (existingSpeechTextLAMSA && narrationMatches.length > 0) ||
        (isParableLikeContext(discourseBlocks) && INTERNAL_PARABLE_PATTERN.test(rawLamsa))
    ) {
        return 'high';
    }
    if (discourseBlocks.length > 0 || existingSpeechTextLAMSA) return 'medium';
    return 'low';
}

function getRecommendedAction({ existingSpeechTextLAMSA, discourseBlocks, narrationMatches, rawLamsa, heldReviewVerseIds, verseId }) {
    if (!existingSpeechTextLAMSA && mayContainMissingSpeech(rawLamsa, discourseBlocks)) {
        return 'review_for_possible_missing_lamsa_speechText';
    }
    if (isParableLikeContext(discourseBlocks) && INTERNAL_PARABLE_PATTERN.test(rawLamsa)) {
        return 'review_parable_context_preserve_internal_dialogue';
    }
    if (existingSpeechTextLAMSA && narrationMatches.length > 0) {
        return 'review_existing_lamsa_speechText_boundary';
    }
    if (!heldReviewVerseIds.has(verseId) && existingSpeechTextLAMSA) {
        return 'confirm_previous_auto_apply_or_existing_lamsa_speechText';
    }
    if (discourseBlocks.length > 0) {
        return 'review_discourse_context';
    }
    return 'review_neighbor_context';
}

function buildSummary(rows, appliedVerseIds, heldReviewVerseIds) {
    return {
        appliedHeldReviewVerseCount: appliedVerseIds.length,
        heldReviewSheetVerseCount: heldReviewVerseIds.size,
        flaggedNeighborRowCount: rows.length,
        highRiskCount: rows.filter(row => row.contextRisk === 'high').length,
        mediumRiskCount: rows.filter(row => row.contextRisk === 'medium').length,
        lowRiskCount: rows.filter(row => row.contextRisk === 'low').length,
        notInHeldReviewSheetCount: rows.filter(row => row.riskReason.includes('not included in the held-review sheet')).length,
        existingSpeechTextPresentCount: rows.filter(row => row.existingSpeechTextLAMSA).length,
        possibleMissingSpeechCount: rows.filter(row => row.recommendedAction === 'review_for_possible_missing_lamsa_speechText').length,
        parableInternalNarrationCount: rows.filter(row => row.recommendedAction === 'review_parable_context_preserve_internal_dialogue').length
    };
}

function block(range, type, title) {
    const [startId, endId] = range.split('-');
    return {
        range,
        type,
        title,
        start: parseVerseId(startId),
        end: parseVerseId(endId)
    };
}

function isVerseIdInRange(verseId, range) {
    const parsed = parseVerseId(verseId);
    if (!parsed || !range.start || !range.end) return false;
    return compareVerseRefs(parsed, range.start) >= 0 && compareVerseRefs(parsed, range.end) <= 0;
}

function formatContextBlock(block) {
    return `${block.type}: ${block.title}`;
}

function compareAuditRows(a, b) {
    return compareVerseIds(a.verseId, b.verseId);
}

function compareVerseIds(a, b) {
    const parsedA = parseVerseId(a);
    const parsedB = parseVerseId(b);
    if (!parsedA || !parsedB) return a.localeCompare(b);
    return compareVerseRefs(parsedA, parsedB);
}

function toCsv(rows) {
    const csvRows = [CSV_COLUMNS];
    for (const row of rows) {
        csvRows.push(CSV_COLUMNS.map(column => row[column] ?? ''));
    }
    return csvRows.map(row => row.map(csvValue).join(',')).join('\r\n');
}

function csvValue(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stringValue(value) {
    return typeof value === 'string' ? value : '';
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function printSummary(summary) {
    console.log('LAMSA neighbor context audit complete.');
    console.log(`Applied held-review verses inspected: ${summary.appliedHeldReviewVerseCount}`);
    console.log(`Flagged neighbor rows: ${summary.flaggedNeighborRowCount}`);
    console.log(`High risk: ${summary.highRiskCount}`);
    console.log(`Medium risk: ${summary.mediumRiskCount}`);
    console.log(`Low risk: ${summary.lowRiskCount}`);
    console.log(`Possible missing speech: ${summary.possibleMissingSpeechCount}`);
    console.log(`Parable internal narration/dialogue: ${summary.parableInternalNarrationCount}`);
    console.log(`JSON report saved to ${relativeToRoot(JSON_REPORT_FILE)}`);
    console.log(`CSV report saved to ${relativeToRoot(CSV_REPORT_FILE)}`);
}
