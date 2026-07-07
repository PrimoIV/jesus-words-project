const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const CONSOLIDATION_CSV = path.join(ROOT, 'dev/reports/lamsa_candidate_consolidation_audit.csv');
const DRY_RUN_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_auto_safe_consolidation_dry_run.json');
const SUMMARY_CSV_FILE = path.join(ROOT, 'dev/reports/lamsa_auto_safe_consolidation_apply_summary.csv');
const BACKUP_DIR = path.join(ROOT, 'dev/backups');
const BACKUP_FILE = path.join(BACKUP_DIR, 'jesus_verses_final.before_lamsa_auto_safe_consolidation.json');

const EXPECTED_APPLY_COUNT = 79;
const TARGET_CLASSIFICATION = 'auto_safe_candidate_import';
const TARGET_DECISION = 'auto_import_candidate';
const VERIFIED_STATUS = 'verified';
const GLOSS_PATTERN = /\b(?:which means|meaning|that is to say|Ancient text|Enemies desecrated|Dan\.\s*11:31|Aramaic idiom|Synonym:|translator gloss|editorial|source gloss|not punctuated)\b/i;
const BRACKET_PATTERN = /\[[^\]]+\]/;

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const beforeDataset = readJson(DATASET_FILE);
    const consolidationRows = loadCsv(CONSOLIDATION_CSV);
    const plan = buildDryRunPlan(beforeDataset, consolidationRows);

    writeReports(plan, {
        applied: false,
        backupPath: '',
        postApplyVerification: null
    });

    if (plan.validationFailures.length > 0) {
        console.error(`LAMSA auto-safe consolidation dry-run failed with ${plan.validationFailures.length} validation failure(s).`);
        plan.validationFailures.slice(0, 50).forEach(failure => {
            console.error(`- ${failure.verseId || `row ${failure.rowNumber}`}: ${failure.reason}`);
        });
        process.exit(1);
    }

    const afterDataset = deepClone(beforeDataset);
    applyPlan(afterDataset, plan.applyRows);
    const expectedDataset = deepClone(beforeDataset);
    applyPlan(expectedDataset, plan.applyRows);

    const backupPath = createBackup(beforeDataset);
    fs.writeFileSync(DATASET_FILE, `${JSON.stringify(afterDataset, null, 2)}\n`, 'utf8');

    const persistedDataset = readJson(DATASET_FILE);
    const postApplyVerification = verifyAfterApply({
        beforeDataset,
        afterDataset: persistedDataset,
        expectedDataset,
        plan
    });

    writeReports(plan, {
        applied: true,
        backupPath,
        postApplyVerification
    });

    printSummary(plan, postApplyVerification, backupPath);

    if (!postApplyVerification.validationPassed) {
        console.error(`LAMSA auto-safe consolidation apply verification failed with ${postApplyVerification.validationFailures.length} failure(s).`);
        postApplyVerification.validationFailures.slice(0, 50).forEach(failure => console.error(`- ${failure}`));
        process.exit(1);
    }
}

function buildDryRunPlan(dataset, consolidationRows) {
    const targetRows = consolidationRows.filter(row =>
        stringValue(row.classification).trim() === TARGET_CLASSIFICATION
        && stringValue(row.recommendedDecision).trim() === TARGET_DECISION
    );
    const validationFailures = [];
    const applyRows = [];
    const seenVerseIds = new Set();

    if (targetRows.length !== EXPECTED_APPLY_COUNT) {
        validationFailures.push({
            reason: `Expected ${EXPECTED_APPLY_COUNT} auto-safe consolidation rows, found ${targetRows.length}`
        });
    }

    targetRows.forEach((row, index) => {
        const rowNumber = index + 2;
        const verseId = stringValue(row.verseId).trim();
        const candidateSpeechTextLAMSA = stringValue(row.candidateSpeechTextLAMSA).trim();
        const rowRawLamsa = stringValue(row.rawLamsa).trim();
        const record = dataset[verseId];

        if (!verseId) {
            validationFailures.push({ rowNumber, verseId, reason: 'Row has blank verseId' });
            return;
        }
        if (seenVerseIds.has(verseId)) {
            validationFailures.push({ rowNumber, verseId, reason: 'Duplicate target verseId in consolidation CSV' });
            return;
        }
        seenVerseIds.add(verseId);

        if (!record) {
            validationFailures.push({ rowNumber, verseId, reason: 'Verse ID is missing from data/jesus_verses_final.json' });
            return;
        }

        const datasetRawLamsa = stringValue(record.translations?.LAMSA).trim();
        const beforeSpeechTextLAMSA = getLamsaSpeechText(record);
        const beforeSpeechStatusLAMSA = getLamsaSpeechStatus(record);

        if (!datasetRawLamsa) {
            validationFailures.push({ rowNumber, verseId, reason: 'Dataset row has blank translations.LAMSA' });
        }
        if (rowRawLamsa && normalizeWhitespace(rowRawLamsa) !== normalizeWhitespace(datasetRawLamsa)) {
            validationFailures.push({ rowNumber, verseId, reason: 'CSV rawLamsa does not match current dataset translations.LAMSA' });
        }
        if (beforeSpeechTextLAMSA.trim()) {
            validationFailures.push({ rowNumber, verseId, reason: 'Target row already has nonblank speechText.LAMSA' });
        }
        if (!candidateSpeechTextLAMSA) {
            validationFailures.push({ rowNumber, verseId, reason: 'candidateSpeechTextLAMSA is blank' });
        }
        if (candidateSpeechTextLAMSA && normalizeWhitespace(candidateSpeechTextLAMSA) !== normalizeWhitespace(datasetRawLamsa)) {
            validationFailures.push({ rowNumber, verseId, reason: 'candidateSpeechTextLAMSA does not match current raw LAMSA text exactly or whitespace-only' });
        }
        if (BRACKET_PATTERN.test(candidateSpeechTextLAMSA)) {
            validationFailures.push({ rowNumber, verseId, reason: 'candidateSpeechTextLAMSA contains square brackets' });
        }
        if (GLOSS_PATTERN.test(candidateSpeechTextLAMSA)) {
            validationFailures.push({ rowNumber, verseId, reason: 'candidateSpeechTextLAMSA contains possible editorial gloss language' });
        }

        applyRows.push({
            rowNumber,
            verseId,
            rawLamsa: datasetRawLamsa,
            beforeSpeechTextLAMSA,
            afterSpeechTextLAMSA: candidateSpeechTextLAMSA,
            beforeSpeechStatusLAMSA,
            afterSpeechStatusLAMSA: VERIFIED_STATUS,
            candidateSourceFiles: stringValue(row.candidateSourceFiles),
            classification: stringValue(row.classification),
            recommendedDecision: stringValue(row.recommendedDecision)
        });
    });

    return {
        generatedAt: new Date().toISOString(),
        inputs: {
            dataset: relativeToRoot(DATASET_FILE),
            consolidationCsv: relativeToRoot(CONSOLIDATION_CSV)
        },
        outputs: {
            dryRunReport: relativeToRoot(DRY_RUN_REPORT_FILE),
            summaryCsv: relativeToRoot(SUMMARY_CSV_FILE)
        },
        summary: {
            totalConsolidationRows: consolidationRows.length,
            targetAutoSafeRows: targetRows.length,
            expectedApplyCount: EXPECTED_APPLY_COUNT,
            validationFailureCount: validationFailures.length,
            dryRunValidationPassed: validationFailures.length === 0
        },
        validationFailures,
        applyRows
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
        record.speechText.LAMSA = row.afterSpeechTextLAMSA;
        record.speechStatus.LAMSA = row.afterSpeechStatusLAMSA;
    }
}

function verifyAfterApply({ beforeDataset, afterDataset, expectedDataset, plan }) {
    const validationFailures = [];
    const applyVerseIds = new Set(plan.applyRows.map(row => row.verseId));
    const beforeVerseIds = Object.keys(beforeDataset).sort();
    const afterVerseIds = Object.keys(afterDataset).sort();

    if (JSON.stringify(afterDataset) !== JSON.stringify(expectedDataset)) {
        validationFailures.push('Persisted dataset differs from the exact expected dataset after applying only LAMSA speechText/status changes.');
    }
    if (JSON.stringify(beforeVerseIds) !== JSON.stringify(afterVerseIds)) {
        validationFailures.push('Verse ID set changed after apply.');
    }

    let writtenSpeechTextCount = 0;
    for (const row of plan.applyRows) {
        const beforeRecord = beforeDataset[row.verseId];
        const afterRecord = afterDataset[row.verseId];
        if (!beforeRecord || !afterRecord) {
            validationFailures.push(`${row.verseId}: missing before or after record.`);
            continue;
        }
        if (getLamsaSpeechText(beforeRecord).trim()) {
            validationFailures.push(`${row.verseId}: before speechText.LAMSA was nonblank.`);
        }
        if (getLamsaSpeechText(afterRecord) !== row.afterSpeechTextLAMSA) {
            validationFailures.push(`${row.verseId}: speechText.LAMSA was not written to the candidate text.`);
        } else {
            writtenSpeechTextCount += 1;
        }
        if (getLamsaSpeechStatus(afterRecord) !== VERIFIED_STATUS) {
            validationFailures.push(`${row.verseId}: speechStatus.LAMSA was not set to verified.`);
        }
    }

    if (writtenSpeechTextCount !== EXPECTED_APPLY_COUNT) {
        validationFailures.push(`Expected ${EXPECTED_APPLY_COUNT} LAMSA speechText values written, found ${writtenSpeechTextCount}.`);
    }

    for (const verseId of beforeVerseIds) {
        const beforeRecord = beforeDataset[verseId];
        const afterRecord = afterDataset[verseId];
        if (!afterRecord) continue;

        if (JSON.stringify(beforeRecord.translations || {}) !== JSON.stringify(afterRecord.translations || {})) {
            validationFailures.push(`${verseId}: raw translations changed.`);
        }
        ['DBH', 'NRSVUE'].forEach(translationKey => {
            if (stringValue(beforeRecord.translations?.[translationKey]) !== stringValue(afterRecord.translations?.[translationKey])) {
                validationFailures.push(`${verseId}: translations.${translationKey} changed.`);
            }
            if (stringValue(beforeRecord.speechText?.[translationKey]) !== stringValue(afterRecord.speechText?.[translationKey])) {
                validationFailures.push(`${verseId}: speechText.${translationKey} changed.`);
            }
            if (stringValue(beforeRecord.speechStatus?.[translationKey]) !== stringValue(afterRecord.speechStatus?.[translationKey])) {
                validationFailures.push(`${verseId}: speechStatus.${translationKey} changed.`);
            }
        });

        if (!applyVerseIds.has(verseId)) {
            if (JSON.stringify(beforeRecord) !== JSON.stringify(afterRecord)) {
                validationFailures.push(`${verseId}: non-target verse changed.`);
            }
        } else {
            const expectedRecord = deepClone(beforeRecord);
            if (!expectedRecord.speechText || typeof expectedRecord.speechText !== 'object' || Array.isArray(expectedRecord.speechText)) {
                expectedRecord.speechText = {};
            }
            if (!expectedRecord.speechStatus || typeof expectedRecord.speechStatus !== 'object' || Array.isArray(expectedRecord.speechStatus)) {
                expectedRecord.speechStatus = {};
            }
            expectedRecord.speechText.LAMSA = getLamsaSpeechText(afterRecord);
            expectedRecord.speechStatus.LAMSA = getLamsaSpeechStatus(afterRecord);
            if (JSON.stringify(expectedRecord) !== JSON.stringify(afterRecord)) {
                validationFailures.push(`${verseId}: target verse changed outside speechText.LAMSA/speechStatus.LAMSA.`);
            }
        }
    }

    return {
        validationPassed: validationFailures.length === 0,
        validationFailureCount: validationFailures.length,
        validationFailures,
        appliedCount: writtenSpeechTextCount,
        verifiedStatusCount: plan.applyRows.filter(row => getLamsaSpeechStatus(afterDataset[row.verseId]) === VERIFIED_STATUS).length
    };
}

function writeReports(plan, { applied, backupPath, postApplyVerification }) {
    const report = {
        ...plan,
        applied,
        backupPath: backupPath ? relativeToRoot(backupPath) : '',
        postApplyVerification
    };
    const summary = {
        ...plan.summary,
        applied,
        appliedCount: postApplyVerification?.appliedCount ?? 0,
        postApplyValidationPassed: postApplyVerification?.validationPassed ?? '',
        postApplyValidationFailureCount: postApplyVerification?.validationFailureCount ?? '',
        backupPath: backupPath ? relativeToRoot(backupPath) : ''
    };

    fs.mkdirSync(path.dirname(DRY_RUN_REPORT_FILE), { recursive: true });
    fs.writeFileSync(DRY_RUN_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(SUMMARY_CSV_FILE, `${summaryToCsv(summary)}\n`, 'utf8');
}

function createBackup(dataset) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backupPath = getAvailableBackupPath(BACKUP_FILE);
    fs.writeFileSync(backupPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    return backupPath;
}

function getAvailableBackupPath(basePath) {
    if (!fs.existsSync(basePath)) return basePath;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = path.extname(basePath);
    const withoutExt = basePath.slice(0, -ext.length);
    return `${withoutExt}.${timestamp}${ext}`;
}

function summaryToCsv(summary) {
    const rows = [['metric', 'value']];
    Object.entries(summary).forEach(([metric, value]) => rows.push([metric, Array.isArray(value) ? value.join('; ') : value]));
    return rows.map(row => row.map(csvValue).join(',')).join('\r\n');
}

function loadCsv(file) {
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    if (rows.length === 0) return [];
    const headers = rows[0].map(header => String(header || '').trim());
    return rows.slice(1)
        .filter(row => row.some(value => String(value || '').trim() !== ''))
        .map(row => {
            const object = {};
            headers.forEach((header, index) => {
                if (!header) return;
                object[header] = row[index] ?? '';
            });
            return object;
        });
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];

        if (inQuotes) {
            if (char === '"' && next === '"') {
                value += '"';
                index += 1;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                value += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(value);
            value = '';
        } else if (char === '\r') {
            if (next === '\n') index += 1;
            row.push(value);
            rows.push(row);
            row = [];
            value = '';
        } else if (char === '\n') {
            row.push(value);
            rows.push(row);
            row = [];
            value = '';
        } else {
            value += char;
        }
    }

    if (value || row.length) {
        row.push(value);
        rows.push(row);
    }

    return rows;
}

function csvValue(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function getLamsaSpeechText(record) {
    return stringValue(record?.speechText?.LAMSA);
}

function getLamsaSpeechStatus(record) {
    return stringValue(record?.speechStatus?.LAMSA);
}

function normalizeWhitespace(text) {
    return stringValue(text).replace(/\s+/g, ' ').trim();
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function stringValue(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function printSummary(plan, postApplyVerification, backupPath) {
    console.log('LAMSA auto-safe consolidation apply complete.');
    console.log(`Target auto-safe rows: ${plan.summary.targetAutoSafeRows}`);
    console.log(`Dry-run validation passed: ${plan.summary.dryRunValidationPassed}`);
    console.log(`Applied count: ${postApplyVerification.appliedCount}`);
    console.log(`Post-apply validation passed: ${postApplyVerification.validationPassed}`);
    console.log(`Backup saved to ${relativeToRoot(backupPath)}`);
    console.log(`Dry-run/apply report saved to ${relativeToRoot(DRY_RUN_REPORT_FILE)}`);
    console.log(`Summary CSV saved to ${relativeToRoot(SUMMARY_CSV_FILE)}`);
}
