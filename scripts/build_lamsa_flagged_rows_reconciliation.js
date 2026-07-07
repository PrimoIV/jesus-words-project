const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const NEIGHBOR_AUDIT_CSV = path.join(ROOT, 'dev/reports/lamsa_neighbor_context_audit.csv');
const JSON_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_flagged_rows_reconciliation.json');
const CSV_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_flagged_rows_reconciliation.csv');

const VERSE_ID_PATTERN = /^(?:MAT|MRK|LUK|JHN|REV)_\d+_\d+$/;
const CSV_COLUMNS = [
    'verseId',
    'neighborOfAppliedVerseId',
    'neighborContextRisk',
    'neighborRiskReason',
    'neighborRecommendedAction',
    'currentSpeechTextLAMSA',
    'currentSpeechStatusLAMSA',
    'appearsInPendingReviewSheet',
    'hasCandidateSpeechTextLAMSAInPendingFile',
    'hasApprovedSpeechTextLAMSAInPendingFile',
    'hasReviewerDecisionInPendingFile',
    'appearsInOverrideFile',
    'appearsInPriorApplyReport',
    'recommendedNextAction',
    'pendingReviewFiles',
    'candidateFiles',
    'approvedFiles',
    'reviewerDecisionFiles',
    'overrideFiles',
    'priorApplyReportFiles',
    'allRelevantFiles'
];

const CANDIDATE_FIELDS = [
    'candidateSpeechTextLAMSA',
    'candidateSpeechText',
    'candidateSpeech',
    'suggestedSpeechText',
    'suggestedManualSpeechText',
    'proposedText',
    'speechText',
    'newSpeechText',
    'speechCandidate',
    'currentCandidate',
    'candidate'
];

const APPROVED_FIELDS = [
    'approvedSpeechTextLAMSA',
    'effectiveSpeechTextLAMSA',
    'approvedSpeechText',
    'finalText',
    'afterSpeechTextLAMSA'
];

const REVIEWER_DECISION_FIELDS = [
    'reviewerDecision',
    'approvalStatus',
    'decision'
];

const TRANSLATION_FIELDS = [
    'translationKey',
    'translation',
    'translationName',
    'version',
    'sourceTranslation'
];

const EXCLUDED_SCAN_BASENAMES = new Set([
    'lamsa_neighbor_context_audit.csv',
    'lamsa_neighbor_context_audit.json',
    'lamsa_flagged_rows_reconciliation.csv',
    'lamsa_flagged_rows_reconciliation.json'
]);

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const dataset = readJson(DATASET_FILE);
    const flaggedRows = dedupeFlaggedRows(loadCsv(NEIGHBOR_AUDIT_CSV));
    const flaggedVerseIds = new Set(flaggedRows.map(row => row.verseId));
    const scanFiles = collectScanFiles();
    const fileMatches = scanFiles.flatMap(file => scanFile(file, flaggedVerseIds));
    const matchesByVerseId = groupMatchesByVerseId(fileMatches);

    const rows = flaggedRows.map(flaggedRow => buildReconciliationRow({
        flaggedRow,
        dataset,
        matches: matchesByVerseId.get(flaggedRow.verseId) || []
    }));

    const summary = buildSummary({ rows, flaggedRows, scanFiles, fileMatches });
    const report = {
        generatedAt: new Date().toISOString(),
        inputs: {
            dataset: relativeToRoot(DATASET_FILE),
            neighborContextAuditCsv: relativeToRoot(NEIGHBOR_AUDIT_CSV)
        },
        outputs: {
            json: relativeToRoot(JSON_REPORT_FILE),
            csv: relativeToRoot(CSV_REPORT_FILE)
        },
        summary,
        filesScanned: scanFiles.map(file => ({
            path: relativeToRoot(file),
            role: classifyFileRole(file)
        })),
        rows
    };

    fs.mkdirSync(path.dirname(JSON_REPORT_FILE), { recursive: true });
    fs.writeFileSync(JSON_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(CSV_REPORT_FILE, `${toCsv(rows)}\n`, 'utf8');

    printSummary(summary);
}

function dedupeFlaggedRows(rows) {
    const byVerseId = new Map();
    for (const row of rows) {
        const verseId = stringValue(row.verseId).trim();
        if (!VERSE_ID_PATTERN.test(verseId)) continue;

        if (!byVerseId.has(verseId)) {
            byVerseId.set(verseId, {
                verseId,
                neighborOfAppliedVerseId: new Set(splitList(row.neighborOfAppliedVerseId)),
                neighborContextRisk: stringValue(row.contextRisk),
                neighborRiskReason: stringValue(row.riskReason),
                neighborRecommendedAction: stringValue(row.recommendedAction),
                rawLamsa: stringValue(row.rawLamsa)
            });
            continue;
        }

        const existing = byVerseId.get(verseId);
        splitList(row.neighborOfAppliedVerseId).forEach(id => existing.neighborOfAppliedVerseId.add(id));
        existing.neighborContextRisk = highestRisk(existing.neighborContextRisk, stringValue(row.contextRisk));
        existing.neighborRiskReason = joinUnique([existing.neighborRiskReason, stringValue(row.riskReason)]);
        existing.neighborRecommendedAction = joinUnique([existing.neighborRecommendedAction, stringValue(row.recommendedAction)]);
    }

    return [...byVerseId.values()]
        .map(row => ({
            ...row,
            neighborOfAppliedVerseId: [...row.neighborOfAppliedVerseId].sort(compareVerseIds).join('; ')
        }))
        .sort((a, b) => compareVerseIds(a.verseId, b.verseId));
}

function buildReconciliationRow({ flaggedRow, dataset, matches }) {
    const record = dataset[flaggedRow.verseId] || {};
    const currentSpeechTextLAMSA = getLamsaSpeechText(record);
    const currentSpeechStatusLAMSA = getLamsaSpeechStatus(record);
    const relevantMatches = matches.filter(match => isLamsaRelevantMatch(match));
    const pendingMatches = relevantMatches.filter(match => match.role === 'pending_review_sheet');
    const overrideMatches = relevantMatches.filter(match => match.role === 'override_file');
    const priorApplyMatches = relevantMatches.filter(match => match.role === 'prior_apply_report');
    const candidateMatches = relevantMatches.filter(match => match.hasCandidate);
    const pendingCandidateMatches = pendingMatches.filter(match => match.hasCandidate);
    const approvedMatches = relevantMatches.filter(match => match.hasApproved);
    const pendingApprovedMatches = pendingMatches.filter(match => match.hasApproved);
    const reviewerDecisionMatches = relevantMatches.filter(match => match.hasReviewerDecision);
    const pendingReviewerDecisionMatches = pendingMatches.filter(match => match.hasReviewerDecision);

    const row = {
        verseId: flaggedRow.verseId,
        neighborOfAppliedVerseId: flaggedRow.neighborOfAppliedVerseId,
        rawLamsa: flaggedRow.rawLamsa,
        neighborContextRisk: flaggedRow.neighborContextRisk,
        neighborRiskReason: flaggedRow.neighborRiskReason,
        neighborRecommendedAction: flaggedRow.neighborRecommendedAction,
        currentSpeechTextLAMSA,
        currentSpeechStatusLAMSA,
        appearsInPendingReviewSheet: pendingMatches.length > 0,
        hasCandidateSpeechTextLAMSAInPendingFile: pendingCandidateMatches.length > 0,
        hasApprovedSpeechTextLAMSAInPendingFile: pendingApprovedMatches.length > 0,
        hasReviewerDecisionInPendingFile: pendingReviewerDecisionMatches.length > 0,
        appearsInOverrideFile: overrideMatches.length > 0,
        appearsInPriorApplyReport: priorApplyMatches.length > 0,
        pendingReviewFiles: summarizeFiles(pendingMatches),
        candidateFiles: summarizeFiles(candidateMatches),
        approvedFiles: summarizeFiles(approvedMatches),
        reviewerDecisionFiles: summarizeFiles(reviewerDecisionMatches),
        overrideFiles: summarizeFiles(overrideMatches),
        priorApplyReportFiles: summarizeFiles(priorApplyMatches),
        allRelevantFiles: summarizeFiles(relevantMatches),
        matchDetails: relevantMatches.map(toMatchDetail)
    };

    row.recommendedNextAction = getRecommendedNextAction({
        row,
        candidateMatches,
        pendingMatches,
        overrideMatches,
        priorApplyMatches
    });

    return row;
}

function getRecommendedNextAction({
    row,
    candidateMatches,
    pendingMatches,
    overrideMatches,
    priorApplyMatches
}) {
    if (row.currentSpeechTextLAMSA) {
        if (needsBoundaryCheck(row)) return 'existing_speechText_needs_boundary_check';
        return 'already_applied_to_main_json';
    }
    if (pendingMatches.length > 0) return 'pending_in_existing_review_sheet';
    if (overrideMatches.length > 0) return 'pending_in_existing_override_file';
    if (candidateMatches.length > 0 || priorApplyMatches.some(match => match.hasCandidate || match.hasApproved)) {
        return 'candidate_exists_not_applied';
    }
    if (shouldReviewAsMissing(row)) return 'truly_missing_needs_review';
    return 'ignore_low_risk_context_only';
}

function needsBoundaryCheck(row) {
    const action = row.neighborRecommendedAction.toLowerCase();
    const reason = row.neighborRiskReason.toLowerCase();
    return action.includes('boundary')
        || action.includes('parable')
        || reason.includes('narration')
        || reason.includes('speaker setup')
        || reason.includes('internal parable');
}

function shouldReviewAsMissing(row) {
    const action = row.neighborRecommendedAction.toLowerCase();
    return action.includes('possible_missing_lamsa_speechtext')
        || row.neighborContextRisk === 'high'
        || row.neighborContextRisk === 'medium';
}

function collectScanFiles() {
    const files = new Map();
    addReportFiles(files);
    addNamedRootFiles(files);
    addOverrideLikeFiles(files);
    return [...files.values()].sort((a, b) => relativeToRoot(a).localeCompare(relativeToRoot(b)));
}

function addReportFiles(files) {
    const reportsDir = path.join(ROOT, 'dev/reports');
    if (!fs.existsSync(reportsDir)) return;
    for (const file of fs.readdirSync(reportsDir)) {
        const fullPath = path.join(reportsDir, file);
        if (!isScannableFile(fullPath)) continue;
        files.set(fullPath, fullPath);
    }
}

function addNamedRootFiles(files) {
    [
        'speech_manual_review_sheet.csv',
        'speech_manual_review_sheet_candidates_filled.csv',
        'approved_review_patterns.json'
    ].forEach(file => {
        const fullPath = path.join(ROOT, file);
        if (isScannableFile(fullPath)) files.set(fullPath, fullPath);
    });
}

function addOverrideLikeFiles(files) {
    ['dev', 'data'].forEach(relativeDir => {
        const dir = path.join(ROOT, relativeDir);
        if (!fs.existsSync(dir)) return;
        for (const file of walkFiles(dir)) {
            if (!isScannableFile(file)) continue;
            const basename = path.basename(file).toLowerCase();
            if (/(?:override|draft|approved|review|speech)/.test(basename)) {
                files.set(file, file);
            }
        }
    });
}

function* walkFiles(dir) {
    if (path.basename(dir).toLowerCase() === 'backups') return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walkFiles(fullPath);
        } else if (entry.isFile()) {
            yield fullPath;
        }
    }
}

function isScannableFile(file) {
    const basename = path.basename(file);
    return !EXCLUDED_SCAN_BASENAMES.has(basename)
        && (basename.endsWith('.json') || basename.endsWith('.csv'))
        && fs.existsSync(file)
        && fs.statSync(file).isFile();
}

function scanFile(file, flaggedVerseIds) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.csv') return scanCsvFile(file, flaggedVerseIds);
    if (ext === '.json') return scanJsonFile(file, flaggedVerseIds);
    return [];
}

function scanCsvFile(file, flaggedVerseIds) {
    const rows = loadCsv(file);
    const matches = [];
    rows.forEach((row, index) => {
        const verseId = findVerseId(row);
        if (!verseId || !flaggedVerseIds.has(verseId)) return;
        matches.push(buildMatch({
            file,
            format: 'csv',
            location: `row ${index + 2}`,
            source: row
        }));
    });
    return matches;
}

function scanJsonFile(file, flaggedVerseIds) {
    let parsed;
    try {
        parsed = readJson(file);
    } catch (error) {
        return [];
    }

    const matches = [];
    visitJson(parsed, '$', (value, location, keyVerseId) => {
        const verseId = keyVerseId || findVerseId(value);
        if (!verseId || !flaggedVerseIds.has(verseId)) return;
        matches.push(buildMatch({
            file,
            format: 'json',
            location,
            source: value,
            keyVerseId
        }));
    });
    return dedupeMatches(matches);
}

function visitJson(value, location, onObject) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((entry, index) => visitJson(entry, `${location}[${index}]`, onObject));
        return;
    }

    const objectVerseId = findVerseId(value);
    if (objectVerseId) onObject(value, location, null);

    for (const [key, child] of Object.entries(value)) {
        if (VERSE_ID_PATTERN.test(key)) {
            onObject(child, `${location}.${key}`, key);
        }
        if (child && typeof child === 'object') {
            visitJson(child, `${location}.${key}`, onObject);
        }
    }
}

function buildMatch({ file, format, location, source, keyVerseId }) {
    const verseId = keyVerseId || findVerseId(source);
    const role = classifyFileRole(file);
    const translationScope = getTranslationScope(file, source);
    const fields = extractSpeechFields(source);
    return {
        verseId,
        file: relativeToRoot(file),
        role,
        format,
        location,
        translationScope,
        hasCandidate: fields.candidateFields.length > 0,
        hasApproved: fields.approvedFields.length > 0,
        hasReviewerDecision: fields.reviewerDecisionFields.length > 0,
        candidateFields: fields.candidateFields,
        approvedFields: fields.approvedFields,
        reviewerDecisionFields: fields.reviewerDecisionFields,
        statusFields: fields.statusFields
    };
}

function classifyFileRole(file) {
    const basename = path.basename(file).toLowerCase();
    if (/^(?:lamsa_speechtext_auto_apply_report|lamsa_held_apply_dry_run|lamsa_held_apply_summary|speech_manual_override_apply_report)/.test(basename)) {
        return 'prior_apply_report';
    }
    if (basename === 'lamsa_held_speech_review_sheet_reviewed.csv') {
        return 'prior_apply_report';
    }
    if (/override/.test(basename) && !/apply_report/.test(basename)) {
        return 'override_file';
    }
    if (/^(?:speech_manual_review_sheet|speech_manual_review_sheet_candidates_filled|lamsa_held_speech_review_sheet)\.(?:csv|json)$/.test(basename)
        && !/apply/.test(basename)) {
        return 'pending_review_sheet';
    }
    if (/(?:preview|candidate|reduction|audit|review_patterns|with_speech)/.test(basename)) {
        return 'candidate_or_audit_file';
    }
    return 'other_report';
}

function getTranslationScope(file, source) {
    const basename = path.basename(file).toLowerCase();
    const fieldValue = TRANSLATION_FIELDS
        .map(field => stringValue(source?.[field]).trim())
        .find(value => value);

    if (fieldValue) return fieldValue;
    if (basename.includes('lamsa')) return 'LAMSA';
    if (hasOwnSpeechField(source, 'LAMSA')) return 'LAMSA';
    return '';
}

function hasOwnSpeechField(source, key) {
    if (!source || typeof source !== 'object') return false;
    return Object.keys(source).some(field => field.toLowerCase().includes(key.toLowerCase()));
}

function isLamsaRelevantMatch(match) {
    const isLamsaScope = /^lamsa$/i.test(match.translationScope)
        || match.file.toLowerCase().includes('lamsa')
        || match.candidateFields.some(field => field.field.toLowerCase().includes('lamsa'))
        || match.approvedFields.some(field => field.field.toLowerCase().includes('lamsa'))
        || match.statusFields.some(field => field.field.toLowerCase().includes('lamsa'));

    if (!isLamsaScope) return false;
    if (match.role === 'prior_apply_report') return true;
    if (match.role === 'pending_review_sheet' || match.role === 'override_file') {
        return match.hasCandidate || match.hasApproved || match.hasReviewerDecision || match.statusFields.length > 0;
    }

    return match.hasCandidate || match.hasApproved || match.hasReviewerDecision || match.statusFields.length > 0;
}

function extractSpeechFields(source) {
    const candidateFields = extractNamedFields(source, CANDIDATE_FIELDS);
    const approvedFields = extractNamedFields(source, APPROVED_FIELDS);
    const reviewerDecisionFields = extractNamedFields(source, REVIEWER_DECISION_FIELDS);
    const statusFields = extractNamedFields(source, [
        'speechStatusLAMSA',
        'speechStatus',
        'afterSpeechStatusLAMSA',
        'beforeSpeechStatusLAMSA'
    ]);
    return {
        candidateFields,
        approvedFields,
        reviewerDecisionFields,
        statusFields
    };
}

function extractNamedFields(source, fieldNames) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
    const lowerFieldMap = new Map(Object.keys(source).map(field => [field.toLowerCase(), field]));
    const fields = [];

    for (const fieldName of fieldNames) {
        const actualField = lowerFieldMap.get(fieldName.toLowerCase());
        if (!actualField) continue;
        const value = source[actualField];
        if (value === null || value === undefined || stringValue(value).trim() === '') continue;
        fields.push({
            field: actualField,
            value: stringValue(value)
        });
    }

    return fields;
}

function findVerseId(source) {
    if (!source || typeof source !== 'object') return '';
    for (const field of ['verseId', 'id', 'verse_id', 'Verse ID', 'verseID']) {
        const value = stringValue(source[field]).trim();
        if (VERSE_ID_PATTERN.test(value)) return value;
    }
    return '';
}

function groupMatchesByVerseId(matches) {
    const map = new Map();
    for (const match of matches) {
        if (!map.has(match.verseId)) map.set(match.verseId, []);
        map.get(match.verseId).push(match);
    }
    return map;
}

function dedupeMatches(matches) {
    const seen = new Set();
    const deduped = [];
    for (const match of matches) {
        const key = [
            match.verseId,
            match.file,
            match.location,
            match.role,
            match.translationScope,
            match.candidateFields.map(field => `${field.field}:${field.value}`).join('|'),
            match.approvedFields.map(field => `${field.field}:${field.value}`).join('|'),
            match.reviewerDecisionFields.map(field => `${field.field}:${field.value}`).join('|')
        ].join('\u0001');
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(match);
    }
    return deduped;
}

function summarizeFiles(matches) {
    return [...new Set(matches.map(match => match.file))].sort().join('; ');
}

function toMatchDetail(match) {
    return {
        file: match.file,
        role: match.role,
        location: match.location,
        translationScope: match.translationScope,
        candidateFields: match.candidateFields,
        approvedFields: match.approvedFields,
        reviewerDecisionFields: match.reviewerDecisionFields,
        statusFields: match.statusFields
    };
}

function buildSummary({ rows, flaggedRows, scanFiles, fileMatches }) {
    const actionCounts = countBy(rows, row => row.recommendedNextAction);
    return {
        flaggedVerseCount: rows.length,
        neighborRowsLoaded: flaggedRows.length,
        reviewForPossibleMissingInputCount: flaggedRows.filter(row => row.neighborRecommendedAction.includes('review_for_possible_missing_lamsa_speechText')).length,
        filesScannedCount: scanFiles.length,
        matchingFileAppearanceCount: fileMatches.length,
        currentSpeechTextPresentCount: rows.filter(row => row.currentSpeechTextLAMSA).length,
        currentSpeechTextMissingCount: rows.filter(row => !row.currentSpeechTextLAMSA).length,
        pendingReviewSheetCount: rows.filter(row => row.appearsInPendingReviewSheet).length,
        candidateInPendingFileCount: rows.filter(row => row.hasCandidateSpeechTextLAMSAInPendingFile).length,
        approvedInPendingFileCount: rows.filter(row => row.hasApprovedSpeechTextLAMSAInPendingFile).length,
        reviewerDecisionInPendingFileCount: rows.filter(row => row.hasReviewerDecisionInPendingFile).length,
        overrideFileCount: rows.filter(row => row.appearsInOverrideFile).length,
        priorApplyReportCount: rows.filter(row => row.appearsInPriorApplyReport).length,
        recommendedNextActionCounts: actionCounts,
        trulyMissingNeedsReviewIds: rows
            .filter(row => row.recommendedNextAction === 'truly_missing_needs_review')
            .map(row => row.verseId),
        candidateExistsNotAppliedIds: rows
            .filter(row => row.recommendedNextAction === 'candidate_exists_not_applied')
            .map(row => row.verseId)
    };
}

function countBy(items, getKey) {
    return items.reduce((counts, item) => {
        const key = getKey(item);
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});
}

function loadCsv(file) {
    if (!fs.existsSync(file)) return [];
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    if (rows.length === 0) return [];

    let headerRowIndex = 0;
    if (rows.length > 1 && looksLikePlaceholderHeader(rows[0]) && looksLikeRealHeader(rows[1])) {
        headerRowIndex = 1;
    }

    const headers = rows[headerRowIndex].map(header => String(header || '').trim());
    return rows.slice(headerRowIndex + 1)
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

function looksLikePlaceholderHeader(row) {
    return row.length > 0 && row.every(value => /^Column\d+$/i.test(String(value || '').trim()));
}

function looksLikeRealHeader(row) {
    const normalized = row.map(value => String(value || '').trim().toLowerCase());
    return normalized.includes('id') || normalized.includes('verseid') || normalized.includes('reference');
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

function getLamsaSpeechText(record) {
    return stringValue(record?.speechText?.LAMSA);
}

function getLamsaSpeechStatus(record) {
    return stringValue(record?.speechStatus?.LAMSA);
}

function stringValue(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function splitList(value) {
    return stringValue(value)
        .split(';')
        .map(part => part.trim())
        .filter(Boolean);
}

function joinUnique(values) {
    return [...new Set(values.flatMap(value => splitJoined(value)))].filter(Boolean).join('; ');
}

function splitJoined(value) {
    return stringValue(value)
        .split(';')
        .map(part => part.trim())
        .filter(Boolean);
}

function highestRisk(a, b) {
    const order = { high: 3, medium: 2, low: 1, none: 0, '': 0 };
    return (order[b] || 0) > (order[a] || 0) ? b : a;
}

function compareVerseIds(a, b) {
    const parsedA = parseVerseId(a);
    const parsedB = parseVerseId(b);
    if (!parsedA || !parsedB) return String(a).localeCompare(String(b));
    if (parsedA.bookIndex !== parsedB.bookIndex) return parsedA.bookIndex - parsedB.bookIndex;
    if (parsedA.chapter !== parsedB.chapter) return parsedA.chapter - parsedB.chapter;
    return parsedA.verse - parsedB.verse;
}

function parseVerseId(verseId) {
    const match = String(verseId || '').match(/^(MAT|MRK|LUK|JHN|REV)_(\d+)_(\d+)$/);
    if (!match) return null;
    return {
        book: match[1],
        bookIndex: ['MAT', 'MRK', 'LUK', 'JHN', 'REV'].indexOf(match[1]),
        chapter: Number(match[2]),
        verse: Number(match[3])
    };
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function printSummary(summary) {
    console.log('LAMSA flagged neighbor reconciliation complete.');
    console.log(`Flagged verses reconciled: ${summary.flaggedVerseCount}`);
    console.log(`Files scanned: ${summary.filesScannedCount}`);
    console.log(`Current LAMSA speechText present: ${summary.currentSpeechTextPresentCount}`);
    console.log(`Current LAMSA speechText missing: ${summary.currentSpeechTextMissingCount}`);
    console.log(`Pending review sheet appearances: ${summary.pendingReviewSheetCount}`);
    console.log(`Override file appearances: ${summary.overrideFileCount}`);
    console.log(`Prior apply report appearances: ${summary.priorApplyReportCount}`);
    Object.entries(summary.recommendedNextActionCounts).forEach(([action, count]) => {
        console.log(`${action}: ${count}`);
    });
    console.log(`JSON report saved to ${relativeToRoot(JSON_REPORT_FILE)}`);
    console.log(`CSV report saved to ${relativeToRoot(CSV_REPORT_FILE)}`);
}
