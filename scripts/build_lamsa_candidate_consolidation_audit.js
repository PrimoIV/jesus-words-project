const fs = require('fs');
const path = require('path');
const { getDiscourseBlocksForVerseId } = require('./load_jesus_discourse_context');

const ROOT = path.join(__dirname, '..');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const RECONCILIATION_CSV = path.join(ROOT, 'dev/reports/lamsa_flagged_rows_reconciliation.csv');
const JSON_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_candidate_consolidation_audit.json');
const CSV_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_candidate_consolidation_audit.csv');

const TARGET_ACTION = 'candidate_exists_not_applied';
const AUTO_SAFE = 'auto_safe_candidate_import';
const MANUAL_REVIEW = 'needs_manual_review_before_import';

const CSV_COLUMNS = [
    'verseId',
    'rawLamsa',
    'currentSpeechTextLAMSA',
    'currentSpeechStatusLAMSA',
    'candidateSpeechTextLAMSA',
    'candidateSourceFiles',
    'neighborContextRisk',
    'neighborRiskReason',
    'classification',
    'classificationReason',
    'recommendedDecision'
];

const CANDIDATE_FIELD_PRIORITY = [
    'candidateSpeechTextLAMSA',
    'speechText',
    'suggestedSpeechText',
    'suggestedManualSpeechText',
    'newSpeechText',
    'candidateSpeechText',
    'proposedText',
    'effectiveSpeechTextLAMSA',
    'approvedSpeechTextLAMSA',
    'finalText'
];

const TRANSLATION_FIELDS = [
    'translationKey',
    'translation',
    'translationName',
    'version',
    'sourceTranslation'
];

const EDITORIAL_GLOSS_PATTERN = /\b(?:which means|meaning|that is to say|Ancient text|Enemies desecrated|Dan\.\s*11:31|Aramaic idiom|Synonym:|translator gloss|editorial|source gloss|not punctuated)\b/i;
const NARRATOR_SETUP_PATTERN = /\b(?:Jesus\s+(?:said|answered|cried|met|spoke|began|commanded|asked)|he\s+(?:answered|said)\s+to\s+(?:him|them)|and\s+he\s+said|said\s+to\s+(?:him|them)|saying\s+to\s+(?:him|them))\b/i;
const OTHER_SPEAKER_PATTERN = /\b(?:They|Peter|Thomas|She|The disciples|The Pharisees|The Jews|His servants|servants|the servants|the people)\s+(?:said|answered|replied)\b/i;

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const dataset = readJson(DATASET_FILE);
    const reconciliationRows = loadCsv(RECONCILIATION_CSV)
        .filter(row => stringValue(row.recommendedNextAction).trim() === TARGET_ACTION);
    const candidateFiles = collectReferencedCandidateFiles(reconciliationRows);
    const candidateIndex = buildCandidateIndex(candidateFiles);

    const rows = reconciliationRows
        .map(row => buildAuditRow({ row, dataset, candidateIndex }))
        .sort((a, b) => compareVerseIds(a.verseId, b.verseId));
    const summary = buildSummary(rows, candidateFiles);

    const report = {
        generatedAt: new Date().toISOString(),
        inputs: {
            dataset: relativeToRoot(DATASET_FILE),
            reconciliationCsv: relativeToRoot(RECONCILIATION_CSV),
            candidateFiles: candidateFiles.map(relativeToRoot)
        },
        outputs: {
            json: relativeToRoot(JSON_REPORT_FILE),
            csv: relativeToRoot(CSV_REPORT_FILE)
        },
        summary,
        rows
    };

    fs.mkdirSync(path.dirname(JSON_REPORT_FILE), { recursive: true });
    fs.writeFileSync(JSON_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(CSV_REPORT_FILE, `${toCsv(rows)}\n`, 'utf8');

    printSummary(summary);
}

function buildAuditRow({ row, dataset, candidateIndex }) {
    const verseId = stringValue(row.verseId).trim();
    const record = dataset[verseId] || {};
    const rawLamsa = stringValue(record.translations?.LAMSA);
    const currentSpeechTextLAMSA = stringValue(row.currentSpeechTextLAMSA).trim() || stringValue(record.speechText?.LAMSA);
    const currentSpeechStatusLAMSA = stringValue(row.currentSpeechStatusLAMSA).trim() || stringValue(record.speechStatus?.LAMSA);
    const referencedFiles = splitList(row.candidateFiles).map(resolveRootPath);
    const availableCandidates = referencedFiles.flatMap(file => candidateIndex.get(candidateKey(file, verseId)) || []);
    const bestCandidate = chooseBestCandidate({ rawLamsa, candidates: availableCandidates });
    const candidateSpeechTextLAMSA = bestCandidate?.text || '';
    const classification = classifyCandidate({
        verseId,
        rawLamsa,
        currentSpeechTextLAMSA,
        candidateSpeechTextLAMSA,
        candidates: availableCandidates,
        bestCandidate,
        neighborRiskReason: stringValue(row.neighborRiskReason),
        neighborContextRisk: stringValue(row.neighborContextRisk)
    });

    return {
        verseId,
        rawLamsa,
        currentSpeechTextLAMSA,
        currentSpeechStatusLAMSA,
        candidateSpeechTextLAMSA,
        candidateSourceFiles: summarizeCandidateFiles(bestCandidate ? [bestCandidate] : availableCandidates),
        neighborContextRisk: stringValue(row.neighborContextRisk),
        neighborRiskReason: stringValue(row.neighborRiskReason),
        classification: classification.classification,
        classificationReason: classification.reasons.join('; '),
        recommendedDecision: classification.recommendedDecision,
        candidateDetails: availableCandidates.map(candidate => ({
            sourceFile: relativeToRoot(candidate.file),
            location: candidate.location,
            field: candidate.field,
            sourceKind: candidate.sourceKind,
            candidateMatchesRawWhitespaceOnly: normalizeWhitespace(candidate.text) === normalizeWhitespace(rawLamsa),
            candidateExactRawMatch: candidate.text === rawLamsa,
            text: candidate.text
        }))
    };
}

function classifyCandidate({
    verseId,
    rawLamsa,
    currentSpeechTextLAMSA,
    candidateSpeechTextLAMSA,
    candidates,
    bestCandidate,
    neighborRiskReason,
    neighborContextRisk
}) {
    const reasons = [];
    const discourseBlocks = getDiscourseBlocksForVerseId(verseId);
    const distinctCandidates = getDistinctTexts(candidates.map(candidate => candidate.text));
    const rawWhitespaceMatch = candidateSpeechTextLAMSA
        && normalizeWhitespace(candidateSpeechTextLAMSA) === normalizeWhitespace(rawLamsa);
    const hasParableOrDialogueWarning = /parable|dialogue|internal parable/i.test(neighborRiskReason)
        || discourseBlocks.some(block => block.type === 'parable');

    if (currentSpeechTextLAMSA) {
        reasons.push('Current LAMSA speechText is already nonblank.');
    }
    if (!candidateSpeechTextLAMSA) {
        reasons.push('No nonblank LAMSA candidate text was found in referenced candidate files.');
    }
    if (candidateSpeechTextLAMSA && !rawWhitespaceMatch) {
        reasons.push('Candidate differs materially from current raw LAMSA text.');
    }
    if (candidateSpeechTextLAMSA && /\[[^\]]+\]/.test(candidateSpeechTextLAMSA)) {
        reasons.push('Candidate contains square-bracket material.');
    }
    if (candidateSpeechTextLAMSA && EDITORIAL_GLOSS_PATTERN.test(candidateSpeechTextLAMSA)) {
        reasons.push('Candidate contains possible editorial gloss language.');
    }
    if (candidateSpeechTextLAMSA && NARRATOR_SETUP_PATTERN.test(candidateSpeechTextLAMSA)) {
        reasons.push('Candidate contains real-world narrator or speaker setup.');
    }
    if (candidateSpeechTextLAMSA && OTHER_SPEAKER_PATTERN.test(candidateSpeechTextLAMSA) && !hasParableOrDialogueWarning) {
        reasons.push('Candidate contains possible other-speaker contamination.');
    }
    if (NARRATOR_SETUP_PATTERN.test(rawLamsa)) {
        reasons.push('Raw LAMSA contains narrator setup, so boundary must be reviewed.');
    }
    if (hasParableOrDialogueWarning) {
        reasons.push('Neighbor/discourse context indicates parable or dialogue boundary risk.');
    }
    if (distinctCandidates.length > 1) {
        reasons.push(`Source conflict: ${distinctCandidates.length} distinct candidate texts were found.`);
    }
    if (bestCandidate && isReductionOrContaminationFile(bestCandidate.file)) {
        reasons.push('Best candidate comes from a reduction/contamination review file.');
    }
    const canAutoImport = !currentSpeechTextLAMSA
        && Boolean(candidateSpeechTextLAMSA)
        && rawWhitespaceMatch
        && reasons.length === 0;

    if (canAutoImport) {
        return {
            classification: AUTO_SAFE,
            reasons: ['Candidate matches current raw LAMSA text and passed conservative import guards.'],
            recommendedDecision: 'auto_import_candidate'
        };
    }

    return {
        classification: MANUAL_REVIEW,
        reasons: reasons.length ? reasons : ['Conservative fallback: candidate requires manual confirmation before import.'],
        recommendedDecision: 'manual_review_required'
    };
}

function chooseBestCandidate({ rawLamsa, candidates }) {
    if (!candidates.length) return null;
    return [...candidates].sort((a, b) => scoreCandidate(b, rawLamsa) - scoreCandidate(a, rawLamsa))[0];
}

function scoreCandidate(candidate, rawLamsa) {
    let score = 0;
    if (candidate.text === rawLamsa) score += 1000;
    if (normalizeWhitespace(candidate.text) === normalizeWhitespace(rawLamsa)) score += 800;
    if (path.basename(candidate.file).toLowerCase().includes('lamsa')) score += 100;
    if (!isReductionOrContaminationFile(candidate.file)) score += 25;
    const fieldIndex = CANDIDATE_FIELD_PRIORITY.indexOf(candidate.field);
    score += Math.max(0, 50 - fieldIndex);
    return score;
}

function collectReferencedCandidateFiles(rows) {
    const files = new Set();
    for (const row of rows) {
        splitList(row.candidateFiles)
            .map(resolveRootPath)
            .filter(file => fs.existsSync(file))
            .forEach(file => files.add(file));
    }
    return [...files].sort((a, b) => relativeToRoot(a).localeCompare(relativeToRoot(b)));
}

function buildCandidateIndex(files) {
    const index = new Map();
    for (const file of files) {
        const candidates = loadCandidatesFromFile(file);
        for (const candidate of candidates) {
            const key = candidateKey(file, candidate.verseId);
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(candidate);
        }
    }
    return index;
}

function loadCandidatesFromFile(file) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.csv') return loadCandidatesFromCsv(file);
    if (ext === '.json') return loadCandidatesFromJson(file);
    return [];
}

function loadCandidatesFromCsv(file) {
    return loadCsv(file).flatMap((row, index) => extractCandidateFromObject({
        object: row,
        file,
        location: `row ${index + 2}`
    }));
}

function loadCandidatesFromJson(file) {
    let parsed;
    try {
        parsed = readJson(file);
    } catch (error) {
        return [];
    }
    const candidates = [];
    visitJson(parsed, '$', (object, location, keyVerseId) => {
        candidates.push(...extractCandidateFromObject({
            object,
            file,
            location,
            keyVerseId
        }));
    });
    return candidates;
}

function extractCandidateFromObject({ object, file, location, keyVerseId }) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return [];
    const verseId = keyVerseId || findVerseId(object);
    if (!verseId) return [];
    if (!isLamsaCandidateObject(file, object)) return [];

    const lowerFieldMap = new Map(Object.keys(object).map(field => [field.toLowerCase(), field]));
    for (const candidateField of CANDIDATE_FIELD_PRIORITY) {
        const actualField = lowerFieldMap.get(candidateField.toLowerCase());
        if (!actualField) continue;
        const text = stringValue(object[actualField]).trim();
        if (!text) continue;
        return [{
            verseId,
            text,
            file,
            location,
            field: actualField,
            sourceKind: classifyCandidateSource(file)
        }];
    }

    return [];
}

function isLamsaCandidateObject(file, object) {
    const translationScope = TRANSLATION_FIELDS
        .map(field => stringValue(object[field]).trim())
        .find(Boolean);
    if (translationScope) return /^lamsa$/i.test(translationScope);
    if (path.basename(file).toLowerCase().includes('lamsa')) return true;
    return Object.keys(object).some(field => field.toLowerCase().includes('lamsa'));
}

function visitJson(value, location, onObject) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((entry, index) => visitJson(entry, `${location}[${index}]`, onObject));
        return;
    }

    if (findVerseId(value)) onObject(value, location, null);
    for (const [key, child] of Object.entries(value)) {
        if (/^(?:MAT|MRK|LUK|JHN|REV)_\d+_\d+$/.test(key)) {
            onObject(child, `${location}.${key}`, key);
        }
        if (child && typeof child === 'object') {
            visitJson(child, `${location}.${key}`, onObject);
        }
    }
}

function findVerseId(object) {
    for (const field of ['verseId', 'id', 'verse_id', 'verseID']) {
        const value = stringValue(object[field]).trim();
        if (/^(?:MAT|MRK|LUK|JHN|REV)_\d+_\d+$/.test(value)) return value;
    }
    return '';
}

function buildSummary(rows, candidateFiles) {
    return {
        inputCandidateExistsNotAppliedRows: rows.length,
        candidateFilesRead: candidateFiles.map(relativeToRoot),
        candidateFilesReadCount: candidateFiles.length,
        autoSafeCandidateImportCount: rows.filter(row => row.classification === AUTO_SAFE).length,
        needsManualReviewBeforeImportCount: rows.filter(row => row.classification === MANUAL_REVIEW).length,
        missingCandidateCount: rows.filter(row => !row.candidateSpeechTextLAMSA).length,
        sourceConflictCount: rows.filter(row => /Source conflict/i.test(row.classificationReason)).length,
        parableOrDialogueBoundaryCount: rows.filter(row => /parable|dialogue boundary/i.test(row.classificationReason)).length,
        narratorSetupCount: rows.filter(row => /narrator|speaker setup/i.test(row.classificationReason)).length
    };
}

function classifyCandidateSource(file) {
    const basename = path.basename(file).toLowerCase();
    if (/contamination/.test(basename)) return 'contamination_review';
    if (/reduction|reduce/.test(basename)) return 'reduction_review';
    if (/lamsa/.test(basename)) return 'lamsa_workflow';
    if (/candidate/.test(basename)) return 'candidate_review';
    return 'other_candidate_file';
}

function isReductionOrContaminationFile(file) {
    return /(?:reduction|reduce|contamination)/i.test(path.basename(file));
}

function summarizeCandidateFiles(candidates) {
    return [...new Set(candidates.map(candidate => relativeToRoot(candidate.file)))].sort().join('; ');
}

function getDistinctTexts(texts) {
    return [...new Set(texts.map(normalizeWhitespace).filter(Boolean))];
}

function candidateKey(file, verseId) {
    return `${relativeToRoot(file)}::${verseId}`;
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

function resolveRootPath(file) {
    return path.isAbsolute(file) ? file : path.join(ROOT, file.replace(/\//g, path.sep));
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
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

function normalizeWhitespace(text) {
    return stringValue(text).replace(/\s+/g, ' ').trim();
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

function printSummary(summary) {
    console.log('LAMSA candidate consolidation audit complete.');
    console.log(`Input candidate_exists_not_applied rows: ${summary.inputCandidateExistsNotAppliedRows}`);
    console.log(`Candidate files read: ${summary.candidateFilesReadCount}`);
    console.log(`Auto-safe candidate imports: ${summary.autoSafeCandidateImportCount}`);
    console.log(`Needs manual review before import: ${summary.needsManualReviewBeforeImportCount}`);
    console.log(`Missing candidates: ${summary.missingCandidateCount}`);
    console.log(`Source conflicts: ${summary.sourceConflictCount}`);
    console.log(`Parable/dialogue boundary rows: ${summary.parableOrDialogueBoundaryCount}`);
    console.log(`Narrator/setup rows: ${summary.narratorSetupCount}`);
    console.log(`JSON report saved to ${relativeToRoot(JSON_REPORT_FILE)}`);
    console.log(`CSV report saved to ${relativeToRoot(CSV_REPORT_FILE)}`);
}
