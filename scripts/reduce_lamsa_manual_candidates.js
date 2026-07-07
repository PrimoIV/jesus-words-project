const fs = require('fs');
const path = require('path');
const {
    getParableContextForVerseId,
    isParableContextVerseId
} = require('./load_jesus_discourse_context');

const ROOT = path.join(__dirname, '..');
const PREVIEW_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_regeneration_preview.json');
const AUDIT_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_candidate_audit.json');
const JSON_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_manual_reduction_preview.json');
const CSV_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_manual_reduction_preview.csv');

const PARABLE_REVIEW_REASON = 'Parable-internal dialogue preserved; review required.';

const PROMOTABLE_PATTERNS = [
    { label: 'Jesus said to them', regex: /\bJesus\s+said\s+to\s+them,\s*/i },
    { label: 'Jesus said to him', regex: /\bJesus\s+said\s+to\s+him,\s*/i },
    { label: 'Jesus answered and said', regex: /\bJesus\s+answered\s+and\s+said,\s*/i },
    { label: 'Jesus answered, saying', regex: /\bJesus\s+answered,\s+saying,\s*/i },
    { label: 'Jesus commanded them, saying', regex: /\bJesus\s+commanded\s+them,\s+saying,\s*/i }
];

const TRAILING_OTHER_SPEAKER_PATTERNS = [
    { label: 'other-speaker response', regex: /\s*(?:They\s+(?:said\s+to\s+him|answered|replied)|Peter\s+said|Thomas\s+answered|She\s+said\s+to\s+him),\s*[^.!?]+[.!?]?$/i },
    { label: 'they brought penny', regex: /\s*(?:And|and)\s+they\s+brought\s+to\s+him\s+a\s+penny\.?$/i },
    { label: 'they brought it', regex: /\s*(?:And|and)\s+they\s+brought\s+it\s+to\s+him\.?$/i }
];

const PARABLE_SPEAKER_SETUP_PATTERNS = [
    {
        label: 'parable intro',
        regex: /^He\s+related\s+another\s+parable\s+to\s+them,\s+saying,\s*/i
    },
    {
        label: 'parable he said to them',
        regex: /^(?:But\s+)?He\s+said\s+to\s+them,\s*/i
    },
    {
        label: 'parable servant instruction',
        regex: /^Then\s+he\s+said\s+to\s+his\s+servants,\s*/i
    },
    {
        label: 'parable answer setup',
        regex: /^(?:But\s+)?he\s+answered,\s*/i
    }
];

const BLOCKER_PATTERNS = [
    { label: 'starts with he said', regex: /^he\s+said\b/i },
    { label: 'starts with saying', regex: /^saying\b/i },
    { label: 'starts with then he said to his servants', regex: /^Then\s+he\s+said\s+to\s+his\s+servants\b/i },
    { label: 'Jesus said', regex: /\bJesus\s+said\b/i },
    { label: 'Jesus answered', regex: /\bJesus\s+answered\b/i },
    { label: 'Jesus replied', regex: /\bJesus\s+replied\b/i },
    { label: 'Jesus asked', regex: /\bJesus\s+asked\b/i },
    { label: 'Jesus anticipated', regex: /\bJesus\s+anticipated\b/i },
    { label: 'he said', regex: /\bhe\s+said\b/i, allowInParable: true },
    { label: 'he answered', regex: /\bhe\s+answered\b/i, allowInParable: true },
    { label: 'and he said', regex: /\band\s+he\s+said\b/i, allowInParable: true },
    { label: 'saying comma', regex: /(?:^|[.!?]\s*)saying,\s*/i, allowInParable: true },
    { label: 'saying to him', regex: /\bsaying\s+to\s+him\b/i, allowInParable: true },
    { label: 'saying to them', regex: /\bsaying\s+to\s+them\b/i, allowInParable: true },
    { label: 'Peter entered', regex: /\bPeter\s+entered\b/i },
    { label: 'they brought to him', regex: /\bthey\s+brought\s+to\s+him\b/i },
    { label: 'They said to him', regex: /\bThey\s+said\s+to\s+him\b/ },
    { label: 'Peter said', regex: /\bPeter\s+said\b/i },
    { label: 'Thomas answered', regex: /\bThomas\s+answered\b/i },
    { label: 'She said to him', regex: /\bShe\s+said\s+to\s+him\b/i },
    { label: 'which means', regex: /\bwhich\s+means\b/i },
    { label: 'bracketed editorial note', regex: /\[[^\]]*(?:idiom|synonym|Aramaic|literal|used by|translation|dialect|destiny)[^\]]*\]/i },
    { label: 'few this', regex: /\bfew this\b/i }
];

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const preview = readJson(PREVIEW_FILE);
    const audit = readJson(AUDIT_FILE);
    const auditById = new Map((audit.rows || []).map(row => [row.verseId, row]));
    const manualRows = (preview.rows || []).filter(row => row.action === 'manual_required');
    const rows = manualRows.map(row => reduceRow(row, auditById.get(row.verseId)));
    const validationErrors = validate(rows, manualRows.length, preview.rows || []);
    const summary = buildSummary(rows, manualRows.length, validationErrors);
    const report = {
        generatedAt: new Date().toISOString(),
        inputs: {
            preview: relativeToRoot(PREVIEW_FILE),
            audit: relativeToRoot(AUDIT_FILE)
        },
        outputs: {
            jsonReport: relativeToRoot(JSON_REPORT_FILE),
            csvReport: relativeToRoot(CSV_REPORT_FILE)
        },
        summary,
        validationErrors,
        remainingManualRequiredVerseIds: rows
            .filter(row => row.proposedAction === 'stay_manual_required')
            .map(row => row.verseId),
        rows
    };

    fs.mkdirSync(path.dirname(JSON_REPORT_FILE), { recursive: true });
    fs.writeFileSync(JSON_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(CSV_REPORT_FILE, toCsv(rows), 'utf8');

    printSummary(summary, report.remainingManualRequiredVerseIds);

    if (validationErrors.length > 0) {
        console.error(`LAMSA manual reduction preview failed with ${validationErrors.length} validation error(s).`);
        validationErrors.forEach(error => console.error(`- ${error}`));
        process.exit(1);
    }
}

function reduceRow(row, auditRow) {
    const raw = row.rawLamsa || '';
    const auditFlags = auditRow?.flags || [];
    const parableContext = getParableContextForVerseId(row.verseId);

    if (row.bracketNotePresent) {
        return stayManual(row, auditFlags, 'Bracket-note verse excluded from manual reduction.');
    }
    if (isCrucifixionSaying(row, raw)) {
        return stayManual(row, auditFlags, 'Crucifixion saying excluded from manual reduction.');
    }
    if (parableContext) {
        return reduceParableRow(row, auditFlags);
    }

    const extraction = extractPromotableCandidate(raw);
    if (!extraction) {
        return stayManual(row, auditFlags, 'No allowed explicit Jesus speech boundary found.');
    }

    let candidate = extraction.candidate;
    const trailingRemoval = removeTrailingOtherSpeaker(candidate);
    candidate = trailingRemoval.candidate;
    candidate = cleanCandidate(candidate);

    if (!candidate) {
        return stayManual(row, auditFlags, 'Allowed boundary found, but extracted candidate was empty.');
    }

    const blockerMatches = getBlockerMatches(candidate, row.verseId);
    if (blockerMatches.length > 0) {
        return stayManual(row, auditFlags.concat(blockerMatches.map(match => `proposed_blocker: ${match}`)), `Promoted candidate still contains blocker patterns: ${blockerMatches.join('; ')}.`);
    }

    const hadOtherSpeakerBeforeJesus = hasOtherSpeakerBefore(raw, extraction.index);
    return {
        verseId: row.verseId,
        reference: row.reference,
        rawLamsa: row.rawLamsa,
        oldAction: row.action,
        proposedCandidateSpeechTextLAMSA: candidate,
        proposedAction: hadOtherSpeakerBeforeJesus ? 'promote_to_review_required' : 'promote_to_auto_safe',
        reason: [
            `Extracted after ${extraction.label}.`,
            hadOtherSpeakerBeforeJesus ? 'Other speaker material appears before the Jesus boundary; keep promoted candidate under review.' : null,
            trailingRemoval.labels.length > 0 ? `Removed trailing material: ${trailingRemoval.labels.join('; ')}.` : null
        ].filter(Boolean).join(' '),
        auditFlags,
        confidence: hadOtherSpeakerBeforeJesus ? 'medium' : 'high'
    };
}

function reduceParableRow(row, auditFlags) {
    let candidate = cleanCandidate(row.rawLamsa || '');
    const parableContext = getParableContextForVerseId(row.verseId);
    const setupRemoval = removeParableSpeakerSetup(candidate);
    const notes = [];

    if (setupRemoval.candidate !== candidate) {
        candidate = setupRemoval.candidate;
        notes.push(`Removed parable setup: ${setupRemoval.label}.`);
    }

    candidate = cleanCandidate(candidate);

    if (!candidate) {
        return stayManual(row, auditFlags, 'Parable context found, but extracted candidate was empty.');
    }

    const blockerMatches = getBlockerMatches(candidate, row.verseId);
    if (blockerMatches.length > 0) {
        return stayManual(row, auditFlags.concat(blockerMatches.map(match => `proposed_blocker: ${match}`)), `Parable candidate still contains blocker patterns: ${blockerMatches.join('; ')}.`);
    }

    return {
        verseId: row.verseId,
        reference: row.reference,
        rawLamsa: row.rawLamsa,
        oldAction: row.action,
        proposedCandidateSpeechTextLAMSA: candidate,
        proposedAction: 'promote_to_review_required',
        reason: [PARABLE_REVIEW_REASON, parableContext?.title ? `Context: ${parableContext.title}.` : null, ...notes].filter(Boolean).join(' '),
        auditFlags,
        confidence: 'medium'
    };
}

function stayManual(row, auditFlags, reason) {
    return {
        verseId: row.verseId,
        reference: row.reference,
        rawLamsa: row.rawLamsa,
        oldAction: row.action,
        proposedCandidateSpeechTextLAMSA: null,
        proposedAction: 'stay_manual_required',
        reason,
        auditFlags,
        confidence: 'low'
    };
}

function extractPromotableCandidate(raw) {
    let best = null;

    for (const pattern of PROMOTABLE_PATTERNS) {
        const match = raw.match(pattern.regex);
        if (!match) continue;
        const index = match.index + match[0].length;
        if (!best || index > best.index) {
            best = {
                label: pattern.label,
                index,
                candidate: raw.slice(index)
            };
        }
    }

    return best;
}

function removeTrailingOtherSpeaker(candidate) {
    let output = candidate;
    const labels = [];
    let changed = true;

    while (changed) {
        changed = false;
        for (const pattern of TRAILING_OTHER_SPEAKER_PATTERNS) {
            const next = output.replace(pattern.regex, '').trim();
            if (next !== output) {
                output = next;
                labels.push(pattern.label);
                changed = true;
                break;
            }
        }
    }

    return { candidate: output, labels };
}

function removeParableSpeakerSetup(candidate) {
    let best = null;

    for (const pattern of PARABLE_SPEAKER_SETUP_PATTERNS) {
        const match = candidate.match(pattern.regex);
        if (!match || match.index !== 0) continue;
        if (!best || match[0].length > best.match[0].length) {
            best = { match, label: pattern.label };
        }
    }

    if (!best) return { candidate, label: null };
    return {
        candidate: candidate.slice(best.match[0].length).trim(),
        label: best.label
    };
}

function hasOtherSpeakerBefore(raw, boundaryIndex) {
    const before = raw.slice(0, boundaryIndex);
    return /\b(?:They\s+(?:said|answered|replied)|Peter\s+said|Thomas\s+answered|She\s+said|disciples\s+said|Jews\s+said|Pharisees\s+said|answered,\s+saying\s+to\s+him)\b/i.test(before);
}

function isCrucifixionSaying(row, raw) {
    return row.verseId === 'MAT_27_46'
        || row.verseId === 'MRK_15_34'
        || /\b(?:ninth\s+hour|crucif|Golgotha)\b/i.test(raw)
        || /\bcross\b(?!\s+over\b)/i.test(raw);
}

function getBlockerMatches(candidate, verseId) {
    const parableContext = isParableContextVerseId(verseId);
    return BLOCKER_PATTERNS
        .filter(pattern => !(parableContext && pattern.allowInParable))
        .filter(pattern => pattern.regex.test(candidate))
        .map(pattern => pattern.label);
}

function cleanCandidate(candidate) {
    return candidate
        .replace(/\s+/g, ' ')
        .replace(/^[,;:\s]+/, '')
        .replace(/\s+([,.;:!?])/g, '$1')
        .trim();
}

function validate(rows, originalManualCount, previewRows) {
    const errors = [];
    const promoted = rows.filter(row => row.proposedAction !== 'stay_manual_required');
    const stayedManual = rows.filter(row => row.proposedAction === 'stay_manual_required');
    const previewById = new Map(previewRows.map(row => [row.verseId, row]));

    for (const row of promoted) {
        const blockers = getBlockerMatches(row.proposedCandidateSpeechTextLAMSA || '', row.verseId);
        if (blockers.length > 0) {
            errors.push(`${row.verseId} promoted candidate contains blocker patterns: ${blockers.join('; ')}`);
        }
    }

    if (promoted.length + stayedManual.length !== originalManualCount) {
        errors.push(`Promoted count plus stayed manual count is ${promoted.length + stayedManual.length}, expected ${originalManualCount}`);
    }

    const mrk435PreviewRow = previewById.get('MRK_4_35');
    const mrk435ReducerRow = rows.find(row => row.verseId === 'MRK_4_35');
    const mrk435Candidate = mrk435PreviewRow?.candidateSpeechTextLAMSA || mrk435ReducerRow?.proposedCandidateSpeechTextLAMSA || null;
    if (mrk435PreviewRow && isCrucifixionSaying(mrk435PreviewRow, mrk435PreviewRow.rawLamsa || '')) {
        errors.push('MRK_4_35 raw LAMSA was incorrectly matched by crucifixion detection');
    }
    if (mrk435ReducerRow?.reason === 'Crucifixion saying excluded from manual reduction.') {
        errors.push('MRK_4_35 was incorrectly classified as a crucifixion saying');
    }
    if (mrk435Candidate !== 'Let us cross over to the landing place.') {
        errors.push(`MRK_4_35 candidate is "${mrk435Candidate || '[missing]'}"; expected exactly "Let us cross over to the landing place."`);
    }

    return errors;
}

function buildSummary(rows, originalManualCount, validationErrors) {
    return {
        manualRowsBefore: originalManualCount,
        promotedToAutoSafe: rows.filter(row => row.proposedAction === 'promote_to_auto_safe').length,
        promotedToReviewRequired: rows.filter(row => row.proposedAction === 'promote_to_review_required').length,
        stillManualRequired: rows.filter(row => row.proposedAction === 'stay_manual_required').length,
        validationPassed: validationErrors.length === 0
    };
}

function toCsv(rows) {
    const headers = [
        'verseId',
        'reference',
        'rawLamsa',
        'oldAction',
        'proposedCandidateSpeechTextLAMSA',
        'proposedAction',
        'reason',
        'auditFlags',
        'confidence'
    ];
    return `${[headers].concat(rows.map(row => headers.map(header => (
        Array.isArray(row[header]) ? row[header].join('; ') : row[header] ?? ''
    )))).map(row => row.map(csvValue).join(',')).join('\n')}\n`;
}

function csvValue(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function printSummary(summary, remainingManualRequiredVerseIds) {
    console.log('LAMSA manual candidate reduction preview complete.');
    console.log(`Manual rows before: ${summary.manualRowsBefore}`);
    console.log(`Manual rows promoted to auto-safe: ${summary.promotedToAutoSafe}`);
    console.log(`Manual rows promoted to review-required: ${summary.promotedToReviewRequired}`);
    console.log(`Manual rows still manual: ${summary.stillManualRequired}`);
    console.log(`Validation passed: ${summary.validationPassed}`);
    console.log(`Remaining manual_required verse IDs: ${remainingManualRequiredVerseIds.join(', ')}`);
    console.log(`JSON report saved to ${relativeToRoot(JSON_REPORT_FILE)}`);
    console.log(`CSV report saved to ${relativeToRoot(CSV_REPORT_FILE)}`);
}
