const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APPLY_PREVIEW_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_apply_preview.json');
const AUTO_APPLY_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_speechtext_auto_apply_report.json');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const CSV_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_held_speech_review_sheet.csv');
const JSON_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_held_speech_review_sheet.json');

const EXPECTED_HOLD_REVIEW_COUNT = 106;
const EXPECTED_HOLD_MANUAL_COUNT = 14;
const EXPECTED_TOTAL_HELD_COUNT = 120;

const COLUMNS = [
    'verseId',
    'reference',
    'finalAction',
    'sourceBucket',
    'rawLamsa',
    'candidateSpeechTextLAMSA',
    'currentSpeechTextLAMSA',
    'reason',
    'auditFlags',
    'confidence',
    'parableContext',
    'discourseTitle',
    'suggestedReviewNote',
    'approvedSpeechTextLAMSA',
    'reviewerDecision'
];

const REQUIRED_HELD_IDS = ['MRK_15_34', 'MAT_27_46', 'MAT_13_28'];
const CRUCIFIXION_IDS = new Set(['MAT_27_46', 'MRK_15_34']);

const REVIEW_NOTES = {
    bracketGloss: 'Review bracket/gloss note. Preserve only Jesus speech; remove editorial explanation if not part of spoken text.',
    parable: 'Parable context. Preserve internal parable dialogue because Jesus is narrating the story.',
    crucifixion: 'High-impact crucifixion saying. Manually verify exact Jesus-only speech.',
    manual: 'Manual boundary required. Extract only Jesus speech; remove Gospel narration and external speaker replies.',
    danglingComma: 'Verse appears to continue into next verse. Verify whether isolated verse text should remain as-is.'
};

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const applyPreview = readJson(APPLY_PREVIEW_FILE);
    const autoApplyReport = readJson(AUTO_APPLY_REPORT_FILE);
    const dataset = readJson(DATASET_FILE);
    const heldRows = (applyPreview.rows || [])
        .filter(row => row.finalAction === 'hold_review' || row.finalAction === 'hold_manual')
        .map(row => buildReviewRow(row, dataset));

    const summary = buildSummary(heldRows);
    const validationErrors = validate({
        rows: heldRows,
        applyPreview,
        autoApplyReport
    });

    const report = {
        generatedAt: new Date().toISOString(),
        inputs: {
            applyPreview: relativeToRoot(APPLY_PREVIEW_FILE),
            autoApplyReport: relativeToRoot(AUTO_APPLY_REPORT_FILE),
            dataset: relativeToRoot(DATASET_FILE)
        },
        outputs: {
            csv: relativeToRoot(CSV_REPORT_FILE),
            json: relativeToRoot(JSON_REPORT_FILE)
        },
        summary: {
            ...summary,
            validationPassed: validationErrors.length === 0
        },
        validationErrors,
        rows: heldRows
    };

    fs.mkdirSync(path.dirname(CSV_REPORT_FILE), { recursive: true });
    fs.writeFileSync(CSV_REPORT_FILE, `\uFEFF${toCsv(heldRows)}\n`, 'utf8');
    fs.writeFileSync(JSON_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    printSummary(report.summary);

    if (validationErrors.length > 0) {
        console.error(`LAMSA held speech review sheet failed with ${validationErrors.length} validation error(s).`);
        validationErrors.forEach(error => console.error(`- ${error}`));
        process.exit(1);
    }
}

function buildReviewRow(row, dataset) {
    const auditFlags = Array.isArray(row.auditFlags) ? row.auditFlags.map(String) : [];
    const currentSpeechTextLAMSA = getCurrentLamsaSpeechText(dataset[row.verseId]);

    return {
        verseId: row.verseId,
        reference: row.reference,
        finalAction: row.finalAction,
        sourceBucket: row.sourceBucket,
        rawLamsa: row.rawLamsa,
        candidateSpeechTextLAMSA: row.candidateSpeechTextLAMSA || '',
        currentSpeechTextLAMSA,
        reason: row.reason || '',
        auditFlags,
        confidence: row.confidence || '',
        parableContext: Boolean(row.parableContext),
        discourseTitle: row.discourseTitle || '',
        suggestedReviewNote: buildSuggestedReviewNote(row, auditFlags),
        approvedSpeechTextLAMSA: '',
        reviewerDecision: ''
    };
}

function buildSuggestedReviewNote(row, auditFlags) {
    const notes = [];
    if (isBracketGlossRow(row, auditFlags)) notes.push(REVIEW_NOTES.bracketGloss);
    if (row.parableContext) notes.push(REVIEW_NOTES.parable);
    if (isCrucifixionRow(row)) notes.push(REVIEW_NOTES.crucifixion);
    if (row.finalAction === 'hold_manual') notes.push(REVIEW_NOTES.manual);
    if (hasDanglingCommaFlag(auditFlags)) notes.push(REVIEW_NOTES.danglingComma);
    return notes.join(' ');
}

function isBracketGlossRow(row, auditFlags) {
    return auditFlags.some(flag => /gloss|editorial|bracket/i.test(flag))
        || /\b(?:bracket|gloss|parenthetical|which means|meaning|that is to say)\b/i.test(row.reason || '')
        || /\[[^\]]+\]/.test(row.rawLamsa || '')
        || /\b(?:which means|meaning|that is to say)\b/i.test(row.rawLamsa || '');
}

function isCrucifixionRow(row) {
    return CRUCIFIXION_IDS.has(row.verseId)
        || /\b(?:ninth\s+hour|crucif|Golgotha)\b/i.test(row.rawLamsa || '')
        || /\bcross\b(?!\s+over\b)/i.test(row.rawLamsa || '');
}

function hasDanglingCommaFlag(auditFlags) {
    return auditFlags.some(flag => /dangling comma/i.test(flag));
}

function buildSummary(rows) {
    return {
        totalHeldRows: rows.length,
        holdReviewCount: rows.filter(row => row.finalAction === 'hold_review').length,
        holdManualCount: rows.filter(row => row.finalAction === 'hold_manual').length,
        bracketGlossRowCount: rows.filter(row => isBracketGlossRow(row, row.auditFlags)).length,
        parableRowCount: rows.filter(row => row.parableContext).length,
        crucifixionRowCount: rows.filter(isCrucifixionRow).length,
        manualBoundaryRowCount: rows.filter(row => row.finalAction === 'hold_manual').length
    };
}

function validate({ rows, applyPreview, autoApplyReport }) {
    const errors = [];
    const byId = new Map(rows.map(row => [row.verseId, row]));
    const holdReviewCount = rows.filter(row => row.finalAction === 'hold_review').length;
    const holdManualCount = rows.filter(row => row.finalAction === 'hold_manual').length;

    if (rows.length !== EXPECTED_TOTAL_HELD_COUNT) {
        errors.push(`Total held row count is ${rows.length}, expected ${EXPECTED_TOTAL_HELD_COUNT}`);
    }
    if (holdReviewCount !== EXPECTED_HOLD_REVIEW_COUNT) {
        errors.push(`hold_review count is ${holdReviewCount}, expected ${EXPECTED_HOLD_REVIEW_COUNT}`);
    }
    if (holdManualCount !== EXPECTED_HOLD_MANUAL_COUNT) {
        errors.push(`hold_manual count is ${holdManualCount}, expected ${EXPECTED_HOLD_MANUAL_COUNT}`);
    }
    if (rows.some(row => row.finalAction === 'apply_auto')) {
        errors.push('Sheet includes an apply_auto row');
    }
    for (const verseId of REQUIRED_HELD_IDS) {
        if (!byId.has(verseId)) {
            errors.push(`${verseId} is missing from the held review sheet`);
        }
    }
    if (applyPreview.summary?.holdReviewCount !== EXPECTED_HOLD_REVIEW_COUNT) {
        errors.push(`Apply preview holdReviewCount is ${applyPreview.summary?.holdReviewCount}, expected ${EXPECTED_HOLD_REVIEW_COUNT}`);
    }
    if (applyPreview.summary?.holdManualCount !== EXPECTED_HOLD_MANUAL_COUNT) {
        errors.push(`Apply preview holdManualCount is ${applyPreview.summary?.holdManualCount}, expected ${EXPECTED_HOLD_MANUAL_COUNT}`);
    }
    if (autoApplyReport.validationPassed !== true) {
        errors.push('LAMSA speechText auto apply report validationPassed is not true');
    }

    const currentSpeechRows = rows.filter(row => row.currentSpeechTextLAMSA.trim().length > 0);
    if (currentSpeechRows.length > 0 && autoApplyReport.validationPassed !== true) {
        errors.push(`Held rows have current LAMSA speechText, and prior auto-apply validation is not available: ${currentSpeechRows.map(row => row.verseId).join(', ')}`);
    }

    return errors;
}

function getCurrentLamsaSpeechText(record) {
    if (typeof record?.speechText?.LAMSA === 'string') return record.speechText.LAMSA;
    if (typeof record?.currentSpeechText?.LAMSA === 'string') return record.currentSpeechText.LAMSA;
    return '';
}

function toCsv(rows) {
    const csvRows = [COLUMNS];
    for (const row of rows) {
        csvRows.push(COLUMNS.map(column => {
            const value = row[column];
            return Array.isArray(value) ? value.join('; ') : value ?? '';
        }));
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

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function printSummary(summary) {
    console.log('LAMSA held speech review sheet created.');
    console.log(`Total held rows: ${summary.totalHeldRows}`);
    console.log(`hold_review: ${summary.holdReviewCount}`);
    console.log(`hold_manual: ${summary.holdManualCount}`);
    console.log(`Bracket/gloss rows: ${summary.bracketGlossRowCount}`);
    console.log(`Parable rows: ${summary.parableRowCount}`);
    console.log(`Crucifixion rows: ${summary.crucifixionRowCount}`);
    console.log(`Manual boundary rows: ${summary.manualBoundaryRowCount}`);
    console.log(`CSV report saved to ${relativeToRoot(CSV_REPORT_FILE)}`);
    console.log(`JSON report saved to ${relativeToRoot(JSON_REPORT_FILE)}`);
}
