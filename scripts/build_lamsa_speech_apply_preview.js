const fs = require('fs');
const path = require('path');
const {
    getParableContextForVerseId,
    isParableContextVerseId
} = require('./load_jesus_discourse_context');

const ROOT = path.join(__dirname, '..');
const PREVIEW_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_regeneration_preview.json');
const AUDIT_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_candidate_audit.json');
const REDUCTION_FILE = path.join(ROOT, 'dev/reports/lamsa_manual_reduction_preview.json');
const JSON_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_apply_preview.json');
const CSV_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_apply_preview.csv');

const CRUCIFIXION_SAYING_IDS = new Set(['MAT_27_46', 'MRK_15_34']);

const APPLY_CANDIDATE_BLOCKER_PATTERNS = [
    { label: 'Jesus said', regex: /\bJesus\s+said\b/i },
    { label: 'Jesus answered', regex: /\bJesus\s+answered\b/i },
    { label: 'Jesus cried out', regex: /\bJesus\s+cried\s+out\b/i },
    { label: 'he said', regex: /\bhe\s+said\b/i, allowInParable: true },
    { label: 'which means', regex: /\bwhich\s+means\b/i },
    { label: 'bracketed editorial note', regex: /\[[^\]]+\]/ },
    { label: 'few this', regex: /\bfew this\b/i },
    { label: 'dangling comma', regex: /,\s*$/ },
    { label: 'And Peter remembered', regex: /\bAnd\s+Peter\s+remembered\b/i },
    { label: 'Peter remembered', regex: /\bPeter\s+remembered\b/i },
    { label: 'And he went outside', regex: /\bAnd\s+he\s+went\s+outside\b/i },
    { label: 'wept bitterly', regex: /\bwept\s+bitterly\b/i },
    { label: 'And behold, Jesus met', regex: /\bAnd\s+behold,\s+Jesus\s+met\b/i },
    { label: 'Jesus met them', regex: /\bJesus\s+met\s+them\b/i },
    { label: 'laid hold of his feet', regex: /\blaid\s+hold\s+of\s+his\s+feet\b/i },
    { label: 'worshipped him', regex: /\bworshipped\s+him\b/i },
    { label: 'And they came up', regex: /\bAnd\s+they\s+came\s+up\b/i },
    { label: 'Jesus had said to him', regex: /\bJesus\s+had\s+said\s+to\s+him\b/i }
];

const RAW_NARRATIVE_ACTION_MARKER_PATTERN = /\b(?:Jesus\s+met|Peter\s+remembered|went\s+outside|wept\s+bitterly|laid\s+hold|worshipped|governor\s+asked|they\s+brought|was\s+healed|was\s+cleansed|followed\s+him|saw\s+their\s+faith|stood\s+before|took\s+bread|gave\s+it\s+to\s+them)\b/i;

const REQUIRED_EXACT_APPLY_CANDIDATES = {
    MAT_26_75: 'Before the cock crows, you will deny me three times.',
    MAT_28_9: 'Peace be to you.'
};

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const preview = readJson(PREVIEW_FILE);
    const audit = readJson(AUDIT_FILE);
    const reduction = readJson(REDUCTION_FILE);
    const previewRows = preview.rows || [];
    const auditById = new Map((audit.rows || []).map(row => [row.verseId, row]));
    const reductionById = new Map((reduction.rows || []).map(row => [row.verseId, row]));

    const rows = previewRows.map(previewRow => buildApplyPreviewRow({
        previewRow,
        auditRow: auditById.get(previewRow.verseId),
        reductionRow: reductionById.get(previewRow.verseId)
    }));
    const validationErrors = validate(rows, previewRows, auditById);
    const summary = buildSummary(rows, validationErrors);
    const report = {
        generatedAt: new Date().toISOString(),
        inputs: {
            preview: relativeToRoot(PREVIEW_FILE),
            audit: relativeToRoot(AUDIT_FILE),
            reduction: relativeToRoot(REDUCTION_FILE)
        },
        outputs: {
            jsonReport: relativeToRoot(JSON_REPORT_FILE),
            csvReport: relativeToRoot(CSV_REPORT_FILE)
        },
        summary,
        validationErrors,
        remainingManualRequiredVerseIds: rows
            .filter(row => row.finalAction === 'hold_manual')
            .map(row => row.verseId),
        rows
    };

    fs.mkdirSync(path.dirname(JSON_REPORT_FILE), { recursive: true });
    fs.writeFileSync(JSON_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(CSV_REPORT_FILE, toCsv(rows), 'utf8');

    printSummary(summary, report.remainingManualRequiredVerseIds);

    if (validationErrors.length > 0) {
        console.error(`LAMSA speech apply preview failed with ${validationErrors.length} validation error(s).`);
        validationErrors.forEach(error => console.error(`- ${error}`));
        process.exit(1);
    }
}

function buildApplyPreviewRow({ previewRow, auditRow, reductionRow }) {
    if (previewRow.action === 'manual_required' && reductionRow) {
        if (reductionRow.proposedAction === 'promote_to_auto_safe') {
            return buildReducerAutoRow(previewRow, auditRow, reductionRow);
        }
        if (reductionRow.proposedAction === 'promote_to_review_required') {
            return buildHoldRow({
                previewRow,
                auditRow,
                candidate: reductionRow.proposedCandidateSpeechTextLAMSA,
                sourceBucket: 'reducer_promoted_review',
                finalAction: 'hold_review',
                reason: reductionRow.reason || 'Reducer promoted this manual row to review-required, not auto-apply.',
                confidence: reductionRow.confidence
            });
        }
    }

    if (previewRow.action === 'auto_candidate_safe') {
        return buildPreviewAutoRow(previewRow, auditRow);
    }
    if (previewRow.action === 'review_required') {
        return buildHoldRow({
            previewRow,
            auditRow,
            candidate: previewRow.candidateSpeechTextLAMSA,
            sourceBucket: 'review_required',
            finalAction: 'hold_review',
            reason: previewRow.reason || 'Preview row requires review.',
            confidence: previewRow.confidence
        });
    }

    return buildHoldRow({
        previewRow,
        auditRow,
        candidate: previewRow.candidateSpeechTextLAMSA,
        sourceBucket: 'manual_required',
        finalAction: 'hold_manual',
        reason: previewRow.reason || reductionRow?.reason || 'Manual extraction required.',
        confidence: previewRow.confidence
    });
}

function buildPreviewAutoRow(previewRow, auditRow) {
    const auditFlags = auditRow?.flags || [];
    const auditClean = auditRow
        && auditRow.severity === 'info'
        && auditRow.recommendedAction === 'keep_auto_safe'
        && auditFlags.length === 0;
    const autoExclusions = getAutoApplyExclusions(previewRow, previewRow.candidateSpeechTextLAMSA, auditFlags);

    if (auditClean && autoExclusions.length === 0) {
        return buildHoldRow({
            previewRow,
            auditRow,
            candidate: previewRow.candidateSpeechTextLAMSA,
            sourceBucket: 'preview_auto_safe',
            finalAction: 'apply_auto',
            reason: 'Preview auto-safe row passed audit and apply-preview exclusions.',
            confidence: previewRow.confidence
        });
    }

    const reasonParts = [
        auditRow ? null : 'Missing audit row.',
        auditRow && !auditClean ? `Audit did not keep this row auto-safe: severity=${auditRow.severity}; recommendedAction=${auditRow.recommendedAction}; flags=${auditFlags.join('; ') || 'none'}.` : null,
        ...autoExclusions
    ].filter(Boolean);

    return buildHoldRow({
        previewRow,
        auditRow,
        candidate: previewRow.candidateSpeechTextLAMSA,
        sourceBucket: 'audit_downgraded_review',
        finalAction: 'hold_review',
        reason: reasonParts.join(' '),
        confidence: previewRow.confidence
    });
}

function buildReducerAutoRow(previewRow, auditRow, reductionRow) {
    const candidate = reductionRow.proposedCandidateSpeechTextLAMSA;
    const auditFlags = auditRow?.flags || [];
    const candidateBlockers = getCandidateBlockerFlags(candidate, previewRow.verseId);
    const autoExclusions = getAutoApplyExclusions(previewRow, candidate, auditFlags);

    if (candidateBlockers.length === 0 && autoExclusions.length === 0) {
        return buildHoldRow({
            previewRow,
            auditRow,
            candidate,
            sourceBucket: 'reducer_promoted_auto_safe',
            finalAction: 'apply_auto',
            reason: reductionRow.reason || 'Reducer promoted this manual row to auto-safe.',
            auditFlags,
            confidence: reductionRow.confidence
        });
    }

    return buildHoldRow({
        previewRow,
        auditRow,
        candidate,
        sourceBucket: 'audit_downgraded_review',
        finalAction: 'hold_review',
        reason: [
            'Reducer proposed auto-safe, but apply-preview guards held it for review.',
            candidateBlockers.length > 0 ? `Candidate blockers: ${candidateBlockers.join('; ')}.` : null,
            ...autoExclusions
        ].filter(Boolean).join(' '),
        auditFlags: auditFlags.concat(candidateBlockers.map(flag => `proposed_blocker: ${flag}`)),
        confidence: reductionRow.confidence
    });
}

function buildHoldRow({
    previewRow,
    auditRow,
    candidate,
    sourceBucket,
    finalAction,
    reason,
    auditFlags,
    confidence
}) {
    const discourse = getParableContextForVerseId(previewRow.verseId);
    return {
        verseId: previewRow.verseId,
        reference: previewRow.reference,
        rawLamsa: previewRow.rawLamsa,
        candidateSpeechTextLAMSA: candidate || null,
        sourceBucket,
        finalAction,
        reason,
        auditFlags: auditFlags || auditRow?.flags || [],
        confidence: confidence || previewRow.confidence,
        parableContext: Boolean(discourse || auditRow?.parableContext),
        discourseTitle: discourse?.title || auditRow?.discourseTitle || null
    };
}

function getAutoApplyExclusions(previewRow, candidate, auditFlags) {
    const exclusions = [];
    if (previewRow.bracketNotePresent) exclusions.push('Bracket-note row is excluded from auto-apply.');
    if (previewRow.narrationGlossRisk) exclusions.push('Narration/gloss risk row is excluded from auto-apply.');
    if (isCrucifixionSaying(previewRow)) exclusions.push('Crucifixion saying is excluded from auto-apply.');
    if (!candidate) exclusions.push('Candidate speech text is missing.');
    if ((auditFlags || []).some(flag => /dangling comma/i.test(flag))) {
        exclusions.push('Audit flagged a dangling comma.');
    }
    if (candidate === previewRow.rawLamsa && RAW_NARRATIVE_ACTION_MARKER_PATTERN.test(previewRow.rawLamsa || '')) {
        exclusions.push('Candidate is identical to raw LAMSA while raw contains narrative action markers.');
    }
    if (Object.prototype.hasOwnProperty.call(REQUIRED_EXACT_APPLY_CANDIDATES, previewRow.verseId)
        && candidate !== REQUIRED_EXACT_APPLY_CANDIDATES[previewRow.verseId]) {
        exclusions.push(`Special candidate must exactly equal "${REQUIRED_EXACT_APPLY_CANDIDATES[previewRow.verseId]}".`);
    }
    return exclusions;
}

function getCandidateBlockerFlags(candidate, verseId) {
    const parableContext = isParableContextVerseId(verseId);
    return APPLY_CANDIDATE_BLOCKER_PATTERNS
        .filter(pattern => !(parableContext && pattern.allowInParable))
        .filter(pattern => pattern.regex.test(candidate || ''))
        .map(pattern => pattern.label);
}

function isCrucifixionSaying(row) {
    return CRUCIFIXION_SAYING_IDS.has(row.verseId)
        || /\b(?:ninth\s+hour|crucif|Golgotha)\b/i.test(row.rawLamsa || '')
        || /\bcross\b(?!\s+over\b)/i.test(row.rawLamsa || '');
}

function validate(rows, previewRows, auditById) {
    const errors = [];
    const rowsById = new Map(rows.map(row => [row.verseId, row]));
    const previewById = new Map(previewRows.map(row => [row.verseId, row]));

    if (rows.length !== previewRows.length) {
        errors.push(`Apply preview row count is ${rows.length}, expected ${previewRows.length}`);
    }
    if (rowsById.size !== rows.length) {
        errors.push('Apply preview contains duplicate verse IDs');
    }

    for (const row of rows.filter(item => item.finalAction === 'apply_auto')) {
        const previewRow = previewById.get(row.verseId);
        const auditRow = auditById.get(row.verseId);
        if (auditRow && (auditRow.severity === 'review' || auditRow.severity === 'blocker')) {
            errors.push(`${row.verseId} apply_auto row has audit severity ${auditRow.severity}`);
        }
        if (previewRow?.bracketNotePresent) {
            errors.push(`${row.verseId} apply_auto row has bracketNotePresent true`);
        }
        if (previewRow?.narrationGlossRisk) {
            errors.push(`${row.verseId} apply_auto row has narrationGlossRisk true`);
        }
        if (!row.candidateSpeechTextLAMSA) {
            errors.push(`${row.verseId} apply_auto row has null candidateSpeechTextLAMSA`);
        }
        if (row.candidateSpeechTextLAMSA === previewRow?.rawLamsa && RAW_NARRATIVE_ACTION_MARKER_PATTERN.test(previewRow?.rawLamsa || '')) {
            errors.push(`${row.verseId} apply_auto candidate is identical to raw LAMSA despite narrative action markers`);
        }
        const candidateBlockers = getCandidateBlockerFlags(row.candidateSpeechTextLAMSA, row.verseId);
        if (candidateBlockers.length > 0) {
            errors.push(`${row.verseId} apply_auto candidate contains forbidden pattern(s): ${candidateBlockers.join('; ')}`);
        }
    }

    validateSpecialAction(rowsById, errors, 'MAT_13_28', 'hold_review');
    validateSpecialAction(rowsById, errors, 'MRK_15_34', 'hold_review');
    validateSpecialAction(rowsById, errors, 'MAT_27_46', 'hold_review');
    validateSpecialAction(rowsById, errors, 'MRK_4_35', 'apply_auto');

    const mrk435 = rowsById.get('MRK_4_35');
    if (mrk435?.candidateSpeechTextLAMSA !== 'Let us cross over to the landing place.') {
        errors.push(`MRK_4_35 candidate is "${mrk435?.candidateSpeechTextLAMSA || '[missing]'}"; expected exactly "Let us cross over to the landing place."`);
    }

    for (const [verseId, expectedCandidate] of Object.entries(REQUIRED_EXACT_APPLY_CANDIDATES)) {
        const row = rowsById.get(verseId);
        if (!row) {
            errors.push(`${verseId} is missing from the apply preview`);
            continue;
        }
        if (row.candidateSpeechTextLAMSA !== expectedCandidate) {
            errors.push(`${verseId} candidate is "${row.candidateSpeechTextLAMSA || '[missing]'}"; expected exactly "${expectedCandidate}"`);
        }
        if (row.finalAction === 'apply_auto' && row.candidateSpeechTextLAMSA !== expectedCandidate) {
            errors.push(`${verseId} may be apply_auto only when the candidate exactly equals "${expectedCandidate}"`);
        }
    }

    return errors;
}

function validateSpecialAction(rowsById, errors, verseId, expectedAction) {
    const row = rowsById.get(verseId);
    if (!row) {
        errors.push(`${verseId} is missing from the apply preview`);
        return;
    }
    if (row.finalAction !== expectedAction) {
        errors.push(`${verseId} finalAction is ${row.finalAction}; expected ${expectedAction}`);
    }
}

function buildSummary(rows, validationErrors) {
    return {
        totalRowsConsidered: rows.length,
        applyAutoCount: rows.filter(row => row.finalAction === 'apply_auto').length,
        holdReviewCount: rows.filter(row => row.finalAction === 'hold_review').length,
        holdManualCount: rows.filter(row => row.finalAction === 'hold_manual').length,
        auditDowngradedReviewCount: rows.filter(row => row.sourceBucket === 'audit_downgraded_review').length,
        reducerPromotedAutoSafeIncludedCount: rows.filter(row => row.sourceBucket === 'reducer_promoted_auto_safe' && row.finalAction === 'apply_auto').length,
        validationPassed: validationErrors.length === 0
    };
}

function toCsv(rows) {
    const headers = [
        'verseId',
        'reference',
        'rawLamsa',
        'candidateSpeechTextLAMSA',
        'sourceBucket',
        'finalAction',
        'reason',
        'auditFlags',
        'confidence',
        'parableContext',
        'discourseTitle'
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
    console.log('LAMSA speech apply preview complete.');
    console.log(`Total rows considered: ${summary.totalRowsConsidered}`);
    console.log(`apply_auto: ${summary.applyAutoCount}`);
    console.log(`hold_review: ${summary.holdReviewCount}`);
    console.log(`hold_manual: ${summary.holdManualCount}`);
    console.log(`audit-downgraded review: ${summary.auditDowngradedReviewCount}`);
    console.log(`Reducer promoted auto-safe included: ${summary.reducerPromotedAutoSafeIncludedCount}`);
    console.log(`Remaining manual_required verse IDs: ${remainingManualRequiredVerseIds.join(', ')}`);
    console.log(`Validation passed: ${summary.validationPassed}`);
    console.log(`JSON report saved to ${relativeToRoot(JSON_REPORT_FILE)}`);
    console.log(`CSV report saved to ${relativeToRoot(CSV_REPORT_FILE)}`);
}
