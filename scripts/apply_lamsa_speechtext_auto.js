const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const APPLY_PREVIEW_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_apply_preview.json');
const REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_speechtext_auto_apply_report.json');
const BACKUP_FILE = path.join(ROOT, 'dev/backups/jesus_verses_final.before_lamsa_speechtext_auto_apply.json');

const EXPECTED_APPLY_AUTO_COUNT = 185;
const EXPECTED_HOLD_REVIEW_COUNT = 106;
const EXPECTED_HOLD_MANUAL_COUNT = 14;

const FORBIDDEN_APPLY_CANDIDATE_PATTERN = /\b(?:Jesus\s+said|Jesus\s+answered|Jesus\s+cried\s+out|he\s+said|which\s+means|few\s+this|Peter\s+remembered|wept\s+bitterly|Jesus\s+met\s+them|worshipped\s+him|they\s+brought|was\s+healed|was\s+cleansed|followed\s+him|saw\s+their\s+faith|took\s+bread|gave\s+it\s+to\s+them)\b/i;
const FORBIDDEN_FINAL_SPEECH_PATTERN = /\b(?:few\s+this|which\s+means|Jesus\s+said|Jesus\s+answered|he\s+said|Peter\s+remembered|wept\s+bitterly|worshipped\s+him)\b/i;

const SPECIAL_CHECK_IDS = [
    'MRK_15_34',
    'MAT_27_46',
    'MAT_13_28',
    'MRK_4_35',
    'MAT_26_75',
    'MAT_28_9'
];

const REQUIRED_APPLIED_SPEECH = {
    MRK_4_35: 'Let us cross over to the landing place.',
    MAT_26_75: 'Before the cock crows, you will deny me three times.',
    MAT_28_9: 'Peace be to you.'
};

const REQUIRED_NOT_APPLIED = new Set([
    'MRK_15_34',
    'MAT_27_46',
    'MAT_13_28'
]);

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const datasetBefore = readJson(DATASET_FILE);
    const preview = readJson(APPLY_PREVIEW_FILE);
    const previewRows = preview.rows || [];
    const rowsById = new Map(previewRows.map(row => [row.verseId, row]));
    const applyRows = previewRows.filter(row => row.finalAction === 'apply_auto');
    const holdReviewRows = previewRows.filter(row => row.finalAction === 'hold_review');
    const holdManualRows = previewRows.filter(row => row.finalAction === 'hold_manual');
    const conflicts = [];
    const validationErrors = [];

    validateBeforeWrite({
        preview,
        previewRows,
        applyRows,
        holdReviewRows,
        holdManualRows,
        datasetBefore,
        conflicts,
        validationErrors
    });

    if (validationErrors.length > 0 || conflicts.length > 0) {
        writeReport({
            appliedCount: 0,
            skippedReviewCount: holdReviewRows.length,
            skippedManualCount: holdManualRows.length,
            conflicts,
            backupPath: null,
            specialChecks: buildSpecialChecks(rowsById, datasetBefore, datasetBefore),
            validationErrors,
            validationPassed: false
        });
        failWithValidationErrors('LAMSA speechText auto apply failed before write', validationErrors, conflicts);
    }

    fs.mkdirSync(path.dirname(BACKUP_FILE), { recursive: true });
    if (fs.existsSync(BACKUP_FILE)) {
        validationErrors.push(`${relativeToRoot(BACKUP_FILE)} already exists; refusing to overwrite backup`);
        writeReport({
            appliedCount: 0,
            skippedReviewCount: holdReviewRows.length,
            skippedManualCount: holdManualRows.length,
            conflicts,
            backupPath: relativeToRoot(BACKUP_FILE),
            specialChecks: buildSpecialChecks(rowsById, datasetBefore, datasetBefore),
            validationErrors,
            validationPassed: false
        });
        failWithValidationErrors('LAMSA speechText auto apply failed before write', validationErrors, conflicts);
    }
    fs.copyFileSync(DATASET_FILE, BACKUP_FILE);

    const datasetAfter = deepClone(datasetBefore);
    let appliedCount = 0;

    for (const row of applyRows) {
        const record = datasetAfter[row.verseId];
        if (!record.speechText || typeof record.speechText !== 'object' || Array.isArray(record.speechText)) {
            record.speechText = {};
        }
        const beforeValue = getLamsaSpeechText(datasetBefore[row.verseId]);
        if (isNonEmptyString(beforeValue)) continue;
        record.speechText.LAMSA = row.candidateSpeechTextLAMSA;
        appliedCount += 1;
    }

    fs.writeFileSync(DATASET_FILE, `${JSON.stringify(datasetAfter, null, 2)}\n`, 'utf8');

    const persistedDataset = readJson(DATASET_FILE);
    validateAfterWrite({
        datasetBefore,
        datasetAfter: persistedDataset,
        rowsById,
        applyRows,
        holdReviewRows,
        holdManualRows,
        appliedCount,
        validationErrors
    });

    const validationPassed = validationErrors.length === 0;
    writeReport({
        appliedCount,
        skippedReviewCount: holdReviewRows.length,
        skippedManualCount: holdManualRows.length,
        conflicts,
        backupPath: relativeToRoot(BACKUP_FILE),
        specialChecks: buildSpecialChecks(rowsById, datasetBefore, persistedDataset),
        validationErrors,
        validationPassed
    });

    printSummary({
        appliedCount,
        skippedReviewCount: holdReviewRows.length,
        skippedManualCount: holdManualRows.length,
        conflicts,
        validationPassed
    });

    if (!validationPassed) {
        failWithValidationErrors('LAMSA speechText auto apply failed after write', validationErrors, conflicts);
    }
}

function validateBeforeWrite({
    preview,
    previewRows,
    applyRows,
    holdReviewRows,
    holdManualRows,
    datasetBefore,
    conflicts,
    validationErrors
}) {
    if (preview.summary?.validationPassed !== true) {
        validationErrors.push('Apply preview validationPassed is not true');
    }
    if (preview.summary?.applyAutoCount !== EXPECTED_APPLY_AUTO_COUNT || applyRows.length !== EXPECTED_APPLY_AUTO_COUNT) {
        validationErrors.push(`apply_auto count is ${applyRows.length}, expected ${EXPECTED_APPLY_AUTO_COUNT}`);
    }
    if (preview.summary?.holdReviewCount !== EXPECTED_HOLD_REVIEW_COUNT || holdReviewRows.length !== EXPECTED_HOLD_REVIEW_COUNT) {
        validationErrors.push(`hold_review count is ${holdReviewRows.length}, expected ${EXPECTED_HOLD_REVIEW_COUNT}`);
    }
    if (preview.summary?.holdManualCount !== EXPECTED_HOLD_MANUAL_COUNT || holdManualRows.length !== EXPECTED_HOLD_MANUAL_COUNT) {
        validationErrors.push(`hold_manual count is ${holdManualRows.length}, expected ${EXPECTED_HOLD_MANUAL_COUNT}`);
    }
    if (new Set(previewRows.map(row => row.verseId)).size !== previewRows.length) {
        validationErrors.push('Apply preview contains duplicate verse IDs');
    }

    for (const row of applyRows) {
        if (!row.candidateSpeechTextLAMSA) {
            validationErrors.push(`${row.verseId} apply_auto row has null candidateSpeechTextLAMSA`);
        }
        if (FORBIDDEN_APPLY_CANDIDATE_PATTERN.test(row.candidateSpeechTextLAMSA || '')) {
            validationErrors.push(`${row.verseId} apply_auto candidate contains forbidden text`);
        }
        const record = datasetBefore[row.verseId];
        if (!record) {
            validationErrors.push(`${row.verseId} is missing from dataset`);
            continue;
        }
        const existingSpeech = getLamsaSpeechText(record);
        if (isNonEmptyString(existingSpeech) && existingSpeech !== row.candidateSpeechTextLAMSA) {
            conflicts.push({
                verseId: row.verseId,
                reference: row.reference,
                existingSpeechTextLAMSA: existingSpeech,
                candidateSpeechTextLAMSA: row.candidateSpeechTextLAMSA
            });
        }
    }
}

function validateAfterWrite({
    datasetBefore,
    datasetAfter,
    rowsById,
    applyRows,
    holdReviewRows,
    holdManualRows,
    appliedCount,
    validationErrors
}) {
    if (appliedCount !== EXPECTED_APPLY_AUTO_COUNT) {
        validationErrors.push(`Applied ${appliedCount} LAMSA speechText values, expected ${EXPECTED_APPLY_AUTO_COUNT}`);
    }

    for (const verseId of new Set([...Object.keys(datasetBefore), ...Object.keys(datasetAfter)])) {
        const before = datasetBefore[verseId];
        const after = datasetAfter[verseId];
        if (!deepEqual(before?.translations?.LAMSA, after?.translations?.LAMSA)) {
            validationErrors.push(`${verseId} translations.LAMSA changed`);
        }
        if (!deepEqual(before?.translations?.DBH, after?.translations?.DBH)) {
            validationErrors.push(`${verseId} translations.DBH changed`);
        }
        if (!deepEqual(before?.translations?.NRSVUE, after?.translations?.NRSVUE)) {
            validationErrors.push(`${verseId} translations.NRSVUE changed`);
        }
        if (!deepEqual(before?.speechText?.DBH, after?.speechText?.DBH)) {
            validationErrors.push(`${verseId} speechText.DBH changed`);
        }
        if (!deepEqual(before?.speechText?.NRSVUE, after?.speechText?.NRSVUE)) {
            validationErrors.push(`${verseId} speechText.NRSVUE changed`);
        }
    }

    for (const row of holdReviewRows) {
        if (!deepEqual(datasetBefore[row.verseId], datasetAfter[row.verseId])) {
            validationErrors.push(`${row.verseId} hold_review row was modified`);
        }
    }
    for (const row of holdManualRows) {
        if (!deepEqual(datasetBefore[row.verseId], datasetAfter[row.verseId])) {
            validationErrors.push(`${row.verseId} hold_manual row was modified`);
        }
    }

    for (const verseId of REQUIRED_NOT_APPLIED) {
        const beforeSpeech = getLamsaSpeechText(datasetBefore[verseId]);
        const afterSpeech = getLamsaSpeechText(datasetAfter[verseId]);
        if (!deepEqual(beforeSpeech, afterSpeech)) {
            validationErrors.push(`${verseId} was applied automatically but should have been held`);
        }
        if (rowsById.get(verseId)?.finalAction === 'apply_auto') {
            validationErrors.push(`${verseId} finalAction is apply_auto but should be held`);
        }
    }

    for (const [verseId, expectedSpeech] of Object.entries(REQUIRED_APPLIED_SPEECH)) {
        const actual = getLamsaSpeechText(datasetAfter[verseId]);
        if (actual !== expectedSpeech) {
            validationErrors.push(`${verseId} speechText.LAMSA is "${actual || '[missing]'}"; expected "${expectedSpeech}"`);
        }
    }

    const applyIds = new Set(applyRows.map(row => row.verseId));
    for (const [verseId, record] of Object.entries(datasetAfter)) {
        const speech = getLamsaSpeechText(record);
        if (isNonEmptyString(speech) && FORBIDDEN_FINAL_SPEECH_PATTERN.test(speech)) {
            validationErrors.push(`${verseId} LAMSA speechText contains forbidden text`);
        }
        const beforeSpeech = getLamsaSpeechText(datasetBefore[verseId]);
        if (!applyIds.has(verseId) && !deepEqual(beforeSpeech, speech)) {
            validationErrors.push(`${verseId} non-apply row speechText.LAMSA changed`);
        }
    }
}

function buildSpecialChecks(rowsById, datasetBefore, datasetAfter) {
    return Object.fromEntries(SPECIAL_CHECK_IDS.map(verseId => {
        const row = rowsById.get(verseId) || null;
        return [verseId, {
            finalAction: row?.finalAction || null,
            candidateSpeechTextLAMSA: row?.candidateSpeechTextLAMSA || null,
            beforeSpeechTextLAMSA: getLamsaSpeechText(datasetBefore[verseId]),
            afterSpeechTextLAMSA: getLamsaSpeechText(datasetAfter[verseId]),
            expectedAppliedSpeechTextLAMSA: REQUIRED_APPLIED_SPEECH[verseId] || null,
            expectedHeld: REQUIRED_NOT_APPLIED.has(verseId)
        }];
    }));
}

function writeReport({
    appliedCount,
    skippedReviewCount,
    skippedManualCount,
    conflicts,
    backupPath,
    specialChecks,
    validationErrors,
    validationPassed
}) {
    const report = {
        generatedAt: new Date().toISOString(),
        inputs: {
            dataset: relativeToRoot(DATASET_FILE),
            applyPreview: relativeToRoot(APPLY_PREVIEW_FILE)
        },
        outputs: {
            dataset: relativeToRoot(DATASET_FILE),
            report: relativeToRoot(REPORT_FILE),
            backup: backupPath
        },
        appliedCount,
        skippedReviewCount,
        skippedManualCount,
        conflicts,
        backupPath,
        specialChecks,
        validationErrors,
        validationPassed
    };

    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function getLamsaSpeechText(record) {
    if (typeof record?.speechText?.LAMSA === 'string') return record.speechText.LAMSA;
    return null;
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function failWithValidationErrors(message, validationErrors, conflicts) {
    console.error(message);
    for (const error of validationErrors) {
        console.error(`- ${error}`);
    }
    for (const conflict of conflicts) {
        console.error(`- Conflict ${conflict.verseId}: existing LAMSA speechText differs from candidate`);
    }
    process.exit(1);
}

function printSummary({
    appliedCount,
    skippedReviewCount,
    skippedManualCount,
    conflicts,
    validationPassed
}) {
    console.log('LAMSA speechText auto apply complete.');
    console.log(`Applied LAMSA speechText values: ${appliedCount}`);
    console.log(`Skipped hold_review rows: ${skippedReviewCount}`);
    console.log(`Skipped hold_manual rows: ${skippedManualCount}`);
    console.log(`Conflicts: ${conflicts.length}`);
    console.log(`Backup saved to ${relativeToRoot(BACKUP_FILE)}`);
    console.log(`Validation passed: ${validationPassed}`);
    console.log(`Report saved to ${relativeToRoot(REPORT_FILE)}`);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}
