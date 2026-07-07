const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const REVIEW_CSV_FILE = path.join(ROOT, 'dev/reports/lamsa_held_speech_review_sheet_reviewed.csv');
const DRY_RUN_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_held_apply_dry_run.json');
const SUMMARY_CSV_FILE = path.join(ROOT, 'dev/reports/lamsa_held_apply_summary.csv');

const VALID_DECISIONS = new Set([
    'approved_use_candidate',
    'approved',
    'edited',
    'reject',
    'defer_revelation_scope',
    'defer_to_rev'
]);
const APPLY_DECISIONS = new Set(['approved_use_candidate', 'approved', 'edited']);
const SKIP_DEFER_DECISIONS = new Set(['defer_revelation_scope', 'defer_to_rev']);
const GLOSS_PATTERN = /\b(?:Ancient text were not punctuated|Enemies desecrated|Dan\.\s*11:31|Aramaic idiom|Synonym:)\b/i;
const BRACKETED_NOTE_PATTERN = /\[[^\]]+\]/;
const SUMMARY_COLUMNS = ['metric', 'value'];
const BEFORE_AFTER_EXAMPLE_LIMIT = 50;

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const beforeDataset = readJson(DATASET_FILE);
    const reviewRows = loadCsv(REVIEW_CSV_FILE);
    const plan = buildDryRunPlan(beforeDataset, reviewRows);

    writeDryRunArtifacts(plan, {
        applied: false,
        postApplyVerification: null
    });

    if (plan.validationFailures.length > 0) {
        console.error(`LAMSA held-review apply dry-run failed with ${plan.validationFailures.length} validation failure(s).`);
        plan.validationFailures.slice(0, 50).forEach(failure => {
            console.error(`- ${failure.verseId || `row ${failure.rowNumber}`}: ${failure.reason}`);
        });
        process.exit(1);
    }

    const afterDataset = deepClone(beforeDataset);
    applyPlan(afterDataset, plan.applyRows);
    fs.writeFileSync(DATASET_FILE, `${JSON.stringify(afterDataset, null, 2)}\n`, 'utf8');

    const persistedDataset = readJson(DATASET_FILE);
    const postApplyVerification = verifyAfterApply({
        beforeDataset,
        afterDataset: persistedDataset,
        plan
    });

    writeDryRunArtifacts(plan, {
        applied: true,
        postApplyVerification
    });

    printSummary(plan, postApplyVerification);

    if (!postApplyVerification.validationPassed) {
        console.error(`LAMSA held-review apply verification failed with ${postApplyVerification.validationFailures.length} failure(s).`);
        postApplyVerification.validationFailures.slice(0, 50).forEach(failure => console.error(`- ${failure}`));
        process.exit(1);
    }
}

function buildDryRunPlan(dataset, reviewRows) {
    const countByReviewerDecision = {};
    const validationFailures = [];
    const missingVerseIds = [];
    const missingLamsaTargetVerseIds = [];
    const applyRows = [];
    const skippedRejectRows = [];
    const skippedDeferRows = [];
    const beforeAfterExamples = [];
    const seenVerseIds = new Set();

    reviewRows.forEach((row, index) => {
        const rowNumber = index + 2;
        const verseId = stringValue(row.verseId).trim();
        const reviewerDecision = normalizeDecision(row.reviewerDecision);
        const approvedSpeechTextLAMSA = stringValue(row.approvedSpeechTextLAMSA).trim();
        const candidateSpeechTextLAMSA = stringValue(row.candidateSpeechTextLAMSA).trim();
        const reference = stringValue(row.reference).trim();

        countByReviewerDecision[reviewerDecision || '(blank)'] = (countByReviewerDecision[reviewerDecision || '(blank)'] || 0) + 1;

        if (!verseId) {
            validationFailures.push({ rowNumber, verseId, reason: 'Row has blank verseId' });
            return;
        }
        if (seenVerseIds.has(verseId)) {
            validationFailures.push({ rowNumber, verseId, reason: 'Duplicate verseId in reviewed CSV' });
        }
        seenVerseIds.add(verseId);

        const record = dataset[verseId];
        if (!record) {
            missingVerseIds.push(verseId);
            validationFailures.push({ rowNumber, verseId, reason: 'Verse ID is missing from data/jesus_verses_final.json' });
        } else if (typeof record.translations?.LAMSA !== 'string' || record.translations.LAMSA.trim() === '') {
            missingLamsaTargetVerseIds.push(verseId);
            validationFailures.push({ rowNumber, verseId, reason: 'Verse has no LAMSA translation target' });
        }

        if (!reviewerDecision) {
            validationFailures.push({ rowNumber, verseId, reason: 'reviewerDecision is blank' });
            return;
        }
        if (!VALID_DECISIONS.has(reviewerDecision)) {
            validationFailures.push({ rowNumber, verseId, reason: `Unknown reviewerDecision "${row.reviewerDecision}"` });
            return;
        }

        const effectiveSpeechTextLAMSA = getEffectiveSpeechText({
            reviewerDecision,
            approvedSpeechTextLAMSA,
            candidateSpeechTextLAMSA
        });

        if (reviewerDecision === 'reject') {
            skippedRejectRows.push(buildSkippedRow(row, rowNumber, reviewerDecision));
            return;
        }
        if (SKIP_DEFER_DECISIONS.has(reviewerDecision)) {
            skippedDeferRows.push(buildSkippedRow(row, rowNumber, reviewerDecision));
            return;
        }

        validateDecisionText({
            rowNumber,
            verseId,
            reviewerDecision,
            approvedSpeechTextLAMSA,
            candidateSpeechTextLAMSA,
            effectiveSpeechTextLAMSA,
            validationFailures
        });

        if (effectiveSpeechTextLAMSA) {
            const currentSpeechTextLAMSA = getLamsaSpeechText(record);
            const applyRow = {
                rowNumber,
                verseId,
                reference,
                reviewerDecision,
                candidateSpeechTextLAMSA,
                approvedSpeechTextLAMSA,
                effectiveSpeechTextLAMSA,
                beforeSpeechTextLAMSA: currentSpeechTextLAMSA,
                afterSpeechTextLAMSA: effectiveSpeechTextLAMSA,
                beforeSpeechStatusLAMSA: getLamsaSpeechStatus(record),
                afterSpeechStatusLAMSA: 'verified'
            };
            applyRows.push(applyRow);

            if (beforeAfterExamples.length < BEFORE_AFTER_EXAMPLE_LIMIT && currentSpeechTextLAMSA !== effectiveSpeechTextLAMSA) {
                beforeAfterExamples.push({
                    verseId,
                    reference,
                    reviewerDecision,
                    beforeSpeechTextLAMSA: currentSpeechTextLAMSA,
                    afterSpeechTextLAMSA: effectiveSpeechTextLAMSA
                });
            }
        }
    });

    return {
        generatedAt: new Date().toISOString(),
        inputs: {
            dataset: relativeToRoot(DATASET_FILE),
            reviewedCsv: relativeToRoot(REVIEW_CSV_FILE)
        },
        outputs: {
            dryRunReport: relativeToRoot(DRY_RUN_REPORT_FILE),
            summaryCsv: relativeToRoot(SUMMARY_CSV_FILE)
        },
        summary: {
            totalReviewedRows: reviewRows.length,
            appliedCount: applyRows.length,
            skippedRejectCount: skippedRejectRows.length,
            skippedRevelationDeferCount: skippedDeferRows.length,
            countByReviewerDecision,
            missingVerseIds,
            missingLamsaTargetVerseIds,
            validationFailureCount: validationFailures.length
        },
        validationFailures,
        applyRows,
        skippedRejectRows,
        skippedDeferRows,
        beforeAfterExamples
    };
}

function validateDecisionText({
    rowNumber,
    verseId,
    reviewerDecision,
    approvedSpeechTextLAMSA,
    candidateSpeechTextLAMSA,
    effectiveSpeechTextLAMSA,
    validationFailures
}) {
    if (reviewerDecision === 'edited' && !approvedSpeechTextLAMSA) {
        validationFailures.push({ rowNumber, verseId, reason: 'edited row has blank approvedSpeechTextLAMSA' });
    }
    if (reviewerDecision === 'approved_use_candidate' && !candidateSpeechTextLAMSA) {
        validationFailures.push({ rowNumber, verseId, reason: 'approved_use_candidate row has blank candidateSpeechTextLAMSA' });
    }
    if (reviewerDecision === 'approved' && !approvedSpeechTextLAMSA && !candidateSpeechTextLAMSA) {
        validationFailures.push({ rowNumber, verseId, reason: 'approved row has both approvedSpeechTextLAMSA and candidateSpeechTextLAMSA blank' });
    }
    if (!effectiveSpeechTextLAMSA) return;
    if (BRACKETED_NOTE_PATTERN.test(effectiveSpeechTextLAMSA)) {
        validationFailures.push({ rowNumber, verseId, reason: 'effective applied speechText contains square-bracket editorial note' });
    }
    if (GLOSS_PATTERN.test(effectiveSpeechTextLAMSA)) {
        validationFailures.push({ rowNumber, verseId, reason: 'effective applied speechText contains Lamsa editorial/source gloss' });
    }
}

function getEffectiveSpeechText({
    reviewerDecision,
    approvedSpeechTextLAMSA,
    candidateSpeechTextLAMSA
}) {
    if (reviewerDecision === 'approved_use_candidate') return candidateSpeechTextLAMSA;
    if (reviewerDecision === 'approved') return approvedSpeechTextLAMSA || candidateSpeechTextLAMSA;
    if (reviewerDecision === 'edited') return approvedSpeechTextLAMSA;
    return '';
}

function buildSkippedRow(row, rowNumber, reviewerDecision) {
    return {
        rowNumber,
        verseId: stringValue(row.verseId).trim(),
        reference: stringValue(row.reference).trim(),
        reviewerDecision
    };
}

function applyPlan(dataset, applyRows) {
    for (const row of applyRows) {
        const record = dataset[row.verseId];
        if (!record.speechText || typeof record.speechText !== 'object' || Array.isArray(record.speechText)) {
            record.speechText = {};
        }
        if (!record.speechStatus || typeof record.speechStatus !== 'object' || Array.isArray(record.speechStatus)) {
            record.speechStatus = {};
        }
        record.speechText.LAMSA = row.effectiveSpeechTextLAMSA;
        record.speechStatus.LAMSA = 'verified';
    }
}

function verifyAfterApply({ beforeDataset, afterDataset, plan }) {
    const validationFailures = [];
    const applyIds = new Set(plan.applyRows.map(row => row.verseId));
    const rejectDeferIds = new Set([
        ...plan.skippedRejectRows.map(row => row.verseId),
        ...plan.skippedDeferRows.map(row => row.verseId)
    ]);

    for (const verseId of new Set([...Object.keys(beforeDataset), ...Object.keys(afterDataset)])) {
        const before = beforeDataset[verseId];
        const after = afterDataset[verseId];

        if (!deepEqual(before?.translations?.DBH, after?.translations?.DBH)) {
            validationFailures.push(`${verseId} translations.DBH changed`);
        }
        if (!deepEqual(before?.translations?.NRSVUE, after?.translations?.NRSVUE)) {
            validationFailures.push(`${verseId} translations.NRSVUE changed`);
        }
        if (!deepEqual(before?.translations?.LAMSA, after?.translations?.LAMSA)) {
            validationFailures.push(`${verseId} translations.LAMSA changed`);
        }
    }

    const normalizedAfter = deepClone(afterDataset);
    for (const verseId of applyIds) {
        restoreField(normalizedAfter[verseId], beforeDataset[verseId], 'speechText');
        restoreField(normalizedAfter[verseId], beforeDataset[verseId], 'speechStatus');

        if (!deepEqual(beforeDataset[verseId]?.speechText?.DBH, afterDataset[verseId]?.speechText?.DBH)) {
            validationFailures.push(`${verseId} speechText.DBH changed`);
        }
        if (!deepEqual(beforeDataset[verseId]?.speechText?.NRSVUE, afterDataset[verseId]?.speechText?.NRSVUE)) {
            validationFailures.push(`${verseId} speechText.NRSVUE changed`);
        }
        if (!deepEqual(beforeDataset[verseId]?.speechStatus?.DBH, afterDataset[verseId]?.speechStatus?.DBH)) {
            validationFailures.push(`${verseId} speechStatus.DBH changed`);
        }
        if (!deepEqual(beforeDataset[verseId]?.speechStatus?.NRSVUE, afterDataset[verseId]?.speechStatus?.NRSVUE)) {
            validationFailures.push(`${verseId} speechStatus.NRSVUE changed`);
        }
    }

    if (!deepEqual(beforeDataset, normalizedAfter)) {
        validationFailures.push('Fields outside intended LAMSA speechText/status updates changed');
    }

    for (const row of plan.applyRows) {
        const speechText = getLamsaSpeechText(afterDataset[row.verseId]);
        const speechStatus = getLamsaSpeechStatus(afterDataset[row.verseId]);
        if (!speechText) {
            validationFailures.push(`${row.verseId} approved/edited row produced blank LAMSA speechText`);
        }
        if (speechText !== row.effectiveSpeechTextLAMSA) {
            validationFailures.push(`${row.verseId} LAMSA speechText does not match effective reviewed text`);
        }
        if (speechStatus !== 'verified') {
            validationFailures.push(`${row.verseId} LAMSA speechStatus is "${speechStatus || '[missing]'}"; expected "verified"`);
        }
        if (BRACKETED_NOTE_PATTERN.test(speechText) || GLOSS_PATTERN.test(speechText)) {
            validationFailures.push(`${row.verseId} applied LAMSA speechText contains bracketed/editorial gloss`);
        }
    }

    for (const verseId of rejectDeferIds) {
        if (!deepEqual(beforeDataset[verseId], afterDataset[verseId])) {
            validationFailures.push(`${verseId} reject/defer row was modified`);
        }
    }

    JSON.parse(fs.readFileSync(DATASET_FILE, 'utf8'));

    return {
        checkedAt: new Date().toISOString(),
        validationPassed: validationFailures.length === 0,
        validationFailures,
        appliedCount: plan.applyRows.length,
        rejectedOrDeferredUnchangedCount: rejectDeferIds.size
    };
}

function restoreField(targetRecord, sourceRecord, field) {
    if (!targetRecord) return;
    if (Object.prototype.hasOwnProperty.call(sourceRecord || {}, field)) {
        targetRecord[field] = deepClone(sourceRecord[field]);
    } else {
        delete targetRecord[field];
    }
}

function writeDryRunArtifacts(plan, { applied, postApplyVerification }) {
    const report = {
        ...plan,
        applied,
        postApplyVerification,
        summary: {
            ...plan.summary,
            dryRunValidationPassed: plan.validationFailures.length === 0,
            postApplyValidationPassed: postApplyVerification?.validationPassed ?? null
        }
    };

    fs.mkdirSync(path.dirname(DRY_RUN_REPORT_FILE), { recursive: true });
    fs.writeFileSync(DRY_RUN_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(SUMMARY_CSV_FILE, `${toSummaryCsv(report.summary)}\n`, 'utf8');
}

function toSummaryCsv(summary) {
    const rows = [
        ['totalReviewedRows', summary.totalReviewedRows],
        ['appliedCount', summary.appliedCount],
        ['skippedRejectCount', summary.skippedRejectCount],
        ['skippedRevelationDeferCount', summary.skippedRevelationDeferCount],
        ['missingVerseIds', summary.missingVerseIds.join('; ')],
        ['missingLamsaTargetVerseIds', summary.missingLamsaTargetVerseIds.join('; ')],
        ['validationFailureCount', summary.validationFailureCount],
        ['dryRunValidationPassed', summary.dryRunValidationPassed],
        ['postApplyValidationPassed', summary.postApplyValidationPassed]
    ];

    for (const [decision, count] of Object.entries(summary.countByReviewerDecision)) {
        rows.push([`decision:${decision}`, count]);
    }

    return [SUMMARY_COLUMNS, ...rows]
        .map(row => row.map(csvValue).join(','))
        .join('\r\n');
}

function loadCsv(filePath) {
    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const table = parseCsv(text);
    if (table.length === 0) return [];
    const headers = table[0].map(header => header.trim());
    return table.slice(1)
        .filter(cells => cells.some(cell => stringValue(cell).trim() !== ''))
        .map(cells => {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = cells[index] === undefined ? '' : cells[index];
            });
            return row;
        });
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

function normalizeDecision(value) {
    return stringValue(value).trim().toLowerCase();
}

function getLamsaSpeechText(record) {
    if (typeof record?.speechText?.LAMSA === 'string') return record.speechText.LAMSA;
    return '';
}

function getLamsaSpeechStatus(record) {
    if (typeof record?.speechStatus?.LAMSA === 'string') return record.speechStatus.LAMSA;
    return '';
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

function csvValue(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function stringValue(value) {
    return typeof value === 'string' ? value : '';
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function printSummary(plan, postApplyVerification) {
    console.log('LAMSA held speech review apply complete.');
    console.log(`Total reviewed rows: ${plan.summary.totalReviewedRows}`);
    console.log(`Applied rows: ${plan.summary.appliedCount}`);
    console.log(`Skipped reject rows: ${plan.summary.skippedRejectCount}`);
    console.log(`Skipped Revelation/defer rows: ${plan.summary.skippedRevelationDeferCount}`);
    console.log(`Dry-run validation passed: ${plan.validationFailures.length === 0}`);
    console.log(`Post-apply validation passed: ${postApplyVerification.validationPassed}`);
    console.log(`Dry-run report saved to ${relativeToRoot(DRY_RUN_REPORT_FILE)}`);
    console.log(`Summary CSV saved to ${relativeToRoot(SUMMARY_CSV_FILE)}`);
}
