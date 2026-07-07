const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'dev', 'reports');
const INPUT_FILE = path.join(REPORT_DIR, 'jesus_verses_with_speech_candidates_reduced.json');
const REVIEW_CSV = path.join(REPORT_DIR, 'speech_manual_review_sheet.csv');
const OUTPUT_FILE = path.join(REPORT_DIR, 'jesus_verses_with_manual_speech_applied.json');
const REPORT_FILE = path.join(REPORT_DIR, 'speech_manual_override_apply_report.json');

const TRANSLATION_KEYS = ['NRSVUE', 'DBH', 'LAMSA'];
const NON_EMPTY_STATUSES = new Set(['candidate', 'clean_raw', 'verified']);
const FAIL_PATTERNS = [
    { label: 'leading addressee fragment', regex: /^to\s+(?:him|her|them),\s*/i },
    { label: 'leading saying formula', regex: /^saying\s+to\s+(?:him|her|them),\s*/i },
    { label: 'leading plainly formula', regex: /^plainly,\s*/i },
    { label: 'Jesus said', regex: /\bJesus\s+said\b/i },
    { label: 'Jesus says', regex: /\bJesus\s+says\b/i },
    { label: 'Jesus answered', regex: /\bJesus\s+answered\b/i },
    { label: 'Jesus replied', regex: /\bJesus\s+replied\b/i },
    { label: 'Jesus then said', regex: /\bJesus\s+then\s+said\b/i },
    { label: 'Jesus began', regex: /\bJesus\s+began\b/i },
    { label: 'Jesus looked', regex: /\bJesus\s+looked\b/i },
    { label: 'Jesus sent', regex: /\bJesus\s+sent\b/i },
    { label: 'Jesus spoke', regex: /\bJesus\s+spoke\b/i },
    { label: 'Jesus charged', regex: /\bJesus\s+charged\b/i },
    { label: 'Then Jesus', regex: /\bThen\s+Jesus\b/i },
    { label: 'And Jesus', regex: /\bAnd\s+Jesus\b/i },
    { label: 'But Jesus', regex: /\bBut\s+Jesus\b/i },
    { label: 'When Jesus', regex: /\bWhen\s+Jesus\b/i },
    { label: 'When he entered', regex: /\bWhen\s+he\s+entered\b/i },
    { label: 'he said to them', regex: /\bhe\s+said\s+to\s+them\b/i },
    { label: 'he said to him', regex: /\bhe\s+said\s+to\s+him\b/i },
    { label: 'he said to Peter', regex: /\bhe\s+said\s+to\s+Peter\b/i },
    { label: 'he pointed and said', regex: /\bhe\s+pointed\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'he spoke and said', regex: /\bhe\s+spoke\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'he turned and said', regex: /\bhe\s+turned\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'he looked and said', regex: /\bhe\s+looked\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'he touched and said', regex: /\bhe\s+touched\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'he stretched and said', regex: /\bhe\s+stretched\b[^.!?]{0,80}\bsaid\b/i },
    { label: 'charged them and said', regex: /\bcharged\s+them\s+and\s+said\b/i },
    { label: 'said to him, Yes', regex: /\bsaid\s+to\s+him,\s*Yes\b/i },
    { label: 'They said to him', regex: /\bThey\s+said\s+to\s+him\b/i },
    { label: 'They say to him', regex: /\bThey\s+say\s+to\s+him\b/i },
    { label: 'They reasoned', regex: /\bthey\s+(?:reasoned|discussed)\s+(?:with|among)\s+themselves\b/i },
    { label: 'Peter said', regex: /\bPeter\s+said\b/i },
    { label: 'Thomas answered', regex: /\bThomas\s+answered\b/i },
    { label: 'She said to him', regex: /\bShe\s+said\s+to\s+him\b/i },
    { label: 'And immediately', regex: /\bAnd\s+immediately\b/i },
    { label: 'Immediately he', regex: /\bImmediately\s+he\b/i },
    { label: 'Immediately his', regex: /\bImmediately\s+his\b/i },
    { label: 'servant was healed', regex: /\bservant\s+was\s+healed\b/i },
    { label: 'boy was healed', regex: /\bboy\s+was\s+healed\b/i },
    { label: 'woman was healed', regex: /\bwoman\s+was\s+healed\b/i },
    { label: 'daughter was healed', regex: /\bdaughter\s+was\s+healed\b/i },
    { label: 'leprosy left him', regex: /\bleprosy\s+left\s+him\b/i },
    { label: 'skin disease was cleansed', regex: /\bskin\s+disease\s+was\s+cleansed\b/i },
    { label: 'followed him', regex: /\bfollowed\s+him\b/i },
    { label: 'got up and followed', regex: /\bgot\s+up\s+and\s+followed\b/i },
    { label: 'laughed at him', regex: /\blaughed\s+at\s+him\b/i }
];

main();

function main() {
    let dataset;
    let reviewRows;
    try {
        dataset = loadJson(INPUT_FILE, 'reduced speech candidates');
        reviewRows = loadCsv(REVIEW_CSV, 'manual review sheet');
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    const output = JSON.parse(JSON.stringify(dataset));
    const failedRows = [];
    let approvedCount = 0;
    let rejectedCount = 0;
    let skippedCount = 0;
    let appliedCount = 0;
    let failedPurityCount = 0;

    reviewRows.forEach((row, index) => {
        const approvalStatus = stringValue(row.approvalStatus).trim().toLowerCase();
        const id = stringValue(row.id).trim();
        const translationKey = stringValue(row.translationKey).trim();
        const reviewNote = stringValue(row.reviewNote).trim();
        const suggestedText = stringValue(row.suggestedManualSpeechText).trim();

        if (!approvalStatus || approvalStatus === 'skip') {
            skippedCount += 1;
            return;
        }

        if (!id || !TRANSLATION_KEYS.includes(translationKey) || !output[id]) {
            failedRows.push(buildFailure(row, index, 'Row does not match a known verse id and translation key.'));
            return;
        }

        ensureSpeechContainers(output[id], translationKey);

        if (approvalStatus === 'approved') {
            approvedCount += 1;
            if (!suggestedText) {
                failedRows.push(buildFailure(row, index, 'Approved row has blank suggestedManualSpeechText.'));
                return;
            }

            const purityMatches = getPurityMatches(suggestedText);
            if (purityMatches.length > 0) {
                failedPurityCount += 1;
                failedRows.push(buildFailure(row, index, `Approved text failed purity guard: ${purityMatches.join('; ')}.`));
                return;
            }

            output[id].speechText[translationKey] = suggestedText;
            output[id].speechStatus[translationKey] = 'verified';
            output[id].speechAudit[translationKey].source = 'manual_override';
            appendAuditNote(output[id], translationKey, reviewNote || 'Manual override approved.');
            appliedCount += 1;
            return;
        }

        if (approvalStatus === 'reject') {
            rejectedCount += 1;
            output[id].speechText[translationKey] = '';
            output[id].speechStatus[translationKey] = 'rejected';
            output[id].speechAudit[translationKey].source = 'manual_reject';
            appendAuditNote(output[id], translationKey, reviewNote || 'Manual review rejected this row.');
            appliedCount += 1;
            return;
        }

        failedRows.push(buildFailure(row, index, `Unknown approvalStatus "${row.approvalStatus}". Expected approved, reject, skip, or blank.`));
    });

    const countBySpeechStatus = countStatuses(output);
    const report = {
        generatedAt: new Date().toISOString(),
        sourceFile: path.relative(ROOT, INPUT_FILE).replace(/\\/g, '/'),
        reviewFile: path.relative(ROOT, REVIEW_CSV).replace(/\\/g, '/'),
        totalReviewRows: reviewRows.length,
        approvedCount,
        rejectedCount,
        skippedCount,
        appliedCount,
        failedPurityCount,
        failedRows,
        remainingNeedsReviewCount: countBySpeechStatus.needs_review || 0,
        verifiedCount: countBySpeechStatus.verified || 0,
        rejectedCountFinal: countBySpeechStatus.rejected || 0,
        countBySpeechStatus
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    printSummary(report);
}

function loadJson(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing ${label}: ${path.relative(ROOT, filePath).replace(/\\/g, '/')}`);
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Could not parse ${path.relative(ROOT, filePath).replace(/\\/g, '/')}: ${error.message}`);
    }
}

function loadCsv(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing ${label}: ${path.relative(ROOT, filePath).replace(/\\/g, '/')}`);
    }

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

function ensureSpeechContainers(record, translationKey) {
    if (!record.speechText) record.speechText = {};
    if (!record.speechStatus) record.speechStatus = {};
    if (!record.speechAudit) record.speechAudit = {};
    if (!record.speechAudit[translationKey]) {
        record.speechAudit[translationKey] = {
            source: 'blank',
            severity: '',
            flags: [],
            confidence: 0,
            recommendedAction: '',
            notes: []
        };
    }
    if (!Array.isArray(record.speechAudit[translationKey].notes)) {
        record.speechAudit[translationKey].notes = [];
    }
}

function appendAuditNote(record, translationKey, note) {
    if (!note) return;
    record.speechAudit[translationKey].notes.push(note);
}

function getPurityMatches(text) {
    return FAIL_PATTERNS
        .filter(pattern => pattern.regex.test(text))
        .map(pattern => pattern.label);
}

function buildFailure(row, index, reason) {
    return {
        rowNumber: index + 2,
        id: stringValue(row.id),
        reference: stringValue(row.reference),
        translationKey: stringValue(row.translationKey),
        approvalStatus: stringValue(row.approvalStatus),
        reason
    };
}

function countStatuses(dataset) {
    const counts = {
        verified: 0,
        candidate: 0,
        needs_review: 0,
        needs_review_text_present: 0,
        clean_raw: 0,
        rejected: 0
    };

    Object.values(dataset).forEach(record => {
        TRANSLATION_KEYS.forEach(translationKey => {
            const status = stringValue(record.speechStatus?.[translationKey]);
            counts[status] = (counts[status] || 0) + 1;
        });
    });

    return counts;
}

function printSummary(report) {
    console.log('Speech manual overrides applied.');
    console.log(`Total review rows: ${report.totalReviewRows}`);
    console.log(`Approved rows: ${report.approvedCount}`);
    console.log(`Rejected rows: ${report.rejectedCount}`);
    console.log(`Skipped rows: ${report.skippedCount}`);
    console.log(`Applied rows: ${report.appliedCount}`);
    console.log(`Failed purity rows: ${report.failedPurityCount}`);
    console.log(`Remaining needs_review: ${report.remainingNeedsReviewCount}`);
    console.log('Output files:');
    console.log(`- ${path.relative(ROOT, OUTPUT_FILE).replace(/\\/g, '/')}`);
    console.log(`- ${path.relative(ROOT, REPORT_FILE).replace(/\\/g, '/')}`);
}

function stringValue(value) {
    return typeof value === 'string' ? value : '';
}
