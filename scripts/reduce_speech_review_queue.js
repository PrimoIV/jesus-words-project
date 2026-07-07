const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'dev', 'reports');
const CANDIDATE_FILE = path.join(REPORT_DIR, 'jesus_verses_with_speech_candidates.json');
const CANDIDATE_REVIEW_CSV = path.join(REPORT_DIR, 'speech_candidate_review.csv');
const AUDIT_FILE = path.join(REPORT_DIR, 'speech_contamination_audit.json');
const OUTPUT_FILE = path.join(REPORT_DIR, 'jesus_verses_with_speech_candidates_reduced.json');
const REPORT_FILE = path.join(REPORT_DIR, 'speech_review_reduction_report.json');
const CSV_FILE = path.join(REPORT_DIR, 'speech_review_reduction_review.csv');

const TRANSLATION_KEYS = ['NRSVUE', 'DBH', 'LAMSA'];
const PROMOTION_CATEGORIES = [
    'harmless_outer_quote',
    'bracket_review_safe',
    'bracketed_speech_preserved',
    'clean_quote_after_jesus_attribution',
    'single_jesus_speech_wrapper',
    'anchor_mismatch_only',
    'embedded_quote_only',
    'not_promoted'
];
const DANGEROUS_FLAGS = new Set(['other_speaker', 'pre_speech_narration', 'post_speech_narration']);
const HARMLESS_QUOTE_FLAGS = new Set(['quote_artifact', 'embedded_quote']);

const PURITY_FAIL_PATTERNS = [
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
const PURITY_EXCEPTION_PATTERNS = [
    /\bTruly\s+I\s+say\s+to\s+you\b/i,
    /\bI\s+say\s+to\s+you\b/i,
    /\bBut\s+I\s+say\s+to\s+you\b/i,
    /\bAmen,\s+I\s+tell\s+you\b/i,
    /\bIt\s+is\s+written\b/i,
    /\bYou\s+have\s+heard\s+that\s+it\s+was\s+said\b/i
];
const RAW_OTHER_SPEAKER_PATTERNS = [
    /\bThey\s+(?:said|say|answered|replied)\b/i,
    /\bAnd\s+they\s+(?:said|answered|replied)\b/i,
    /\bPeter\s+said\b/i,
    /\bThomas\s+answered\b/i,
    /\bShe\s+said\s+to\s+him\b/i,
    /\b(?:the\s+)?disciples\s+(?:said|answered|replied)\b/i,
    /\b(?:the\s+)?Pharisees\s+(?:said|answered|replied)\b/i,
    /\b(?:the\s+)?Jews\s+(?:said|answered|replied)\b/i
];
const RAW_OTHER_SPEAKER_RESPONSE_PATTERNS = [
    /\bThey\s+(?:said|say|answered|replied)(?:\s+to\s+him)?\b/i,
    /\bAnd\s+they\s+(?:said|answered|replied)(?:\s+to\s+him)?\b/i,
    /\bPeter\s+said\b/i,
    /\bThomas\s+answered\b/i,
    /\bShe\s+said\s+to\s+him\b/i,
    /\bThe\s+Jews\s+said\b/i,
    /\bThe\s+crowd\s+said\b/i,
    /\bThe\s+disciples\s+said\b/i
];
const JESUS_ATTRIBUTION_PATTERNS = [
    /\bJesus\s+(?:said|says|answered|replied|told|asked|declared|called)\b(?:\s+to\s+(?:him|them|her))?/i,
    /\bJesus\s+cried\s+out\b/i,
    /\bJesus\s+answered\s+(?:him|them|her)\b/i,
    /\bin\s+reply\s+Jesus\s+said\b/i,
    /\bhe\s+(?:said|says)\s+to\s+(?:him|them|her)\b/i,
    /\bhe\s+(?:said|says)\s+to\s+[^,]{1,80}\b/i,
    /\bhe\s+(?:answered|replied|told|asked)\b/i,
    /\b(?:said|says)\s+to\s+(?:him|them)\b/i,
    /\b(?:said|says)\s+to\s+[^,]{1,80}\b/i,
    /\bsaying\b/i,
    /\band\s+said\b/i,
    /\banswered\s+(?:him|them)\b/i
];
const LAMSA_SPEECH_INTRO_PATTERNS = [
    /\bFrom\s+that\s+time\s+Jesus\s+began\s+to\s+(?:preach\s+and\s+to\s+say|make\s+his\s+proclamation\s+and\s+to\s+say|proclaim|say),?\s*/ig,
    /\bBut\s+when\s+Jesus\s+heard\s+it,\s*he\s+said\s+to\s+them,\s*/ig,
    /\bWhen\s+Jesus\s+heard\s+it,\s*he\s+was\s+amazed,\s*and\s+he\s+said\s+to\s+[^,]{1,100},\s*/ig,
    /\bWhen\s+Jesus\s+heard\s+it,\s*he\s+said\s+to\s+them,\s*/ig,
    /\bJesus\s+knew\s+their\s+thoughts;\s*so\s+he\s+said\s+to\s+them,\s*/ig,
    /\b(?:But|And|Then|So)?\s*Jesus\s+answered\s+and\s+said\s+to\s+(?:him|them|her),\s*/ig,
    /\b(?:But|And|Then|So)?\s*Jesus\s+answered\s+and\s+said,\s*/ig,
    /\b(?:But|And|Then|So)?\s*Jesus\s+answered,\s*/ig,
    /\b(?:So\s+)?Jesus\s+said\s+to\s+the\s+centurion,\s*/ig,
    /\b(?:But|And|Then|So)?\s*Jesus\s+said\s+to\s+(?:him|them|her),\s*/ig,
    /\b(?:But|And|Then|So)?\s*Jesus\s+said,\s*/ig,
    /\band\s+he\s+said\s+to\s+[^,]{1,100},\s*/ig,
    /\bhe\s+said\s+to\s+[^,]{1,100},\s*/ig,
    /\band\s+said\s+to\s+(?:him|her|them),\s*/ig,
    /\band\s+he\s+said,\s*/ig,
    /\band\s+said,\s*/ig,
    /\bhe\s+said,\s*/ig
];
const LAMSA_TRAILING_NARRATION_PATTERNS = [
    /\s*(?:And\s+immediately|and\s+immediately|Immediately)\b[\s\S]*$/i,
    /\s*(?:And\s+in\s+that\s+hour|and\s+in\s+that\s+hour|And\s+in\s+that\s+very\s+hour|and\s+in\s+that\s+very\s+hour)\b[\s\S]*$/i,
    /\s*(?:And\s+his\s+boy\s+was\s+healed|and\s+his\s+boy\s+was\s+healed)\b[\s\S]*$/i,
    /\s*(?:And\s+the\s+servant\s+was\s+healed|and\s+the\s+servant\s+was\s+healed)\b[\s\S]*$/i,
    /\s*(?:And\s+the\s+woman\s+was\s+healed|and\s+the\s+woman\s+was\s+healed)\b[\s\S]*$/i,
    /\s*(?:And\s+her\s+daughter\s+was\s+healed|and\s+her\s+daughter\s+was\s+healed)\b[\s\S]*$/i,
    /\s*(?:And\s+they\s+laughed\s+at\s+him|and\s+they\s+laughed\s+at\s+him)\b[\s\S]*$/i,
    /\s*and\s+he\s+got\s+up\b[\s\S]*$/i,
    /\s*and\s+went\s+after\s+him\b[\s\S]*$/i,
    /\s*and\s+followed\s+him\b[\s\S]*$/i,
    /\s*and\s+his\s+leprosy\s+(?:was\s+cleansed|left\s+him)\b[\s\S]*$/i
];

main();

function main() {
    let candidates;
    let audit;

    try {
        candidates = loadJson(CANDIDATE_FILE, 'speech candidates');
        audit = loadJson(AUDIT_FILE, 'speech contamination audit');
        requireFile(CANDIDATE_REVIEW_CSV, 'speech candidate review CSV');
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    const output = JSON.parse(JSON.stringify(candidates));
    const rows = [];
    const countByPromotionCategory = createCategoryCounts();
    const previousNeedsReviewCount = countStatus(candidates, 'needs_review');
    let promotedToCandidateCount = 0;
    let needsReviewTextPresentCount = 0;

    Object.entries(output).forEach(([id, record]) => {
        TRANSLATION_KEYS.forEach(translationKey => {
            if (record.speechStatus?.[translationKey] !== 'needs_review') return;
            if (stringValue(record.speechText?.[translationKey])) return;

            const auditEntry = getAuditEntry(audit, id, translationKey);
            const rawText = auditEntry.rawText || stringValue(record.translations && record.translations[translationKey]);
            const oldStatus = record.speechStatus[translationKey];
            const oldSpeechText = stringValue(record.speechText[translationKey]);
            const decision = reduceRow(record, auditEntry, rawText, translationKey);
            countByPromotionCategory[decision.promotionCategory] += 1;

            if (decision.newStatus !== oldStatus || decision.newSpeechText !== oldSpeechText) {
                record.speechText[translationKey] = decision.newSpeechText;
                record.speechStatus[translationKey] = decision.newStatus;
                record.speechAudit[translationKey] = {
                    ...record.speechAudit[translationKey],
                    source: decision.source,
                    notes: getExistingNotes(record, translationKey).concat(decision.notes)
                };
            }

            if (decision.newStatus === 'candidate') promotedToCandidateCount += 1;
            if (decision.newStatus === 'needs_review_text_present') needsReviewTextPresentCount += 1;

            rows.push({
                id,
                reference: record.reference || id,
                translationKey,
                oldStatus,
                newStatus: decision.newStatus,
                promotionCategory: decision.promotionCategory,
                rawText,
                oldSpeechText,
                newSpeechText: decision.newSpeechText,
                flags: auditEntry.flags.join('; '),
                notes: getExistingNotes(record, translationKey).concat(decision.notes).join(' | ')
            });
        });
    });

    const remainingNeedsReviewCount = countStatus(output, 'needs_review');
    const report = {
        generatedAt: new Date().toISOString(),
        sourceFile: path.relative(ROOT, CANDIDATE_FILE).replace(/\\/g, '/'),
        auditFile: path.relative(ROOT, AUDIT_FILE).replace(/\\/g, '/'),
        totalTranslationStrings: countTranslationStrings(output),
        previousNeedsReviewCount,
        newNeedsReviewCount: remainingNeedsReviewCount,
        needsReviewTextPresentCount,
        promotedToCandidateCount,
        remainingNeedsReviewCount,
        countByPromotionCategory,
        remainingNeedsReviewExamples: getExamples(output, 'needs_review', 60),
        promotedExamples: rows
            .filter(row => row.newStatus !== row.oldStatus || row.newSpeechText)
            .slice(0, 60)
            .map(row => ({
                id: row.id,
                reference: row.reference,
                translationKey: row.translationKey,
                oldStatus: row.oldStatus,
                newStatus: row.newStatus,
                promotionCategory: row.promotionCategory,
                rawText: truncate(row.rawText, 220),
                newSpeechText: truncate(row.newSpeechText, 220),
                flags: row.flags
            }))
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(CSV_FILE, `\uFEFF${toCsv(rows)}\n`, 'utf8');

    printSummary(report);
}

function reduceRow(record, auditEntry, rawText, translationKey) {
    const flags = auditEntry.flags;
    const flagSet = new Set(flags);
    const base = {
        newStatus: 'needs_review',
        newSpeechText: '',
        source: 'blank',
        promotionCategory: 'not_promoted',
        notes: []
    };

    if (!rawText) return withNote(base, 'Reducer left blank: missing raw translation text.');

    const wrappedSpeech = extractSingleJesusSpeechWrapper(translationKey, rawText);
    if (wrappedSpeech) {
        const preservesBrackets = flagSet.has('bracket_or_editorial_material') && hasBracketedMaterial(wrappedSpeech);
        if (preservesBrackets && hasDangerousFlag(flagSet)) {
            return withNote(base, 'Reducer left blank: bracketed extracted speech also has a dangerous contamination flag.');
        }
        if (preservesBrackets && translationKey !== 'LAMSA' && getQuoteBlocks(rawText).length > 1) {
            return withNote(base, 'Reducer left blank: bracketed extraction came from multiple quote blocks, which may include another speaker.');
        }

        return makeCandidateFromText(
            preservesBrackets ? 'bracketed_speech_preserved' : 'single_jesus_speech_wrapper',
            preservesBrackets ? 'review_reducer_bracketed_speech_preserved' : 'review_reducer_single_jesus_speech_wrapper',
            wrappedSpeech,
            preservesBrackets
                ? 'Promoted by reducer: bracketed Jesus speech preserved from a narrative wrapper.'
                : 'Promoted by reducer: isolated Jesus speech from a narrative wrapper.'
        );
    }

    if (hasDangerousFlag(flagSet)) return withNote(base, 'Reducer left blank: dangerous contamination flag present.');
    if (hasRawOtherSpeaker(rawText)) return withNote(base, 'Reducer left blank: raw text contains other-speaker marker.');

    if (isOnlyFlags(flags, ['embedded_quote'])) {
        return makeCandidate('embedded_quote_only', 'review_reducer_embedded_quote_only', rawText, 'Promoted by reducer: embedded quote only.');
    }

    if (flags.length > 0 && flags.every(flag => HARMLESS_QUOTE_FLAGS.has(flag))) {
        return makeCandidate('harmless_outer_quote', 'review_reducer_harmless_quote', rawText, 'Promoted by reducer: harmless outer quote or embedded quote only.');
    }

    if (isOnlyFlags(flags, ['anchor_mismatch_risk'])) {
        return makeCandidate('anchor_mismatch_only', 'review_reducer_anchor_mismatch_only', rawText, 'Promoted by reducer: anchor mismatch only, no contamination markers.');
    }

    const quoted = extractSingleJesusAttributedQuote(rawText);
    if (
        quoted &&
        !flagSet.has('other_speaker') &&
        !flagSet.has('pre_speech_narration') &&
        !flagSet.has('post_speech_narration') &&
        (flagSet.has('speaker_setup') || flagSet.has('long_prefix_before_quote') || flagSet.has('long_suffix_after_quote') || flagSet.has('quote_artifact'))
    ) {
        if (flagSet.has('bracket_or_editorial_material')) {
            if (!hasBracketedMaterial(quoted)) {
                return withNote(base, 'Reducer left blank: bracket/editorial material was outside the safely extracted quote or unclear.');
            }

            return makeCandidateFromText(
                'bracketed_speech_preserved',
                'review_reducer_bracketed_speech_preserved',
                quoted,
                'Promoted by reducer: bracketed Jesus speech preserved after Jesus attribution.'
            );
        }

        return makeCandidateFromText(
            'clean_quote_after_jesus_attribution',
            'review_reducer_quote_after_jesus_attribution',
            quoted,
            'Promoted by reducer: extracted clean quote after Jesus attribution.'
        );
    }

    if (
        flagSet.has('bracket_or_editorial_material') &&
        !flagSet.has('speaker_setup') &&
        !flagSet.has('long_prefix_before_quote') &&
        !flagSet.has('long_suffix_after_quote')
    ) {
        const speechText = cleanSpeechText(rawText);
        const purityMatches = getPurityMatches(speechText);
        if (speechText && hasBracketedMaterial(speechText) && purityMatches.length === 0 && !beginsWithForbiddenPrefix(speechText)) {
            return makeCandidateFromText(
                'bracketed_speech_preserved',
                'review_reducer_bracketed_speech_preserved',
                speechText,
                'Promoted by reducer: bracketed Jesus speech preserved.'
            );
        }
    }

    return withNote(base, 'Reducer left blank: no conservative promotion rule matched.');
}

function makeCandidate(category, source, rawText, note) {
    return makeCandidateFromText(category, source, cleanSpeechText(rawText), note);
}

function makeCandidateFromText(category, source, speechText, note) {
    const cleaned = cleanSpeechText(speechText);
    const purityMatches = getPurityMatches(cleaned);

    if (!cleaned) {
        return {
            newStatus: 'needs_review',
            newSpeechText: '',
            source: 'blank',
            promotionCategory: 'not_promoted',
            notes: ['Reducer left blank: proposed text was empty after cleanup.']
        };
    }

    if (purityMatches.length > 0 || beginsWithForbiddenPrefix(cleaned)) {
        return {
            newStatus: 'needs_review',
            newSpeechText: '',
            source: 'blank',
            promotionCategory: 'not_promoted',
            notes: [`Reducer left blank: proposed text failed purity guard (${purityMatches.join('; ')}).`]
        };
    }

    return {
        newStatus: 'candidate',
        newSpeechText: cleaned,
        source,
        promotionCategory: category,
        notes: [note]
    };
}

function makeReviewTextFromText(category, source, speechText, note) {
    const cleaned = cleanSpeechText(speechText);
    const purityMatches = getPurityMatches(cleaned);

    if (!cleaned || purityMatches.length > 0 || beginsWithForbiddenPrefix(cleaned)) {
        return {
            newStatus: 'needs_review',
            newSpeechText: '',
            source: 'blank',
            promotionCategory: 'not_promoted',
            notes: [`Reducer left blank: provisional text failed purity guard (${purityMatches.join('; ')}).`]
        };
    }

    return {
        newStatus: 'needs_review_text_present',
        newSpeechText: cleaned,
        source,
        promotionCategory: category,
        notes: [note]
    };
}

function extractSingleJesusSpeechWrapper(translationKey, rawText) {
    if (translationKey === 'LAMSA') {
        return extractLamsaWrappedSpeech(rawText);
    }

    if (translationKey === 'NRSVUE' || translationKey === 'DBH') {
        return extractQuotedWrappedSpeech(rawText);
    }

    return '';
}

function extractQuotedWrappedSpeech(rawText) {
    const quoteBlocks = getQuoteBlocks(rawText);
    if (quoteBlocks.length === 0) return '';

    if (quoteBlocks.length === 1) {
        const block = quoteBlocks[0];
        const before = rawText.slice(0, block.start);
        const after = rawText.slice(block.end + 1);
        const precedingContext = rawText.slice(Math.max(0, block.start - 120), block.start);

        if (hasOtherSpeakerResponse(before)) return '';
        if (hasOtherSpeakerResponse(after)) return '';
        if (!isJesusQuoteContext(precedingContext, before)) return '';

        return cleanSpeechText(block.content);
    }

    const attributedBlocks = quoteBlocks.map((block, index) => {
        const before = rawText.slice(Math.max(0, block.start - 120), block.start);
        return {
            block,
            index,
            attribution: classifyQuoteAttribution(before)
        };
    });

    const jesusBlocks = attributedBlocks.filter(item => item.attribution === 'jesus');
    if (jesusBlocks.length === 0) return '';

    const firstJesus = jesusBlocks[0].index;
    const lastJesus = jesusBlocks[jesusBlocks.length - 1].index;
    const interruptingOther = attributedBlocks
        .slice(firstJesus, lastJesus + 1)
        .some(item => item.attribution === 'other');

    if (interruptingOther) return '';

    return cleanSpeechText(jesusBlocks.map(item => item.block.content).join(' '));
}

function extractLamsaWrappedSpeech(rawText) {
    let candidate = rawText.trim();
    candidate = trimBeforeOtherSpeakerResponse(candidate);

    const introEnd = findLastIntroEnd(candidate, LAMSA_SPEECH_INTRO_PATTERNS);
    if (introEnd < 0) return '';

    candidate = candidate.slice(introEnd);
    candidate = trimLamsaTrailingNarration(candidate);
    candidate = cleanSpeechText(candidate);

    if (isJustSpeakerFormula(candidate)) return '';
    return candidate;
}

function classifyQuoteAttribution(precedingContext) {
    if (hasOtherSpeakerResponse(precedingContext)) return 'other';
    if (JESUS_ATTRIBUTION_PATTERNS.some(regex => regex.test(precedingContext))) return 'jesus';
    return 'unknown';
}

function isJesusQuoteContext(precedingContext, outsideBefore) {
    if (JESUS_ATTRIBUTION_PATTERNS.some(regex => regex.test(precedingContext))) return true;
    if (/\bJesus\s+began\s+to\s+(?:proclaim|preach|say|make\s+his\s+proclamation\s+and\s+to\s+say)\b/i.test(precedingContext)) return true;
    if (/\b(?:saying|said),?\s*$/i.test(precedingContext)) return true;
    if (/\bto\s+say,?\s*$/i.test(precedingContext)) return true;
    if (/\b(?:and\s+said|and\s+he\s+said),?\s*$/i.test(precedingContext)) return true;
    if (outsideBefore.trim().length === 0) return true;
    return false;
}

function hasOtherSpeakerResponse(text) {
    return RAW_OTHER_SPEAKER_RESPONSE_PATTERNS.some(regex => regex.test(text));
}

function trimBeforeOtherSpeakerResponse(text) {
    let earliest = -1;
    RAW_OTHER_SPEAKER_RESPONSE_PATTERNS.forEach(pattern => {
        const regex = new RegExp(pattern.source, pattern.flags.replace('g', ''));
        const match = regex.exec(text);
        if (match && (earliest === -1 || match.index < earliest)) {
            earliest = match.index;
        }
    });

    return earliest >= 0 ? text.slice(0, earliest) : text;
}

function trimLamsaTrailingNarration(text) {
    let trimmed = text;
    LAMSA_TRAILING_NARRATION_PATTERNS.forEach(pattern => {
        trimmed = trimmed.replace(pattern, '');
    });
    return trimmed.trim().replace(/[;,]\s*$/, '');
}

function findLastIntroEnd(text, patterns) {
    let lastEnd = -1;

    patterns.forEach(pattern => {
        const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
        let match;
        while ((match = regex.exec(text)) !== null) {
            lastEnd = Math.max(lastEnd, match.index + match[0].length);
            if (match[0].length === 0) regex.lastIndex += 1;
        }
    });

    return lastEnd;
}

function isJustSpeakerFormula(text) {
    return /^(?:he|Jesus)\s+(?:said|answered|replied|asked|told)(?:\s+to\s+\w+)?\.?$/i.test(text.trim());
}

function extractSingleJesusAttributedQuote(rawText) {
    const quoteBlocks = getQuoteBlocks(rawText);
    if (quoteBlocks.length !== 1) return '';

    const block = quoteBlocks[0];
    const before = rawText.slice(Math.max(0, block.start - 100), block.start);
    if (!JESUS_ATTRIBUTION_PATTERNS.some(regex => regex.test(before))) return '';
    if (RAW_OTHER_SPEAKER_PATTERNS.some(regex => regex.test(before))) return '';

    return cleanSpeechText(block.content);
}

function getQuoteBlocks(text) {
    const blocks = [];

    if (/[“”]/.test(text)) {
        let openIndex = -1;
        for (let index = 0; index < text.length; index += 1) {
            if (text[index] === '“' && openIndex === -1) {
                openIndex = index;
            } else if (text[index] === '”' && openIndex !== -1) {
                blocks.push({ start: openIndex, end: index, content: text.slice(openIndex + 1, index) });
                openIndex = -1;
            }
        }
        if (openIndex !== -1) {
            blocks.push({ start: openIndex, end: text.length - 1, content: text.slice(openIndex + 1) });
        }
        return blocks;
    }

    let openIndex = -1;
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== '"') continue;
        if (openIndex === -1) {
            openIndex = index;
        } else {
            blocks.push({ start: openIndex, end: index, content: text.slice(openIndex + 1, index) });
            openIndex = -1;
        }
    }
    if (openIndex !== -1) {
        blocks.push({ start: openIndex, end: text.length - 1, content: text.slice(openIndex + 1) });
    }

    return blocks;
}

function hasDangerousFlag(flagSet) {
    return Array.from(DANGEROUS_FLAGS).some(flag => flagSet.has(flag));
}

function hasRawOtherSpeaker(text) {
    return RAW_OTHER_SPEAKER_PATTERNS.some(regex => regex.test(text));
}

function getPurityMatches(text) {
    return PURITY_FAIL_PATTERNS
        .filter(pattern => pattern.regex.test(text))
        .map(pattern => pattern.label);
}

function hasBracketedMaterial(text) {
    return /\[[^\]]+\]/.test(text);
}

function isPurityException(text) {
    return PURITY_EXCEPTION_PATTERNS.some(regex => regex.test(text));
}

function beginsWithForbiddenPrefix(text) {
    return /^(?:to\s+(?:him|them|her)|saying\s+to\s+(?:him|them|her)|plainly),/i.test(text.trim());
}

function isOnlyFlags(flags, expected) {
    if (flags.length !== expected.length) return false;
    const expectedSet = new Set(expected);
    return flags.every(flag => expectedSet.has(flag));
}

function cleanSpeechText(value) {
    let text = stringValue(value)
        .trim()
        .replace(/\s+/g, ' ');

    while (/^["“”‘’]/.test(text)) text = text.slice(1).trimStart();
    while (/["“”‘’]$/.test(text)) text = text.slice(0, -1).trimEnd();

    return text.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}

function getAuditEntry(audit, id, translationKey) {
    const entry = audit[id]?.translations?.[translationKey];
    if (!entry) {
        return {
            rawText: '',
            flags: [],
            severity: 'high',
            notes: ['Missing audit entry.']
        };
    }

    return {
        rawText: stringValue(entry.rawText),
        flags: Array.isArray(entry.flags) ? entry.flags : [],
        severity: stringValue(entry.severity),
        notes: Array.isArray(entry.notes) ? entry.notes.map(String) : []
    };
}

function getExistingNotes(record, translationKey) {
    const notes = record.speechAudit?.[translationKey]?.notes;
    return Array.isArray(notes) ? notes.map(String) : [];
}

function getExamples(dataset, status, limit) {
    const examples = [];
    Object.entries(dataset).forEach(([id, record]) => {
        TRANSLATION_KEYS.forEach(translationKey => {
            if (examples.length >= limit) return;
            if (record.speechStatus?.[translationKey] !== status) return;
            examples.push({
                id,
                reference: record.reference || id,
                translationKey,
                severity: record.speechAudit?.[translationKey]?.severity || '',
                flags: (record.speechAudit?.[translationKey]?.flags || []).join('; '),
                rawText: truncate(record.translations?.[translationKey] || '', 220),
                notes: truncate((record.speechAudit?.[translationKey]?.notes || []).join(' | '), 260)
            });
        });
    });
    return examples;
}

function countStatus(dataset, status) {
    let count = 0;
    Object.values(dataset).forEach(record => {
        TRANSLATION_KEYS.forEach(translationKey => {
            if (record.speechStatus?.[translationKey] === status) count += 1;
        });
    });
    return count;
}

function countTranslationStrings(dataset) {
    return Object.keys(dataset).length * TRANSLATION_KEYS.length;
}

function createCategoryCounts() {
    return PROMOTION_CATEGORIES.reduce((counts, category) => {
        counts[category] = 0;
        return counts;
    }, {});
}

function toCsv(rows) {
    const columns = [
        'id',
        'reference',
        'translationKey',
        'oldStatus',
        'newStatus',
        'promotionCategory',
        'rawText',
        'oldSpeechText',
        'newSpeechText',
        'flags',
        'notes'
    ];

    const lines = [columns.join(',')];
    rows.forEach(row => {
        lines.push(columns.map(column => csvEscape(row[column])).join(','));
    });
    return lines.join('\r\n');
}

function printSummary(report) {
    console.log('Speech review queue reduction complete.');
    console.log(`Previous needs_review: ${report.previousNeedsReviewCount}`);
    console.log(`New needs_review: ${report.newNeedsReviewCount}`);
    console.log(`needs_review_text_present: ${report.needsReviewTextPresentCount}`);
    console.log(`Promoted to candidate: ${report.promotedToCandidateCount}`);
    console.log('Output files:');
    console.log(`- ${path.relative(ROOT, OUTPUT_FILE).replace(/\\/g, '/')}`);
    console.log(`- ${path.relative(ROOT, REPORT_FILE).replace(/\\/g, '/')}`);
    console.log(`- ${path.relative(ROOT, CSV_FILE).replace(/\\/g, '/')}`);
}

function loadJson(filePath, label) {
    requireFile(filePath, label);
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Could not parse ${path.relative(ROOT, filePath).replace(/\\/g, '/')}: ${error.message}`);
    }
}

function requireFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing ${label}: ${path.relative(ROOT, filePath).replace(/\\/g, '/')}`);
    }
}

function withNote(decision, note) {
    return {
        ...decision,
        notes: decision.notes.concat(note)
    };
}

function stringValue(value) {
    return typeof value === 'string' ? value : '';
}

function truncate(value, maxLength) {
    const text = stringValue(value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}...`;
}

function csvEscape(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}
