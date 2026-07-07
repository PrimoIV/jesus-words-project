const fs = require('fs');
const path = require('path');
const {
    getParableContextForVerseId
} = require('./load_jesus_discourse_context');

const ROOT = path.join(__dirname, '..');
const INPUT_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_regeneration_preview.json');
const JSON_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_candidate_audit.json');
const CSV_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_candidate_audit.csv');

const BLOCKER_PATTERNS = [
    { flag: 'leftover_speaker_attribution: starts with he said', regex: /^he\s+said\b/i },
    { flag: 'leftover_speaker_attribution: starts with saying', regex: /^saying\b/i },
    { flag: 'leftover_speaker_attribution: starts with then he said to his servants', regex: /^Then\s+he\s+said\s+to\s+his\s+servants\b/i },
    { flag: 'leftover_speaker_attribution: Jesus said', regex: /\bJesus\s+said\b/i },
    { flag: 'leftover_speaker_attribution: Jesus answered', regex: /\bJesus\s+answered\b/i },
    { flag: 'leftover_speaker_attribution: Jesus replied', regex: /\bJesus\s+replied\b/i },
    { flag: 'leftover_speaker_attribution: Jesus asked', regex: /\bJesus\s+asked\b/i },
    { flag: 'leftover_speaker_attribution: he said', regex: /\bhe\s+said\b/i, allowInParable: true },
    { flag: 'leftover_speaker_attribution: he answered', regex: /\bhe\s+answered\b/i, allowInParable: true },
    { flag: 'leftover_speaker_attribution: and he said', regex: /\band\s+he\s+said\b/i, allowInParable: true },
    { flag: 'leftover_speaker_attribution: saying comma', regex: /(?:^|[.!?]\s*)saying,\s*/i, allowInParable: true },
    { flag: 'leftover_speaker_attribution: saying to him', regex: /\bsaying\s+to\s+him\b/i, allowInParable: true },
    { flag: 'leftover_speaker_attribution: saying to them', regex: /\bsaying\s+to\s+them\b/i, allowInParable: true },
    { flag: 'embedded_non_jesus_narration: Jesus anticipated', regex: /\bJesus\s+anticipated\b/i },
    { flag: 'embedded_non_jesus_narration: Peter entered', regex: /\bPeter\s+entered\b/i },
    { flag: 'embedded_non_jesus_narration: they brought to him', regex: /\bthey\s+brought\s+to\s+him\b/i },
    { flag: 'embedded_non_jesus_narration: And they brought', regex: /\bAnd\s+they\s+brought\b/ },
    { flag: 'embedded_non_jesus_narration: and they brought', regex: /\band\s+they\s+brought\b/i },
    { flag: 'embedded_non_jesus_narration: they were amazed', regex: /\bthey\s+were\s+amazed\b/i },
    { flag: 'embedded_non_jesus_narration: they were afraid', regex: /\bthey\s+were\s+afraid\b/i },
    { flag: 'embedded_non_jesus_narration: they laughed at him', regex: /\bthey\s+laughed\s+at\s+him\b/i },
    { flag: 'embedded_non_jesus_narration: he stretched out his hand', regex: /\bhe\s+stretched\s+out\s+his\s+hand\b/i },
    { flag: 'embedded_non_jesus_narration: his leprosy was cleansed', regex: /\bhis\s+leprosy\s+was\s+cleansed\b/i },
    { flag: 'embedded_non_jesus_narration: was healed', regex: /\bwas\s+healed\b/i },
    { flag: 'embedded_non_jesus_narration: followed him', regex: /\bfollowed\s+him\b/i },
    { flag: 'other_speaker_material: They said to him', regex: /\bThey\s+said\s+to\s+him\b/ },
    { flag: 'other_speaker_material: Peter said', regex: /\bPeter\s+said\b/i },
    { flag: 'other_speaker_material: Thomas answered', regex: /\bThomas\s+answered\b/i },
    { flag: 'other_speaker_material: She said to him', regex: /\bShe\s+said\s+to\s+him\b/i },
    { flag: 'other_speaker_material: His servants then said', regex: /\bHis\s+servants\s+then\s+said\b/i, allowInParable: true },
    { flag: 'other_speaker_material: The disciples said', regex: /\bThe\s+disciples\s+said\b/i },
    { flag: 'other_speaker_material: The Jews said', regex: /\bThe\s+Jews\s+said\b/i },
    { flag: 'other_speaker_material: The Pharisees said', regex: /\bThe\s+Pharisees\s+said\b/i },
    { flag: 'other_speaker_material: We can', regex: /\bWe\s+can\b/ },
    { flag: 'other_speaker_material: We do not know', regex: /\bWe\s+do\s+not\s+know\b/i },
    { flag: 'gloss_editorial_contamination: which means', regex: /\bwhich\s+means\b/i },
    { flag: 'gloss_editorial_contamination: meaning', regex: /\bmeaning\b/i },
    { flag: 'gloss_editorial_contamination: that is to say', regex: /\bthat\s+is\s+to\s+say\b/i },
    { flag: 'gloss_editorial_contamination: bracketed editorial note', regex: /\[[^\]]*(?:idiom|synonym|Aramaic|literal|used by|translation|dialect|destiny)[^\]]*\]/i }
];

const REVIEW_PATTERNS = [
    { flag: 'suspicious_structure: starts lowercase', regex: /^[a-z]/ },
    { flag: 'suspicious_structure: dangling comma', regex: /,\s*$/ }
];

const RAW_NARRATION_PATTERN = /\b(?:Jesus\s+(?:said|answered|replied|asked|anticipated|stretched|saw|heard|commanded|began)|he\s+(?:said|answered)|and\s+he\s+said|saying|they\s+brought|was\s+healed|leprosy\s+was\s+cleansed|followed\s+him|they\s+laughed\s+at\s+him)\b/i;

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const preview = readJson(INPUT_FILE);
    const rows = (preview.rows || []).map(auditRow);
    const validationErrors = validate(rows);
    const summary = buildSummary(rows, validationErrors);
    const report = {
        generatedAt: new Date().toISOString(),
        inputFile: relativeToRoot(INPUT_FILE),
        outputs: {
            jsonReport: relativeToRoot(JSON_REPORT_FILE),
            csvReport: relativeToRoot(CSV_REPORT_FILE)
        },
        summary,
        validationErrors,
        rows
    };

    fs.mkdirSync(path.dirname(JSON_REPORT_FILE), { recursive: true });
    fs.writeFileSync(JSON_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(CSV_REPORT_FILE, toCsv(rows), 'utf8');

    printSummary(summary);

    if (validationErrors.length > 0) {
        console.error(`LAMSA speech candidate audit failed with ${validationErrors.length} validation error(s).`);
        validationErrors.forEach(error => console.error(`- ${error}`));
        process.exit(1);
    }
}

function auditRow(row) {
    const candidate = row.candidateSpeechTextLAMSA;
    const parableContext = getParableContextForVerseId(row.verseId);
    const inParableContext = Boolean(parableContext);
    const flags = [];

    if (candidate) {
        for (const pattern of BLOCKER_PATTERNS) {
            if (inParableContext && pattern.allowInParable) continue;
            if (pattern.regex.test(candidate)) flags.push(pattern.flag);
        }
        for (const pattern of REVIEW_PATTERNS) {
            if (pattern.regex.test(candidate) && !isDeliberateLowercaseStart(candidate)) {
                flags.push(pattern.flag);
            }
        }
        if (/\bfew this\b/i.test(candidate)) flags.push('source_corruption: few this');
    } else if (row.action !== 'manual_required') {
        flags.push('suspicious_structure: candidate null but action is not manual_required');
    }

    if (candidate && !inParableContext && candidate === row.rawLamsa && RAW_NARRATION_PATTERN.test(row.rawLamsa || '')) {
        flags.push('suspicious_structure: candidate identical to narrated raw');
    }

    const blockerFlags = flags.filter(flag => (
        flag.startsWith('leftover_speaker_attribution:')
        || flag.startsWith('embedded_non_jesus_narration:')
        || flag.startsWith('other_speaker_material:')
        || flag.startsWith('gloss_editorial_contamination:')
        || flag === 'source_corruption: few this'
        || flag === 'suspicious_structure: candidate null but action is not manual_required'
        || flag === 'suspicious_structure: candidate identical to narrated raw'
    ));

    const severity = blockerFlags.length > 0
        ? 'blocker'
        : (flags.length > 0 ? 'review' : 'info');

    return {
        verseId: row.verseId,
        reference: row.reference,
        action: row.action,
        confidence: row.confidence,
        parableContext: inParableContext,
        discourseTitle: parableContext?.title || null,
        candidateSpeechTextLAMSA: candidate || null,
        rawLamsa: row.rawLamsa,
        flags,
        severity,
        recommendedAction: getRecommendedAction(row.action, severity)
    };
}

function getRecommendedAction(action, severity) {
    if (severity === 'blocker') return 'downgrade_to_manual';
    if (severity === 'review' && action === 'auto_candidate_safe') return 'downgrade_to_review';
    if (action === 'auto_candidate_safe') return 'keep_auto_safe';
    if (action === 'manual_required') return 'manual_review';
    return severity === 'review' ? 'manual_review' : 'keep_auto_safe';
}

function validate(rows) {
    const errors = [];
    const byId = new Map(rows.map(row => [row.verseId, row]));

    const autoSafeBlockers = rows.filter(row => row.action === 'auto_candidate_safe' && row.severity === 'blocker');
    if (autoSafeBlockers.length > 0) {
        errors.push(`${autoSafeBlockers.length} auto_candidate_safe row(s) have blocker flags: ${autoSafeBlockers.map(row => row.verseId).join(', ')}`);
    }

    const fewThisRows = rows.filter(row => /\bfew this\b/i.test(row.candidateSpeechTextLAMSA || ''));
    if (fewThisRows.length > 0) {
        errors.push(`Candidate text contains "few this": ${fewThisRows.map(row => row.verseId).join(', ')}`);
    }

    if (/\bwhich\s+means\b/i.test(byId.get('MRK_15_34')?.candidateSpeechTextLAMSA || '') || /\[[^\]]+\]/.test(byId.get('MRK_15_34')?.candidateSpeechTextLAMSA || '')) {
        errors.push('MRK_15_34 candidate contains "which means" or a bracketed note');
    }
    if (/\bThis\s+was\s+my\s+destiny\b/i.test(byId.get('MAT_27_46')?.candidateSpeechTextLAMSA || '') || /\[[^\]]+\]/.test(byId.get('MAT_27_46')?.candidateSpeechTextLAMSA || '')) {
        errors.push('MAT_27_46 candidate contains "This was my destiny" or a bracketed note');
    }
    if (/\b(?:Peter\s+entered|Jesus\s+anticipated)\b/i.test(byId.get('MAT_17_25')?.candidateSpeechTextLAMSA || '')) {
        errors.push('MAT_17_25 candidate contains "Peter entered" or "Jesus anticipated"');
    }
    if (/\bthey\s+brought\b/i.test(byId.get('MAT_22_19')?.candidateSpeechTextLAMSA || '')) {
        errors.push('MAT_22_19 candidate contains "they brought"');
    }

    return errors;
}

function buildSummary(rows, validationErrors) {
    const autoSafeRows = rows.filter(row => row.action === 'auto_candidate_safe');
    const reviewRows = rows.filter(row => row.action === 'review_required');

    return {
        totalRows: rows.length,
        totalCandidatesPresent: rows.filter(row => row.candidateSpeechTextLAMSA).length,
        autoSafeCandidatesAudited: autoSafeRows.length,
        autoSafeCandidatesFlaggedBlocker: autoSafeRows.filter(row => row.severity === 'blocker').length,
        autoSafeCandidatesFlaggedReview: autoSafeRows.filter(row => row.severity === 'review').length,
        reviewRequiredCandidatesFlagged: reviewRows.filter(row => row.flags.length > 0).length,
        manualRequiredRows: rows.filter(row => row.action === 'manual_required').length,
        cleanAutoSafeCount: autoSafeRows.filter(row => row.flags.length === 0).length,
        cleanReviewRequiredCount: reviewRows.filter(row => row.flags.length === 0).length,
        validationPassed: validationErrors.length === 0
    };
}

function isDeliberateLowercaseStart(candidate) {
    return /^(?:for|and|but|or|from|to|in|of|if|when|where)\b/.test(candidate);
}

function toCsv(rows) {
    const headers = [
        'verseId',
        'reference',
        'action',
        'confidence',
        'parableContext',
        'discourseTitle',
        'candidateSpeechTextLAMSA',
        'rawLamsa',
        'flags',
        'severity',
        'recommendedAction'
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

function printSummary(summary) {
    console.log('LAMSA speech candidate audit complete.');
    console.log(`Total rows: ${summary.totalRows}`);
    console.log(`Total candidates present: ${summary.totalCandidatesPresent}`);
    console.log(`Auto-safe candidates audited: ${summary.autoSafeCandidatesAudited}`);
    console.log(`Auto-safe candidates flagged blocker: ${summary.autoSafeCandidatesFlaggedBlocker}`);
    console.log(`Auto-safe candidates flagged review: ${summary.autoSafeCandidatesFlaggedReview}`);
    console.log(`Review-required candidates flagged: ${summary.reviewRequiredCandidatesFlagged}`);
    console.log(`Manual-required rows: ${summary.manualRequiredRows}`);
    console.log(`Clean auto-safe count: ${summary.cleanAutoSafeCount}`);
    console.log(`Clean review-required count: ${summary.cleanReviewRequiredCount}`);
    console.log(`Validation passed: ${summary.validationPassed}`);
    console.log(`JSON report saved to ${relativeToRoot(JSON_REPORT_FILE)}`);
    console.log(`CSV report saved to ${relativeToRoot(CSV_REPORT_FILE)}`);
}
