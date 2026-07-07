const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'dev', 'reports');
const BASELINE_FILE = path.join(REPORT_DIR, 'speech_manual_review_sheet.csv');
const INPUT_FILE = path.join(REPORT_DIR, 'speech_manual_review_sheet_candidates_filled.csv');
const OUTPUT_FILE = path.join(REPORT_DIR, 'speech_candidate_audit.json');

function main() {
    let baseline;
    let filled;
    try {
        baseline = loadCsv(BASELINE_FILE, 'baseline manual review sheet');
        filled = loadCsv(INPUT_FILE, 'filled candidate sheet');
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    ensureColumns(filled.headers, [
        'id',
        'reference',
        'translationKey',
        'rawText',
        'flags',
        'notes',
        'suggestedManualSpeechText',
        'approvalStatus',
        'reviewNote'
    ]);

    const findings = {
        blankSuggestedManualSpeechText: [],
        leadingTrailingWhitespace: [],
        rawNarrationMarkersStillPresent: [],
        likelyOtherSpeakerContamination: [],
        bracketedText: [],
        parentheticalTranslatorGlosses: [],
        autoCandidateSafeWithRiskMarkers: [],
        approvedRowsChangedAccidentally: [],
        rawTextChangedAccidentally: [],
        identicalRawWithNarration: []
    };

    compareRawTextRows(baseline, filled, findings);
    compareApprovedRows(baseline, filled, findings);

    const summary = {
        totalRows: filled.rows.length,
        approvedRows: 0,
        autoCandidateSafeRows: 0,
        reviewNeededRows: 0,
        manualRequiredRows: 0,
        blankCandidateRows: 0,
        contaminationRiskRows: 0,
        bracketedRows: 0,
        parentheticalRows: 0
    };

    filled.rows.forEach(row => {
        const status = getStatus(row);
        const candidate = stringValue(row.suggestedManualSpeechText);
        const rawText = stringValue(row.rawText);
        const parableContext = isParableContext(row, rawText);
        const narrationMatches = getNarrationMatches(candidate, row, parableContext);
        const otherSpeakerMatches = getOtherSpeakerMatches(candidate, parableContext);
        const bracketMatches = candidate.match(/\[[^\]]+\]/g) || [];
        const parentheticalMatches = candidate.match(/\([^)]*\)/g) || [];
        const quoteRisk = getQuoteRisk(candidate);
        const riskMarkers = narrationMatches
            .map(label => `narration:${label}`)
            .concat(otherSpeakerMatches.map(label => `other-speaker:${label}`))
            .concat(bracketMatches.map(value => `bracket:${value}`))
            .concat(parentheticalMatches.map(value => `parenthetical:${value}`))
            .concat(quoteRisk);

        if (status === 'approved') summary.approvedRows += 1;
        if (status === 'auto_candidate_safe') summary.autoCandidateSafeRows += 1;
        if (status === 'review_needed') summary.reviewNeededRows += 1;
        if (status === 'manual_required') summary.manualRequiredRows += 1;

        if (!candidate.trim()) {
            summary.blankCandidateRows += 1;
            findings.blankSuggestedManualSpeechText.push(example(row, { reason: 'Blank suggestedManualSpeechText.' }));
        }

        if (candidate !== candidate.trim()) {
            findings.leadingTrailingWhitespace.push(example(row, { reason: 'suggestedManualSpeechText has leading/trailing whitespace.' }));
        }

        if (narrationMatches.length > 0) {
            findings.rawNarrationMarkersStillPresent.push(example(row, {
                matches: narrationMatches,
                candidate: truncate(candidate, 220)
            }));
        }

        if (otherSpeakerMatches.length > 0) {
            findings.likelyOtherSpeakerContamination.push(example(row, {
                matches: otherSpeakerMatches,
                candidate: truncate(candidate, 220)
            }));
        }

        if (bracketMatches.length > 0) {
            findings.bracketedText.push(example(row, {
                brackets: bracketMatches,
                candidate: truncate(candidate, 220)
            }));
        }

        if (parentheticalMatches.length > 0) {
            findings.parentheticalTranslatorGlosses.push(example(row, {
                parentheticals: parentheticalMatches,
                candidate: truncate(candidate, 220)
            }));
        }

        if (riskMarkers.length > 0) {
            summary.contaminationRiskRows += narrationMatches.length > 0 || otherSpeakerMatches.length > 0 ? 1 : 0;
        }
        if (bracketMatches.length > 0) summary.bracketedRows += 1;
        if (parentheticalMatches.length > 0) summary.parentheticalRows += 1;

        if (status === 'auto_candidate_safe' && riskMarkers.length > 0) {
            findings.autoCandidateSafeWithRiskMarkers.push(example(row, {
                riskMarkers,
                candidate: truncate(candidate, 220)
            }));
        }

        if (
            status !== 'approved' &&
            candidate.trim() &&
            normalizeForCompare(candidate) === normalizeForCompare(rawText) &&
            hasObviousNarration(rawText, row, parableContext)
        ) {
            findings.identicalRawWithNarration.push(example(row, {
                reason: 'suggestedManualSpeechText is identical to rawText while rawText has obvious narration.',
                candidate: truncate(candidate, 220)
            }));
        }
    });

    const failures = [];
    findings.approvedRowsChangedAccidentally.forEach(item => {
        failures.push(`Approved row changed: row ${item.rowNumber} ${item.id} ${item.translationKey}.`);
    });
    findings.rawTextChangedAccidentally.forEach(item => {
        failures.push(`rawText changed: row ${item.rowNumber} ${item.id} ${item.translationKey}.`);
    });
    findings.autoCandidateSafeWithRiskMarkers
        .filter(item => item.riskMarkers.some(marker => marker.startsWith('narration:') || marker.startsWith('other-speaker:')))
        .forEach(item => {
            failures.push(`auto_candidate_safe contains obvious contamination: row ${item.rowNumber} ${item.id} ${item.translationKey}.`);
        });
    findings.identicalRawWithNarration.forEach(item => {
        failures.push(`Candidate equals raw narration: row ${item.rowNumber} ${item.id} ${item.translationKey}.`);
    });

    const audit = {
        generatedAt: new Date().toISOString(),
        sourceFile: relativePath(INPUT_FILE),
        baselineFile: relativePath(BASELINE_FILE),
        outputFile: relativePath(OUTPUT_FILE),
        summary,
        failures,
        findings
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');

    console.log('Speech candidate audit summary:');
    console.log(`Total rows: ${summary.totalRows}`);
    console.log(`Approved rows: ${summary.approvedRows}`);
    console.log(`auto_candidate_safe rows: ${summary.autoCandidateSafeRows}`);
    console.log(`review_needed rows: ${summary.reviewNeededRows}`);
    console.log(`manual_required rows: ${summary.manualRequiredRows}`);
    console.log(`Blank candidate rows: ${summary.blankCandidateRows}`);
    console.log(`Contamination-risk rows: ${summary.contaminationRiskRows}`);
    console.log(`Bracketed rows: ${summary.bracketedRows}`);
    console.log(`Parenthetical rows: ${summary.parentheticalRows}`);
    console.log(`Output file: ${relativePath(OUTPUT_FILE)}`);

    if (failures.length > 0) {
        console.error('Speech candidate audit failed:');
        failures.slice(0, 80).forEach(failure => console.error(`- ${failure}`));
        if (failures.length > 80) {
            console.error(`...and ${failures.length - 80} more failure(s).`);
        }
        process.exit(1);
    }

    console.log('Speech candidate audit passed.');
}

function compareRawTextRows(baseline, filled, findings) {
    baseline.rows.forEach((baselineRow, index) => {
        const filledRow = filled.rows[index];
        if (!filledRow) return;
        if (stringValue(baselineRow.rawText) === stringValue(filledRow.rawText)) return;

        findings.rawTextChangedAccidentally.push({
            rowNumber: baselineRow.__rowNumber || index + 2,
            id: stringValue(baselineRow.id),
            reference: stringValue(baselineRow.reference),
            translationKey: stringValue(baselineRow.translationKey),
            before: truncate(stringValue(baselineRow.rawText), 220),
            after: truncate(stringValue(filledRow.rawText), 220)
        });
    });
}

function compareApprovedRows(baseline, filled, findings) {
    baseline.rows.forEach((baselineRow, index) => {
        if (getStatus(baselineRow) !== 'approved') return;

        const filledRow = filled.rows[index];
        if (!filledRow) {
            findings.approvedRowsChangedAccidentally.push({
                rowNumber: baselineRow.__rowNumber || index + 2,
                id: stringValue(baselineRow.id),
                translationKey: stringValue(baselineRow.translationKey),
                reason: 'Approved baseline row is missing from filled sheet.'
            });
            return;
        }

        const changedFields = baseline.headers
            .filter(header => stringValue(baselineRow[header]) !== stringValue(filledRow[header]))
            .map(header => ({
                field: header,
                before: truncate(stringValue(baselineRow[header]), 160),
                after: truncate(stringValue(filledRow[header]), 160)
            }));

        if (changedFields.length === 0) return;

        findings.approvedRowsChangedAccidentally.push({
            rowNumber: baselineRow.__rowNumber || index + 2,
            id: stringValue(baselineRow.id),
            reference: stringValue(baselineRow.reference),
            translationKey: stringValue(baselineRow.translationKey),
            changedFields
        });
    });
}

function hasObviousNarration(text, row, parableContext) {
    if (!text.trim()) return false;
    if (getNarrationMatches(text, row, parableContext).length > 0) return true;
    if (hasExternalLongQuotePrefix(text, row)) return true;
    if (hasOtherSpeakerFormula(text) && !isEmbeddedSpeechReport(text) && !parableContext) return true;
    return false;
}

function hasExternalLongQuotePrefix(text, row) {
    const quoteIndex = firstQuoteIndex(text);
    if (quoteIndex < 0 || quoteIndex > 120) return false;
    const prefix = text.slice(0, quoteIndex);
    if (countNonSpace(prefix) < 18) return false;
    return /\bJesus\s+(?:said|says|answered|replied|asked|told|ordered|commanded|charged|began|rebuked|cried|called|went|came|saw|heard|looked|turned|knew|spoke)\b/i.test(prefix) ||
        /\bhe\s+(?:said|says|answered|replied|asked|told|ordered|commanded|charged|prayed)\b/i.test(prefix) ||
        splitList(row.flags).some(flag => ['long_prefix_before_quote', 'pre_speech_narration'].includes(flag));
}

function firstQuoteIndex(text) {
    const indexes = ['“', '"', '‘']
        .map(char => text.indexOf(char))
        .filter(index => index >= 0);
    return indexes.length > 0 ? Math.min(...indexes) : -1;
}

function getQuoteRisk(text) {
    const leftDouble = countMatches(text, /“/g);
    const rightDouble = countMatches(text, /”/g);
    const straightDouble = countMatches(text, /"/g);
    const leftSingle = countMatches(text, /‘/g);

    const risks = [];
    if (leftDouble !== rightDouble) risks.push('quote:unmatched curly double quotes');
    if (straightDouble % 2 !== 0) risks.push('quote:unmatched straight double quote');
    if (leftSingle > 0 && countMatches(text, /’/g) < leftSingle) risks.push('quote:unmatched curly single quote');
    return risks;
}

function getNarrationMatches(text, row, parableContext) {
    if (!text) return [];

    return NARRATION_PATTERNS
        .filter(pattern => {
            if (parableContext && !pattern.checkInParable) return false;
            if (pattern.exception && pattern.exception(text, row)) return false;
            return pattern.regex.test(text);
        })
        .map(pattern => pattern.label);
}

function getOtherSpeakerMatches(text, parableContext) {
    if (!text || (parableContext && !/^\s*(?:They|Peter|Thomas|She|His\s+disciples|The\s+disciples)\b/i.test(text))) {
        return [];
    }

    if (isEmbeddedSpeechReport(text)) return [];

    return OTHER_SPEAKER_FORMULA_PATTERNS
        .filter(pattern => pattern.regex.test(text))
        .map(pattern => pattern.label);
}

function isParableContext(row, text) {
    const combined = `${row.reference || ''} ${row.rawText || ''} ${row.bsbAnchor || ''} ${row.notes || ''} ${text || ''}`;
    if (/\bparable\b/i.test(combined)) return true;
    if (/\bkingdom\s+of\s+(?:heaven|God)\s+(?:may\s+be\s+compared|is\s+like)\b/i.test(combined)) return true;
    if (/\b(?:master|lord|servant|slave|slaves|talents?|minas?|bridegroom|bridesmaids?|virgins?|tenants?|vineyard|landowner|steward|manager|rich\s+man|father|son|sons)\b/i.test(combined) &&
        /\b(?:said|replied|answered|went|came|gave|received|owed|entrusted)\b/i.test(combined) &&
        /(?:Matthew 13|Matthew 18|Matthew 20|Matthew 21|Matthew 22|Matthew 24|Matthew 25|Mark 4|Luke 10|Luke 12|Luke 14|Luke 15|Luke 16|Luke 19)/i.test(combined)) {
        return true;
    }
    return false;
}

function isEmbeddedSpeechReport(text) {
    return /\b(?:many|people|they|you|those|everyone|whoever)\s+(?:will\s+)?say\b/i.test(text) ||
        /\b(?:it\s+was\s+said|you\s+have\s+heard\s+it\s+was\s+said|you\s+say|they\s+said\s+he\s+is|they\s+say)\b/i.test(text);
}

function hasOtherSpeakerFormula(text) {
    return OTHER_SPEAKER_FORMULA_PATTERNS.some(pattern => pattern.regex.test(text));
}

const OTHER_SPEAKER_FORMULA_PATTERNS = [
    { label: 'They said to him', regex: /\bThey\s+(?:said|say)\s+to\s+him\b/i },
    { label: 'They answered', regex: /\bThey\s+(?:answered|replied)\b/i },
    { label: 'And they said', regex: /\bAnd\s+they\s+(?:said|answered|replied)\b/i },
    { label: 'Peter said', regex: /\b(?:Simon\s+)?Peter\s+(?:said|answered|replied)\b/i },
    { label: 'Thomas answered', regex: /\bThomas\s+(?:said|answered|replied)\b/i },
    { label: 'She said to him', regex: /\bShe\s+said\s+to\s+him\b/i },
    { label: 'The disciples said', regex: /\b(?:His\s+|The\s+)?disciples\s+(?:said|asked|answered|replied)\b/i },
    { label: 'The Pharisees asked', regex: /\b(?:some\s+of\s+the\s+|the\s+)?Pharisees\s+(?:said|asked|answered|replied)\b/i },
    { label: 'Named group said', regex: /\b(?:Jews|crowds?|priests|elders|scribes|Sadducees|blind\s+men)\s+(?:said|asked|answered|replied)\b/i }
];

const NARRATION_PATTERNS = [
    {
        label: 'Jesus said',
        regex: /\bJesus\s+(?:said|says|answered|replied|asked|told|ordered|commanded|charged|began)\b/i,
        checkInParable: true,
        exception: text => /\bI\s+Jesus\s+(?:sent|have)\b/i.test(text)
    },
    {
        label: 'Then Jesus',
        regex: /\b(?:Then|And|But|When|As|After|While)\s+Jesus\s+(?:said|says|answered|replied|asked|told|ordered|commanded|charged|began|rebuked|cried|called|went|came|saw|heard|looked|turned|knew|spoke)\b/i,
        checkInParable: true
    },
    {
        label: 'he said to them',
        regex: /\bhe\s+(?:said|says|answered|replied|asked|told)\s+to\s+(?:him|them|her|Peter)\b/i,
        checkInParable: false
    },
    {
        label: 'disciples fleeing/following narration',
        regex: /\b(?:disciples|crowds?|people)\b[^.!?]{0,80}\b(?:fled|deserted|followed|went\s+away)\b/i,
        checkInParable: false
    },
    {
        label: 'healing result narration',
        regex: /\b(?:servant|boy|daughter|woman|eyes|leprosy|skin\s+disease)\b[^.!?]{0,80}\b(?:healed|cleansed|opened|left\s+him)\b/i,
        checkInParable: false
    }
];

function loadCsv(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing ${label}: ${relativePath(filePath)}`);
    }

    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const table = parseCsv(text);
    if (table.length === 0) return { headers: [], rows: [] };

    const headers = table[0].map(header => header.trim());
    const rows = table.slice(1)
        .filter(cells => cells.some(cell => stringValue(cell).trim() !== ''))
        .map((cells, index) => {
            const row = { __rowNumber: index + 2 };
            headers.forEach((header, columnIndex) => {
                row[header] = cells[columnIndex] === undefined ? '' : cells[columnIndex];
            });
            return row;
        });

    return { headers, rows };
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

function ensureColumns(headers, requiredColumns) {
    const missing = requiredColumns.filter(column => !headers.includes(column));
    if (missing.length > 0) {
        throw new Error(`Filled candidate sheet is missing required column(s): ${missing.join(', ')}`);
    }
}

function example(row, extra = {}) {
    return {
        rowNumber: row.__rowNumber,
        id: stringValue(row.id),
        reference: stringValue(row.reference),
        translationKey: stringValue(row.translationKey),
        approvalStatus: stringValue(row.approvalStatus),
        ...extra
    };
}

function splitList(value) {
    return stringValue(value)
        .split(';')
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeForCompare(value) {
    return stringValue(value)
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function countNonSpace(text) {
    return (stringValue(text).match(/\S/g) || []).length;
}

function countMatches(text, regex) {
    return (stringValue(text).match(regex) || []).length;
}

function getStatus(row) {
    return stringValue(row.approvalStatus).trim().toLowerCase();
}

function stringValue(value) {
    return typeof value === 'string' ? value : '';
}

function truncate(value, maxLength) {
    const text = stringValue(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}...`;
}

function relativePath(filePath) {
    return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

main();
