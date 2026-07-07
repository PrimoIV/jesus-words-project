const fs = require('fs');
const path = require('path');
const {
    getParableContextForVerseId,
    isParableContextVerseId,
    parseVerseId
} = require('./load_jesus_discourse_context');

const ROOT = path.join(__dirname, '..');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const APPLY_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_source_replacement_apply_report.json');
const BACKUP_DATASET_FILE = path.join(ROOT, 'dev/backups/jesus_verses_final.before_lamsa_epub_replacement.json');
const JSON_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_regeneration_preview.json');
const CSV_REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_speech_regeneration_preview.csv');

const EXPECTED_CHANGED_COUNT = 305;
const SPECIAL_CANDIDATES = {
    MAT_27_46: 'Eli, Eli, lemana shabakthani! My God, my God, for this I was spared!',
    MRK_15_34: 'Eli, Eli, lemana, shabakthani! My God, my God, for this I was spared!',
    MAT_8_3: 'I do wish it, be cleansed.',
    MRK_4_40: 'Why are you so fearful? and why do you have no faith?',
    MRK_4_35: 'Let us cross over to the landing place.',
    MAT_17_25: 'What do you think, Simon? From whom do the kings of the earth collect custom duties and head tax? from their sons, or from strangers?',
    MAT_22_19: 'Show me the head tax penny.',
    MAT_26_75: 'Before the cock crows, you will deny me three times.',
    MAT_28_9: 'Peace be to you.'
};

const REQUIRED_CANDIDATE_EXACT = {
    MAT_13_28: 'An enemy did this. His servants then said to him, Do you want us to go and pull them out?',
    MRK_4_35: 'Let us cross over to the landing place.',
    MAT_17_25: 'What do you think, Simon? From whom do the kings of the earth collect custom duties and head tax? from their sons, or from strangers?',
    MAT_22_19: 'Show me the head tax penny.',
    MAT_26_75: 'Before the cock crows, you will deny me three times.',
    MAT_28_9: 'Peace be to you.'
};

const REQUIRED_CANDIDATE_STARTS = {
    MAT_4_4: 'It is written',
    MAT_11_4: 'Go and describe',
    MAT_13_11: 'Because to you',
    MAT_13_37: 'He who sowed',
    MAT_17_11: 'Elijah will come',
    MAT_20_13: 'My friend',
    MAT_20_22: 'You do not know',
    MAT_21_21: 'Truly I say to you',
    MAT_21_24: 'I will also ask you',
    MAT_22_29: 'You err'
};

const SPECIAL_CHECK_IDS = [
    'MAT_27_46',
    'MRK_15_34',
    'MAT_8_3',
    'MRK_4_40',
    ...Object.keys(REQUIRED_CANDIDATE_EXACT),
    ...Object.keys(REQUIRED_CANDIDATE_STARTS)
];

const BOOK_ORDER = new Map([
    ['MAT', 1],
    ['MRK', 2],
    ['LUK', 3],
    ['JHN', 4],
    ['REV', 5]
]);

const PARABLE_REVIEW_REASON = 'Parable-internal dialogue preserved; review required.';

const SPEAKER_SETUP_PATTERNS = [
    {
        label: 'Jesus narrative attribution',
        regex: /^(?:And|But|Then|So|Now)?\s*Jesus\b[\s\S]{0,180}?\b(?:answered\s+and\s+said|answered|said|says|replied|told|asked|cried\s+out(?:\s+with\s+a\s+loud\s+voice)?(?:\s+and\s+said)?|began\s+to\s+(?:preach\s+and\s+to\s+say|say))\s*(?:to\s+[^,]{1,90})?,\s*/i
    },
    {
        label: 'generic he attribution',
        regex: /^(?:And|But|Then|So|Now)?\s*he\b[\s\S]{0,160}?\b(?:answered\s+and\s+said|answered|said|says|replied|told|asked|cried\s+out(?:\s+with\s+a\s+loud\s+voice)?(?:\s+and\s+said)?)\s*(?:to\s+[^,]{1,90})?,\s*/i
    },
    {
        label: 'leading and he said',
        regex: /^(?:and\s+)?he\s+said\s*(?:to\s+[^,]{1,90})?,\s*/i
    },
    {
        label: 'leading saying',
        regex: /^saying\s*(?:to\s+[^,]{1,90})?,\s*/i
    },
    {
        label: 'said to recipient',
        regex: /^(?:and\s+)?said\s+to\s+[^,]{1,90},\s*/i
    },
    {
        label: 'From that time',
        regex: /^From\s+that\s+time\s+Jesus\s+began\s+to\s+preach\s+and\s+to\s+say,\s*/i
    }
];

const PARABLE_SPEAKER_SETUP_PATTERNS = [
    {
        label: 'parable intro',
        regex: /^He\s+related\s+another\s+parable\s+to\s+them,\s+saying,\s*/i
    },
    {
        label: 'parable he said to them',
        regex: /^(?:But\s+)?He\s+said\s+to\s+them,\s*/i
    },
    {
        label: 'parable servant instruction',
        regex: /^Then\s+he\s+said\s+to\s+his\s+servants,\s*/i
    },
    {
        label: 'parable answer setup',
        regex: /^(?:But\s+)?he\s+answered,\s*/i
    }
];

const LEFTOVER_ATTRIBUTION_PATTERNS = [
    {
        label: 'leading saying to one of them',
        regex: /^saying\s+to\s+one\s+of\s+them,\s*/i
    },
    {
        label: 'leading saying to recipient',
        regex: /^saying\s+to\s+(?:him|them),\s*/i
    },
    {
        label: 'leading saying',
        regex: /^saying\s*,\s*/i
    },
    {
        label: 'leading and said to recipient',
        regex: /^and\s+said\s+to\s+(?:him|them),\s*/i
    },
    {
        label: 'leading and said',
        regex: /^and\s+said\s*,\s*/i
    },
    {
        label: 'leading said to recipient',
        regex: /^said\s+to\s+(?:him|them),\s*/i
    }
];

const TRAILING_NARRATION_PATTERNS = [
    { label: 'then he permitted him', regex: /(?:[;,.]?\s*(?:and\s+)?then\s+he\s+permitted\s+him\.?)$/i },
    { label: 'then he consented', regex: /(?:[;,.]?\s*(?:and\s+)?then\s+he\s+consented\.?)$/i },
    { label: 'leprosy was cleansed', regex: /\s*(?:And|and)\s+in\s+that\s+hour\s+his\s+leprosy\s+was\s+cleansed\.?$/i },
    { label: 'boy was healed', regex: /\s*(?:And|and)\s+his\s+boy\s+was\s+healed\s+in\s+that\s+very\s+hour\.?$/i },
    { label: 'servant was healed', regex: /\s*(?:And|and)\s+(?:his|the)\s+servant\s+was\s+healed\b[\s\S]*$/i },
    { label: 'woman was healed', regex: /\s*(?:And|and)\s+(?:the\s+)?woman\s+was\s+healed\b[\s\S]*$/i },
    { label: 'daughter was healed', regex: /\s*(?:And|and)\s+her\s+daughter\s+was\s+healed\b[\s\S]*$/i },
    { label: 'then he got up and rebuked', regex: /\s*(?:Then|then)\s+he\s+got\s+up\s+and\s+rebuked\b[\s\S]*$/i },
    { label: 'and they laughed at him', regex: /\s*(?:And|and)\s+they\s+laughed\s+at\s+him\.?$/i },
    { label: 'they brought penny', regex: /\s*(?:And|and)\s+they\s+brought\s+to\s+him\s+a\s+penny\.?$/i },
    { label: 'they brought it', regex: /\s*(?:And|and)\s+they\s+brought\s+it\s+to\s+him\.?$/i },
    { label: 'external other-speaker response', regex: /\s*(?:They\s+(?:said\s+to\s+him|answered|replied)|Peter\s+said|Thomas\s+answered|She\s+said\s+to\s+him),\s*[^.!?]+[.!?]?$/i },
    { label: 'parable servant response', regex: /\s*His\s+servants\s+then\s+said\s+to\s+him,\s*[^.!?]+[.!?]?$/i, allowInParable: true },
    { label: 'followed him', regex: /\s*(?:And|and)\s+(?:he\s+got\s+up\s+and\s+went\s+after\s+him|he\s+followed\s+him|they\s+followed\s+him)\.?$/i },
    { label: 'immediate healing', regex: /\s*(?:And\s+immediately|and\s+immediately|Immediately)\b(?:[^.!?]*\b(?:healed|cleansed|left\s+him|opened)\b[\s\S]*)$/i },
    { label: 'great calm', regex: /\s*(?:and\s+)?there\s+was\s+a\s+(?:great|dead)\s+calm\.?$/i }
];

const EDITORIAL_BRACKET_PATTERN = /\s*\[(?:[^\]]*(?:which means|means|used by|translation|dialect|idiom|literal|synonym|that is|destiny)[^\]]*)\]\s*/ig;
const RISK_MARKER_PATTERN = /\b(?:which means|meaning|that is to say)\b|(?:\([^)]+\))|\[[^\]]+\]/i;
const OBVIOUS_NARRATION_PATTERN = /\b(?:Jesus\s+(?:said|answered|cried|began|stretched|touched|came|went|saw|heard)|he\s+said|and\s+he\s+said|saying|then\s+he\s+permitted|leprosy\s+was\s+cleansed|boy\s+was\s+healed|woman\s+was\s+healed|they\s+laughed\s+at\s+him|Then\s+he\s+got\s+up)\b/i;
const CANDIDATE_FAIL_PATTERNS = [
    { label: 'candidate begins with saying', regex: /^saying\b/i },
    { label: 'candidate begins with and said', regex: /^and\s+said\b/i },
    { label: 'candidate begins with said to', regex: /^said\s+to\b/i },
    { label: 'candidate begins with answered', regex: /^answered\b/i },
    { label: 'candidate begins with Jesus', regex: /^Jesus\b/i },
    { label: 'candidate begins with he said', regex: /^he\s+said\b/i },
    { label: 'Jesus said', regex: /\bJesus\s+said\b/i },
    { label: 'Jesus said to', regex: /\bJesus\s+said\s+to\b/i },
    { label: 'Jesus answered', regex: /\bJesus\s+answered\b/i },
    { label: 'Jesus anticipated', regex: /\bJesus\s+anticipated\b/i },
    { label: 'Jesus anticipated and said', regex: /\bJesus\s+anticipated\s+and\s+said\b/i },
    { label: 'Jesus cried out', regex: /\bJesus\s+cried\s+out\b/i },
    { label: 'he said', regex: /\bhe\s+said\b/i, allowInParable: true },
    { label: 'he said to', regex: /\bhe\s+said\s+to\b/i, allowInParable: true },
    { label: 'and he said', regex: /\band\s+he\s+said\b/i, allowInParable: true },
    { label: 'they brought to him', regex: /\bthey\s+brought\s+to\s+him\b/i },
    { label: 'And they brought to him', regex: /\bAnd\s+they\s+brought\s+to\s+him\b/ },
    { label: 'Peter entered', regex: /\bPeter\s+entered\b/i },
    { label: 'Peter entered the house', regex: /\bPeter\s+entered\s+the\s+house\b/i },
    { label: 'which means', regex: /\bwhich\s+means\b/i },
    { label: 'This was my destiny', regex: /\bThis\s+was\s+my\s+destiny\b/i },
    { label: 'external other-speaker response', regex: /\b(?:They\s+(?:said\s+to\s+him|answered|replied)|Peter\s+said|Thomas\s+answered|She\s+said\s+to\s+him),\s*/i },
    { label: 'parable servant response', regex: /\bHis\s+servants\s+then\s+said\s+to\s+him,\s*/i, allowInParable: true },
    { label: 'bracketed editorial note', regex: /\[[^\]]*(?:which means|means|used by|translation|dialect|idiom|literal|synonym|that is|destiny)[^\]]*\]/i }
];

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const dataset = readJson(DATASET_FILE);
    const backupDataset = readJson(BACKUP_DATASET_FILE);
    const applyReport = readJson(APPLY_REPORT_FILE);
    const changedVerseIds = getChangedLamsaVerseIds(backupDataset, dataset);
    const sourceCorruptionFixedIds = new Set(applyReport.sourceCorruptionFixedIds || []);
    const bracketNoteVerseIds = new Set(applyReport.bracketNoteVerseIds || []);
    const narrationGlossRiskVerseIds = new Set(applyReport.narrationGlossRiskVerseIds || []);
    const rows = changedVerseIds.map(verseId => buildRow({
        verseId,
        record: dataset[verseId],
        backupRecord: backupDataset[verseId],
        sourceCorruptionFixedIds,
        bracketNoteVerseIds,
        narrationGlossRiskVerseIds
    }));
    const summary = buildSummary(rows, changedVerseIds, applyReport);
    const validationErrors = validatePreview(rows, summary, dataset, applyReport);
    const report = {
        generatedAt: new Date().toISOString(),
        inputs: {
            dataset: relativeToRoot(DATASET_FILE),
            applyReport: relativeToRoot(APPLY_REPORT_FILE),
            backupDataset: relativeToRoot(BACKUP_DATASET_FILE)
        },
        outputs: {
            jsonReport: relativeToRoot(JSON_REPORT_FILE),
            csvReport: relativeToRoot(CSV_REPORT_FILE)
        },
        changedVerseSource: applyReport.changedVerseIds
            ? 'apply_report.changedVerseIds'
            : 'backup_current_lamsa_diff_validated_against_apply_report_count',
        summary: {
            ...summary,
            validationPassed: validationErrors.length === 0
        },
        validationErrors,
        specialChecks: Object.fromEntries(SPECIAL_CHECK_IDS.map(id => [
            id,
            rows.find(row => row.verseId === id) || null
        ])),
        rows
    };

    fs.mkdirSync(path.dirname(JSON_REPORT_FILE), { recursive: true });
    fs.writeFileSync(JSON_REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(CSV_REPORT_FILE, toCsv(rows), 'utf8');

    printSummary(summary);

    if (validationErrors.length > 0) {
        console.error(`LAMSA speech regeneration preview failed with ${validationErrors.length} validation error(s).`);
        validationErrors.forEach(error => console.error(`- ${error}`));
        process.exit(1);
    }
}

function buildRow({
    verseId,
    record,
    backupRecord,
    sourceCorruptionFixedIds,
    bracketNoteVerseIds,
    narrationGlossRiskVerseIds
}) {
    const rawLamsa = stringValue(record?.translations?.LAMSA);
    const previousRawLamsa = stringValue(backupRecord?.translations?.LAMSA);
    const bracketNotePresent = bracketNoteVerseIds.has(verseId) || /\[[^\]]+\]/.test(rawLamsa);
    const narrationGlossRisk = narrationGlossRiskVerseIds.has(verseId) || RISK_MARKER_PATTERN.test(rawLamsa);
    const sourceCorruptionFixed = sourceCorruptionFixedIds.has(verseId) || /\bfew this\b/i.test(previousRawLamsa);
    const extraction = extractCandidate(verseId, rawLamsa, { bracketNotePresent, narrationGlossRisk, sourceCorruptionFixed });
    const existingSpeechTextLAMSA = getExistingSpeechText(record);
    const notes = [
        ...extraction.notes,
        bracketNotePresent ? 'bracket_note_present' : null,
        narrationGlossRisk ? 'narration_or_gloss_risk' : null,
        sourceCorruptionFixed ? 'source_corruption_fixed' : null
    ].filter(Boolean);

    return {
        verseId,
        reference: record?.reference || verseId,
        rawLamsa,
        previousRawLamsa,
        existingSpeechTextLAMSA,
        candidateSpeechTextLAMSA: extraction.candidateSpeechTextLAMSA,
        confidence: extraction.confidence,
        action: extraction.action,
        reason: extraction.reason,
        notes,
        changedRaw: true,
        bracketNotePresent,
        narrationGlossRisk,
        sourceCorruptionFixed
    };
}

function extractCandidate(verseId, rawText, flags) {
    const notes = [];
    const parableContext = getParableContextForVerseId(verseId);
    const inParableContext = Boolean(parableContext);

    if (Object.prototype.hasOwnProperty.call(SPECIAL_CANDIDATES, verseId)) {
        return {
            candidateSpeechTextLAMSA: SPECIAL_CANDIDATES[verseId],
            confidence: flags.narrationGlossRisk ? 'medium' : 'high',
            action: flags.narrationGlossRisk ? 'review_required' : 'auto_candidate_safe',
            reason: 'Special required handling with explicit speech boundary.',
            notes: notes.concat('special_required_handling')
        };
    }

    let candidate = normalizeWhitespace(rawText);
    let removedIntro = false;
    let removedTrailingNarration = false;
    let removedEditorialBracket = false;

    if (inParableContext) {
        notes.push(`parable_context: ${parableContext.title}`);
    }

    const introResult = inParableContext
        ? removeParableSpeakerSetup(candidate)
        : removeSpeakerSetup(candidate);
    if (introResult.text !== candidate) {
        candidate = introResult.text;
        removedIntro = true;
        notes.push(`removed_speaker_setup: ${introResult.label}`);
    }

    const leftoverResult = removeLeadingLeftoverAttribution(candidate);
    if (leftoverResult.text !== candidate) {
        candidate = leftoverResult.text;
        removedIntro = true;
        notes.push(...leftoverResult.labels.map(label => `removed_leftover_attribution: ${label}`));
    }

    const beforeBracketRemoval = candidate;
    candidate = candidate.replace(EDITORIAL_BRACKET_PATTERN, ' ');
    if (candidate !== beforeBracketRemoval) {
        removedEditorialBracket = true;
        notes.push('removed_editorial_bracket_note');
    }

    const glossResult = removeInlineGloss(candidate);
    if (glossResult.text !== candidate) {
        candidate = glossResult.text;
        notes.push(glossResult.note);
    }

    const trailingResult = removeTrailingNarration(candidate, { parableContext: inParableContext });
    if (trailingResult.text !== candidate) {
        candidate = trailingResult.text;
        removedTrailingNarration = true;
        notes.push(`removed_trailing_narration: ${trailingResult.label}`);
    }

    candidate = cleanCandidate(candidate);

    if (!candidate) {
        return {
            candidateSpeechTextLAMSA: null,
            confidence: 'low',
            action: 'manual_required',
            reason: 'No reliable LAMSA speech candidate could be isolated.',
            notes
        };
    }

    const failMatches = getCandidateFailMatches(candidate, verseId);
    if (failMatches.length > 0) {
        return {
            candidateSpeechTextLAMSA: null,
            confidence: 'low',
            action: 'manual_required',
            reason: `Candidate failed purity guard: ${failMatches.join('; ')}.`,
            notes
        };
    }

    if (!inParableContext && candidate === rawText && hasObviousNarration(rawText)) {
        return {
            candidateSpeechTextLAMSA: null,
            confidence: 'low',
            action: 'manual_required',
            reason: 'Raw LAMSA contains obvious narration, but no reliable boundary was found.',
            notes
        };
    }

    if (inParableContext) {
        return {
            candidateSpeechTextLAMSA: candidate,
            confidence: 'medium',
            action: parableContext.reviewLevel || 'review_required',
            reason: PARABLE_REVIEW_REASON,
            notes
        };
    }

    if (flags.narrationGlossRisk || flags.bracketNotePresent || removedEditorialBracket) {
        return {
            candidateSpeechTextLAMSA: candidate,
            confidence: removedIntro || removedTrailingNarration ? 'medium' : 'low',
            action: 'review_required',
            reason: 'Candidate generated, but bracket/gloss/parenthetical risk requires review.',
            notes
        };
    }

    if (removedIntro || removedTrailingNarration) {
        return {
            candidateSpeechTextLAMSA: candidate,
            confidence: 'high',
            action: 'auto_candidate_safe',
            reason: 'Removed clear LAMSA speaker setup and/or trailing narration.',
            notes
        };
    }

    if (!hasObviousNarration(rawText)) {
        return {
            candidateSpeechTextLAMSA: candidate,
            confidence: 'medium',
            action: 'auto_candidate_safe',
            reason: 'Changed raw LAMSA appears to already be direct speech.',
            notes
        };
    }

    return {
        candidateSpeechTextLAMSA: null,
        confidence: 'low',
        action: 'manual_required',
        reason: 'Ambiguous speech boundary after source replacement.',
        notes
    };
}

function removeSpeakerSetup(text) {
    return removeSpeakerSetupWithPatterns(text, SPEAKER_SETUP_PATTERNS);
}

function removeParableSpeakerSetup(text) {
    const parableResult = removeSpeakerSetupWithPatterns(text, PARABLE_SPEAKER_SETUP_PATTERNS);
    if (parableResult.text !== text) return parableResult;
    return removeSpeakerSetup(text);
}

function removeSpeakerSetupWithPatterns(text, patterns) {
    let best = null;
    for (const pattern of patterns) {
        const match = text.match(pattern.regex);
        if (!match || match.index !== 0) continue;
        if (!best || match[0].length > best.match[0].length) {
            best = { match, label: pattern.label };
        }
    }

    if (!best) return { text, label: null };
    return {
        text: text.slice(best.match[0].length).trim(),
        label: best.label
    };
}

function removeLeadingLeftoverAttribution(text) {
    let output = text.trim();
    const labels = [];
    let changed = true;

    while (changed) {
        changed = false;
        for (const pattern of LEFTOVER_ATTRIBUTION_PATTERNS) {
            const next = output.replace(pattern.regex, '').trim();
            if (next !== output) {
                output = next;
                labels.push(pattern.label);
                changed = true;
                break;
            }
        }
    }

    return { text: output, labels };
}

function removeInlineGloss(text) {
    const markWithBracket = text.match(/\bwhich\s+means,\s*\[[^\]]+\]\s*/i);
    if (markWithBracket) {
        return {
            text: `${text.slice(0, markWithBracket.index).trim()} ${text.slice(markWithBracket.index + markWithBracket[0].length).trim()}`.trim(),
            note: 'removed_which_means_bracket_gloss'
        };
    }

    const mark = text.match(/\bwhich\s+means,?\s*/i);
    if (mark && mark.index > 0) {
        return {
            text: `${text.slice(0, mark.index).trim()} ${text.slice(mark.index + mark[0].length).trim()}`.trim(),
            note: 'removed_which_means_gloss_marker'
        };
    }

    return { text, note: null };
}

function removeTrailingNarration(text, { parableContext = false } = {}) {
    let output = text;
    let removedLabel = null;
    let changed = true;

    while (changed) {
        changed = false;
        for (const pattern of TRAILING_NARRATION_PATTERNS) {
            if (parableContext && pattern.allowInParable) continue;
            const next = output.replace(pattern.regex, '').trim();
            if (next !== output) {
                output = next;
                removedLabel = pattern.label;
                changed = true;
                break;
            }
        }
    }

    return { text: output, label: removedLabel };
}

function cleanCandidate(text) {
    return normalizeWhitespace(text)
        .replace(/^[,;:\s]+/, '')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function getChangedLamsaVerseIds(beforeDataset, afterDataset) {
    const reportChangedIds = [];
    const allIds = new Set([...Object.keys(beforeDataset), ...Object.keys(afterDataset)]);

    for (const verseId of allIds) {
        const beforeLamsa = beforeDataset[verseId]?.translations?.LAMSA;
        const afterLamsa = afterDataset[verseId]?.translations?.LAMSA;
        if (typeof beforeLamsa !== 'string' || typeof afterLamsa !== 'string') continue;
        if (beforeLamsa !== afterLamsa) {
            reportChangedIds.push(verseId);
        }
    }

    return reportChangedIds.sort(compareVerseIds);
}

function validatePreview(rows, summary, dataset, applyReport) {
    const errors = [];
    if (rows.length !== EXPECTED_CHANGED_COUNT) {
        errors.push(`Changed verse count is ${rows.length}, expected ${EXPECTED_CHANGED_COUNT}`);
    }
    if (applyReport.changedVerseCount !== EXPECTED_CHANGED_COUNT) {
        errors.push(`Apply report changedVerseCount is ${applyReport.changedVerseCount}, expected ${EXPECTED_CHANGED_COUNT}`);
    }
    if (/\bfew this\b/i.test(dataset.MRK_15_34?.translations?.LAMSA || '')) {
        errors.push('MRK_15_34 raw LAMSA still contains "few this"');
    }
    validateSharedDiscourseContextUsage(errors);

    for (const row of rows) {
        const candidate = row.candidateSpeechTextLAMSA;
        if (!candidate) continue;

        const failMatches = getCandidateFailMatches(candidate, row.verseId);
        if (failMatches.length > 0) {
            errors.push(`${row.verseId} candidate failed purity validation: ${failMatches.join('; ')}`);
        }
        if (!isParableContextVerseId(row.verseId) && candidate === row.rawLamsa && hasObviousNarration(row.rawLamsa)) {
            errors.push(`${row.verseId} candidate is identical to raw LAMSA despite obvious narration`);
        }
    }

    for (const [verseId, expectedStart] of Object.entries(REQUIRED_CANDIDATE_STARTS)) {
        const row = rows.find(item => item.verseId === verseId);
        if (!row) {
            errors.push(`${verseId} is missing from the speech regeneration preview`);
            continue;
        }
        if (!row.candidateSpeechTextLAMSA) {
            errors.push(`${verseId} candidate is missing; expected it to start with "${expectedStart}"`);
            continue;
        }
        if (!row.candidateSpeechTextLAMSA.startsWith(expectedStart)) {
            errors.push(`${verseId} candidate starts with "${row.candidateSpeechTextLAMSA.slice(0, 80)}"; expected "${expectedStart}"`);
        }
    }

    for (const [verseId, expectedCandidate] of Object.entries(REQUIRED_CANDIDATE_EXACT)) {
        const row = rows.find(item => item.verseId === verseId);
        if (!row) {
            errors.push(`${verseId} is missing from the speech regeneration preview`);
            continue;
        }
        if (row.candidateSpeechTextLAMSA !== expectedCandidate) {
            errors.push(`${verseId} candidate is "${row.candidateSpeechTextLAMSA || '[missing]'}"; expected exactly "${expectedCandidate}"`);
        }
    }

    return errors;
}

function validateSharedDiscourseContextUsage(errors) {
    const scriptFiles = [
        'scripts/build_lamsa_speech_regeneration_preview.js',
        'scripts/audit_lamsa_speech_candidates.js',
        'scripts/reduce_lamsa_manual_candidates.js'
    ];
    const forbiddenNames = [
        'PARABLE' + '_CONTEXT' + '_RANGES',
        'PARABLE' + '_CONTEXT' + '_EXTRA_IDS'
    ];

    for (const scriptFile of scriptFiles) {
        const absolutePath = path.join(ROOT, scriptFile);
        const text = fs.readFileSync(absolutePath, 'utf8');
        if (!text.includes("require('./load_jesus_discourse_context')")) {
            errors.push(`${scriptFile} does not use scripts/load_jesus_discourse_context.js`);
        }
        for (const name of forbiddenNames) {
            const localDefinitionPattern = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`);
            if (localDefinitionPattern.test(text)) {
                errors.push(`${scriptFile} defines local ${name}; use scripts/load_jesus_discourse_context.js instead`);
            }
        }
    }
}

function getCandidateFailMatches(candidate, verseId) {
    const parableContext = isParableContextVerseId(verseId);
    return CANDIDATE_FAIL_PATTERNS
        .filter(pattern => !(parableContext && pattern.allowInParable))
        .filter(pattern => pattern.regex.test(candidate))
        .map(pattern => pattern.label);
}

function hasObviousNarration(text) {
    return OBVIOUS_NARRATION_PATTERN.test(text);
}

function getExistingSpeechText(record) {
    if (typeof record?.speechText?.LAMSA === 'string') return record.speechText.LAMSA;
    if (typeof record?.currentSpeechText?.LAMSA === 'string') return record.currentSpeechText.LAMSA;
    return null;
}

function buildSummary(rows, changedVerseIds, applyReport) {
    return {
        totalChangedVersesInspected: changedVerseIds.length,
        applyReportChangedVerseCount: applyReport.changedVerseCount,
        autoCandidateSafe: rows.filter(row => row.action === 'auto_candidate_safe').length,
        reviewRequired: rows.filter(row => row.action === 'review_required').length,
        manualRequired: rows.filter(row => row.action === 'manual_required').length,
        bracketNoteCandidates: rows.filter(row => row.bracketNotePresent).length,
        narrationGlossRiskCandidates: rows.filter(row => row.narrationGlossRisk).length,
        sourceCorruptionFixedCandidates: rows.filter(row => row.sourceCorruptionFixed).length,
        existingSpeechTextPresentCount: rows.filter(row => row.existingSpeechTextLAMSA).length,
        existingSpeechTextMissingCount: rows.filter(row => !row.existingSpeechTextLAMSA).length,
        candidateSpeechTextPresentCount: rows.filter(row => row.candidateSpeechTextLAMSA).length,
        candidateSpeechTextMissingCount: rows.filter(row => !row.candidateSpeechTextLAMSA).length
    };
}

function toCsv(rows) {
    const headers = [
        'verseId',
        'reference',
        'rawLamsa',
        'previousRawLamsa',
        'existingSpeechTextLAMSA',
        'candidateSpeechTextLAMSA',
        'confidence',
        'action',
        'reason',
        'notes',
        'changedRaw',
        'bracketNotePresent',
        'narrationGlossRisk',
        'sourceCorruptionFixed'
    ];

    const csvRows = [headers];
    for (const row of rows) {
        csvRows.push(headers.map(header => {
            const value = row[header];
            if (Array.isArray(value)) return value.join('; ');
            if (typeof value === 'boolean') return value ? 'true' : 'false';
            return value ?? '';
        }));
    }

    return `${csvRows.map(row => row.map(csvValue).join(',')).join('\n')}\n`;
}

function csvValue(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeWhitespace(text) {
    return stringValue(text).replace(/\s+/g, ' ').trim();
}

function stringValue(value) {
    return typeof value === 'string' ? value : '';
}

function compareVerseIds(a, b) {
    const parsedA = parseVerseId(a);
    const parsedB = parseVerseId(b);
    if (parsedA && parsedB) {
        return (BOOK_ORDER.get(parsedA.book) || 99) - (BOOK_ORDER.get(parsedB.book) || 99)
            || parsedA.chapter - parsedB.chapter
            || parsedA.verse - parsedB.verse;
    }
    if (parsedA) return -1;
    if (parsedB) return 1;
    return a.localeCompare(b);
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function printSummary(summary) {
    console.log('LAMSA speech regeneration preview complete.');
    console.log(`Total changed verses inspected: ${summary.totalChangedVersesInspected}`);
    console.log(`auto_candidate_safe: ${summary.autoCandidateSafe}`);
    console.log(`review_required: ${summary.reviewRequired}`);
    console.log(`manual_required: ${summary.manualRequired}`);
    console.log(`Bracket-note candidates: ${summary.bracketNoteCandidates}`);
    console.log(`Narration/gloss risk candidates: ${summary.narrationGlossRiskCandidates}`);
    console.log(`Source corruption fixed candidates: ${summary.sourceCorruptionFixedCandidates}`);
    console.log(`Existing speechText present: ${summary.existingSpeechTextPresentCount}`);
    console.log(`Existing speechText missing: ${summary.existingSpeechTextMissingCount}`);
    console.log(`JSON report saved to ${relativeToRoot(JSON_REPORT_FILE)}`);
    console.log(`CSV report saved to ${relativeToRoot(CSV_REPORT_FILE)}`);
}
