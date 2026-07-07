const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'dev', 'reports');
const INPUT_FILE = path.join(REPORT_DIR, 'speech_manual_review_sheet.csv');
const PATTERN_FILE = path.join(REPORT_DIR, 'approved_review_patterns.json');
const OUTPUT_FILE = path.join(REPORT_DIR, 'speech_manual_review_sheet_candidates_filled.csv');

const REVIEW_STATUSES = new Set(['auto_candidate_safe', 'review_needed', 'manual_required']);

function main() {
    let csv;
    let patterns;
    try {
        csv = loadCsv(INPUT_FILE, 'manual review sheet');
        patterns = loadJson(PATTERN_FILE, 'approved review patterns');
    } catch (error) {
        console.error(error.message);
        if (error.message.includes(relativePath(PATTERN_FILE))) {
            console.error('Run first: node scripts/learn_review_patterns.js');
        }
        process.exit(1);
    }

    ensureColumns(csv.headers, [
        'id',
        'reference',
        'translationKey',
        'rawText',
        'flags',
        'severity',
        'confidence',
        'notes',
        'suggestedManualSpeechText',
        'approvalStatus',
        'reviewNote'
    ]);

    const summary = createSummary();
    const outputRows = csv.rows.map(row => {
        const outputRow = { ...row };
        delete outputRow.__rowNumber;

        if (getStatus(row) === 'approved') {
            summary.approvedRows += 1;
            return outputRow;
        }

        const existingSuggestion = stringValue(row.suggestedManualSpeechText).trim();
        const decision = existingSuggestion
            ? classifyCandidate(row, existingSuggestion, [], patterns, { reusedExistingSuggestion: true })
            : buildCandidate(row, patterns);

        outputRow.suggestedManualSpeechText = decision.candidate;
        outputRow.approvalStatus = decision.status;
        outputRow.reviewNote = decision.reviewNote;

        summary.generatedRows += existingSuggestion ? 0 : 1;
        summary.reclassifiedExistingRows += existingSuggestion ? 1 : 0;
        summary[decision.status] += 1;
        if (!decision.candidate) summary.blankCandidates += 1;
        addLimited(summary.examplesByStatus[decision.status], exampleDecision(row, decision));

        return outputRow;
    });

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, `\uFEFF${toCsv(outputRows, csv.headers)}\n`, 'utf8');

    console.log('Speech manual review candidates filled.');
    console.log(`Total rows: ${csv.rows.length}`);
    console.log(`Approved rows preserved: ${summary.approvedRows}`);
    console.log(`Generated candidates: ${summary.generatedRows}`);
    console.log(`Reclassified existing candidates: ${summary.reclassifiedExistingRows}`);
    console.log(`auto_candidate_safe: ${summary.auto_candidate_safe}`);
    console.log(`review_needed: ${summary.review_needed}`);
    console.log(`manual_required: ${summary.manual_required}`);
    console.log(`Blank candidates: ${summary.blankCandidates}`);
    console.log(`Gold-standard approved examples available: ${patterns.totalApprovedRows || 0}`);
    console.log(`Output file: ${relativePath(OUTPUT_FILE)}`);
}

function buildCandidate(row, patterns) {
    const rawText = stringValue(row.rawText);
    if (!rawText.trim()) {
        return classifyCandidate(row, '', ['blank rawText'], patterns);
    }

    const operations = [];
    let candidate = normalizeReadableSpacing(rawText);

    const footnoteCleaned = removeFootnoteMarkers(candidate);
    if (footnoteCleaned !== candidate) {
        candidate = footnoteCleaned;
        operations.push('removed footnote markers');
    }

    const quoteInfo = analyzeQuotes(candidate);
    const parableContext = isParableContext(row, candidate);
    const quoted = selectQuotedSpeech(row, candidate, quoteInfo);

    if (quoted.candidate) {
        candidate = quoted.candidate;
        operations.push(...quoted.operations);
    } else {
        const embeddedJesusSaying = extractEmbeddedJesusSaying(candidate, row);
        if (embeddedJesusSaying.changed) {
            candidate = embeddedJesusSaying.text;
            operations.push(embeddedJesusSaying.operation);
        } else {
            const mixedExtraction = extractAfterLastJesusFormula(candidate, row);
            if (mixedExtraction.changed) {
                candidate = mixedExtraction.text;
                operations.push(mixedExtraction.operation);
            } else {
                const leading = removeLeadingNarration(candidate, row, parableContext);
                if (leading.changed) {
                    candidate = leading.text;
                    operations.push(leading.operation);
                } else if (isOnlySpeakerSetup(candidate)) {
                    candidate = '';
                    operations.push('blanked standalone speaker setup');
                }
            }
        }
    }

    const trailing = removeTrailingNarration(candidate, row, parableContext);
    if (trailing.changed) {
        candidate = trailing.text;
        operations.push(...trailing.operations);
    }

    const artifactCleaned = stripQuoteArtifacts(candidate);
    if (artifactCleaned !== candidate) {
        candidate = artifactCleaned;
        operations.push('removed quote artifacts');
    }

    candidate = normalizeReadableSpacing(candidate);

    return classifyCandidate(row, candidate, operations, patterns, {
        quoteInfo,
        quotedDecision: quoted,
        parableContext
    });
}

function classifyCandidate(row, candidateValue, operations, patterns, context = {}) {
    const candidate = normalizeReadableSpacing(candidateValue);
    const rawText = normalizeReadableSpacing(row.rawText);
    const flags = splitList(row.flags);
    const parableContext = context.parableContext === undefined ? isParableContext(row, rawText) : context.parableContext;
    const quoteInfo = context.quoteInfo || analyzeQuotes(rawText);
    const manualReasons = [];
    const reviewReasons = [];
    const otherSpeakerMixed = hasOtherSpeakerMixedIntoRaw(row, rawText, parableContext);
    const candidateOtherSpeaker = getOtherSpeakerMatches(candidate, parableContext);
    const candidateNarration = getNarrationMatches(candidate, row, parableContext);
    const simpleApprovedPattern = matchesSimpleApprovedPattern(row, candidate, patterns);

    if (!candidate) {
        manualReasons.push('candidate is blank');
    }

    if (otherSpeakerMixed) {
        manualReasons.push('other-speaker material appears mixed into the raw verse');
    }

    if (candidateOtherSpeaker.length > 0) {
        manualReasons.push(`candidate still contains likely other-speaker wording: ${candidateOtherSpeaker.join('; ')}`);
    }

    if (candidateNarration.length > 0) {
        manualReasons.push(`candidate still appears to contain narration: ${candidateNarration.join('; ')}`);
    }

    if (/\[[^\]]+\]/.test(candidate)) {
        manualReasons.push('candidate contains square-bracketed text');
    }

    if (quoteInfo.hasUnmatchedQuotes && !context.quotedDecision?.simpleQuoteArtifact) {
        reviewReasons.push('unusual quote boundary');
    }

    if (quoteInfo.ranges.length > 1) {
        reviewReasons.push('multiple quote blocks');
    }

    if (/\([^)]*\)/.test(candidate)) {
        reviewReasons.push('candidate contains parenthetical material');
    }

    if (getCandidateQuoteRisk(candidate).length > 0) {
        reviewReasons.push('candidate has unusual quote structure');
    }

    if (parableContext) {
        reviewReasons.push('parable context kept intact');
    }

    if (flags.includes('embedded_quote')) {
        reviewReasons.push('embedded quotation inside Jesus speech');
    }

    if (flags.includes('anchor_mismatch_risk') && operations.length === 0 && !simpleApprovedPattern) {
        reviewReasons.push('anchor mismatch risk without a mechanical cleanup');
    }

    if ((stringValue(row.severity) === 'definite' || stringValue(row.severity) === 'high') && operations.length === 0 && !simpleApprovedPattern) {
        reviewReasons.push('high-risk row needs human confirmation');
    }

    let status = 'auto_candidate_safe';
    let reasons = operations.length > 0 ? operations : ['candidate matches raw text after normalization'];

    if (manualReasons.length > 0) {
        status = 'manual_required';
        reasons = manualReasons.concat(operations);
    } else if (reviewReasons.length > 0) {
        status = 'review_needed';
        reasons = reviewReasons.concat(operations);
    }

    if (!REVIEW_STATUSES.has(status)) {
        throw new Error(`Internal error: unknown generated status ${status}`);
    }

    return {
        candidate,
        status,
        reviewNote: buildReviewNote(status, dedupe(reasons)),
        operations,
        manualReasons,
        reviewReasons
    };
}

function selectQuotedSpeech(row, text, quoteInfo) {
    const operations = [];

    if (quoteInfo.ranges.length > 0) {
        const quoteCandidates = quoteInfo.ranges
            .map(range => ({
                range,
                content: normalizeReadableSpacing(range.content),
                attribution: classifyQuoteAttribution(row, text, range)
            }))
            .filter(candidate => candidate.content);

        if (quoteCandidates.length > 1 && hasTranslatorGlossBetweenQuotes(text, quoteInfo.ranges)) {
            return {
                candidate: quoteCandidates.map(candidate => candidate.content).join(' '),
                operations: ['combined translated quote blocks'],
                simpleQuoteArtifact: false
            };
        }

        const jesusCandidates = quoteCandidates.filter(candidate => candidate.attribution === 'jesus');
        if (jesusCandidates.length === 1) {
            return {
                candidate: jesusCandidates[0].content,
                operations: [`selected quoted Jesus speech after ${jesusCandidates[0].attribution} attribution`],
                simpleQuoteArtifact: quoteInfo.ranges.length === 1 && !quoteInfo.hasUnmatchedQuotes
            };
        }

        if (quoteCandidates.length === 1 && isLikelyExternalAttribution(text.slice(0, quoteCandidates[0].range.start), row)) {
            return {
                candidate: quoteCandidates[0].content,
                operations: ['selected sole quoted speech after external attribution'],
                simpleQuoteArtifact: !quoteInfo.hasUnmatchedQuotes
            };
        }
    }

    if (quoteInfo.firstUnmatchedClosingIndex >= 0) {
        const before = text.slice(0, quoteInfo.firstUnmatchedClosingIndex);
        const after = text.slice(quoteInfo.firstUnmatchedClosingIndex + 1);
        if (before.trim() && isLikelySpeechBeforeUnmatchedClose(before, after, row)) {
            operations.push('removed suffix after unmatched closing quote');
            return {
                candidate: before,
                operations,
                simpleQuoteArtifact: true
            };
        }
    }

    if (quoteInfo.firstUnmatchedOpeningIndex >= 0) {
        const after = text.slice(quoteInfo.firstUnmatchedOpeningIndex + 1);
        if (after.trim() && isLikelyExternalAttribution(text.slice(0, quoteInfo.firstUnmatchedOpeningIndex), row)) {
            operations.push('selected speech after unmatched opening quote');
            return {
                candidate: after,
                operations,
                simpleQuoteArtifact: false
            };
        }
    }

    return {
        candidate: '',
        operations,
        simpleQuoteArtifact: false
    };
}

function classifyQuoteAttribution(row, text, range) {
    const prefix = text.slice(Math.max(0, range.start - 180), range.start);
    const lastJesus = lastPatternIndex(prefix, [
        /\bJesus\s+(?:said|says|answered|replied|asked|told|declared|cried(?:\s+out)?|called|ordered|commanded|charged|prayed)\b/i,
        /\bhe\s+(?:said|says|answered|replied|asked|told|ordered|commanded|charged|prayed)\s+to\s+(?:him|them|her|the\s+\w+)\b/i,
        /\bhe\s+(?:said|says|answered|replied|asked|prayed)\b/i,
        /\bthe\s+one\s+who\s+(?:testifies|attests)\s+to\s+these\s+things\s+says\b/i
    ]);
    const lastOther = lastPatternIndex(prefix, OTHER_SPEAKER_FORMULA_PATTERNS.map(item => item.regex));

    if (lastJesus >= 0 && lastJesus >= lastOther) return 'jesus';
    if (lastOther >= 0) return 'other_speaker';
    if (isLikelyExternalAttribution(prefix, row)) return 'jesus';
    return 'unknown';
}

function extractAfterLastJesusFormula(text, row) {
    const patterns = [
        /\bJesus\s+(?:again\s+)?(?:said|says|answered|replied|asked|told|declared|cried(?:\s+out)?|called|ordered|commanded|charged)\s*(?:to\s+(?:him|them|her|the\s+people|the\s+crowds?|his\s+disciples|the\s+\w+))?\s*,\s*/gi,
        /\b(?:He|he)\s+(?:said|says|answered|replied|asked|told)\s+to\s+(?:him|them|her)\s*,\s*/g,
        /\b(?:He|he)\s+(?:answered|replied|asked)\s*,\s*/g,
        /\bwhat\s+Jesus\s+said\s+was\s+not\b[^,]*,\s*but,?\s*/gi
    ];

    let best = null;
    patterns.forEach(regex => {
        let match;
        while ((match = regex.exec(text)) !== null) {
            const before = text.slice(0, match.index);
            const after = text.slice(match.index + match[0].length);
            if (!after.trim()) continue;
            if (!/\bJesus\b/i.test(match[0]) && !hasOtherSpeakerFormula(before) && !/\bJesus\b/i.test(before)) continue;
            if (!best || match.index > best.index) {
                best = {
                    index: match.index,
                    text: after,
                    operation: `removed speaker setup: ${normalizeReadableSpacing(match[0])}`
                };
            }
        }
    });

    if (!best) return { changed: false, text };

    const cleaned = removeTrailingNarration(best.text, row, false);
    return {
        changed: true,
        text: cleaned.text,
        operation: best.operation
    };
}

function removeLeadingNarration(text, row, parableContext) {
    if (parableContext && startsWithParableInternalAttribution(text)) {
        return { changed: false, text };
    }

    const directPatterns = [
        {
            label: 'removed parable introduction',
            regex: /^(?:And\s+|But\s+|Then\s+)?(?:He|he)\s+put\s+before\s+them\s+another\s+parable\s*[:,]\s*/i
        },
        {
            label: 'removed Jesus began setup',
            regex: /^(?:And\s+|But\s+|Then\s+|Now\s+|So\s+|As\s+[^,]{1,80},\s*)?Jesus\s+began\s+to\s+(?:say|speak|teach|preach|proclaim|tell)[^,;:.!?]{0,120}[:,]\s*/i
        },
        {
            label: 'removed Jesus rebuke setup',
            regex: /^(?:And\s+|But\s+|Then\s+|Now\s+|So\s+)?Jesus\s+rebuked\s+(?:him|them|her),\s+saying,\s*/i
        },
        {
            label: 'removed Jesus speaker setup',
            regex: /^(?:And\s+|But\s+|Then\s+|Now\s+|So\s+|At\s+that\s+(?:very\s+)?(?:hour|time)\s+)?Jesus\s+(?:then\s+|again\s+)?(?:said|says|answered|replied|asked|told|declared|cried(?:\s+out)?|called|ordered|commanded|charged)\s*(?:to\s+(?:him|them|her|the\s+people|the\s+crowds?|his\s+disciples|Peter|the\s+\w+))?\s*[:,]\s*/i
        },
        {
            label: 'removed generic speaker setup',
            regex: /^(?:And\s+|But\s+|Then\s+|Now\s+|So\s+)?(?:He|he)\s+(?:said|says|answered|replied|asked|told|began\s+to\s+(?:say|speak))\s*(?:to\s+(?:him|them|her|the\s+\w+|his\s+disciples|Peter))?\s*[:,]\s*/i
        },
        {
            label: 'removed saying formula',
            regex: /^saying\s+to\s+(?:him|them|her)\s*,\s*/i
        }
    ];

    for (const pattern of directPatterns) {
        if (!pattern.regex.test(text)) continue;
        const cleaned = text.replace(pattern.regex, '');
        if (cleaned.trim().length < 3) continue;
        return {
            changed: true,
            text: cleaned,
            operation: pattern.label
        };
    }

    const generic = findExternalNarrativePrefix(text, row, parableContext);
    if (generic) {
        return {
            changed: true,
            text: text.slice(generic.end),
            operation: `removed outer narration before speech: ${truncate(normalizeReadableSpacing(text.slice(0, generic.end)), 90)}`
        };
    }

    return { changed: false, text };
}

function findExternalNarrativePrefix(text, row, parableContext) {
    const limit = Math.min(text.length, 240);
    const prefix = text.slice(0, limit);
    const regex = /\b(?:Jesus|he)\b[\s\S]{0,120}?\b(?:said|says|answered|replied|asked|told|ordered|commanded|charged|cried|prayed|began\s+to\s+(?:say|speak|teach|preach|proclaim))\b[\s\S]{0,100}?[:,]\s*/ig;
    let match;
    let best = null;

    while ((match = regex.exec(prefix)) !== null) {
        const candidatePrefix = prefix.slice(0, match.index + match[0].length);
        const after = text.slice(candidatePrefix.length);
        if (!after.trim()) continue;
        if (parableContext && !/\bJesus\b/i.test(candidatePrefix) && startsWithParableInternalAttribution(text)) continue;
        if (!/\bJesus\b/i.test(candidatePrefix) && !/^(?:And|But|Then|When|As|After|At|From|While|So)\b/i.test(candidatePrefix)) continue;
        best = { end: candidatePrefix.length };
    }

    return best;
}

function removeTrailingNarration(text, row, parableContext) {
    let candidate = text;
    const operations = [];

    const patterns = [
        {
            label: 'removed other-speaker reply after Jesus speech',
            regex: /\s+(?:And\s+)?(?:they|They)\s+(?:said|say|answered|replied)\s+(?:to\s+him,?\s*)?.+$/i,
            allowInParable: false
        },
        {
            label: 'removed Judas standing narration',
            regex: /\s+Jud(?:as|ah)\b.+$/i,
            allowInParable: false
        },
        {
            label: 'removed disciples fleeing narration',
            regex: /\s+Then\s+all\s+the\s+disciples\b.+$/i,
            allowInParable: false
        },
        {
            label: 'removed Peter weeping narration',
            regex: /\s+And\s+he\s+went\s+outside\s+and\s+wept\s+bitterly\.?$/i,
            allowInParable: false
        },
        {
            label: 'removed from-that-hour narration',
            regex: /\s+And\s+from\s+that\s+hour\b.+$/i,
            allowInParable: false
        },
        {
            label: 'removed departure narration',
            regex: /\s+(?:Then|And)\s+he\s+(?:left\s+them\s+and\s+went\s+away|went\s+away|departed|followed\s+him|got\s+up\s+and\s+followed)\.?$/i,
            allowInParable: false
        },
        {
            label: 'removed healing result narration',
            regex: /\s+(?:and\s+)?(?:immediately\s+)?(?:his|the|her|their)\s+(?:servant|boy|daughter|woman|eyes|leprosy|skin\s+disease)\s+(?:was|were|left|opened|healed|cleansed|saw)\b.+$/i,
            allowInParable: false
        },
        {
            label: 'removed demon-result narration',
            regex: /\s+The\s+demon\s+threw\s+him\b.+$/i,
            allowInParable: false
        },
        {
            label: 'removed reader aside',
            regex: /\s+\(Let\s+the\s+reader\s+understand\)\s*\.?$/i,
            allowInParable: true
        },
        {
            label: 'removed foods-clean narrator aside',
            regex: /\s+\(Thus\s+he\s+declared\s+all\s+foods\s+clean\.?\)\s*$/i,
            allowInParable: false
        },
        {
            label: 'removed attribution dash suffix',
            regex: /\s*[—-]\s*he\s+said\s+to\s+the\s+paralytic\s*[—-]?\s*$/i,
            allowInParable: false
        }
    ];

    let changed = true;
    while (changed) {
        changed = false;
        for (const pattern of patterns) {
            if (parableContext && !pattern.allowInParable) continue;
            if (!pattern.regex.test(candidate)) continue;
            const next = candidate.replace(pattern.regex, '');
            if (!next.trim() || next === candidate) continue;
            candidate = next;
            operations.push(pattern.label);
            changed = true;
            break;
        }
    }

    return {
        changed: operations.length > 0,
        text: candidate,
        operations
    };
}

function removeFootnoteMarkers(text) {
    return stringValue(text)
        .replace(/([”"])\s*[a-z]{1,3}$/g, '$1')
        .replace(/[†‡§]/g, '')
        .replace(/\{\d+\}/g, '')
        .replace(/\s+\*\s+/g, ' ')
        .replace(/\*/g, '');
}

function stripQuoteArtifacts(text) {
    let candidate = stringValue(text).trim();

    candidate = candidate.replace(/^[“”"]+/, '').replace(/[“”"]+$/, '');
    if (/^‘/.test(candidate) && /’$/.test(candidate)) {
        candidate = candidate.replace(/^‘\s*/, '').replace(/\s*’$/, '');
    }
    candidate = candidate.replace(/[“”]/g, '');
    candidate = candidate.replace(/"{2,}/g, '"');
    candidate = candidate.replace(/^\s*"\s*/, '').replace(/\s*"\s*$/, '');

    return candidate;
}

function analyzeQuotes(text) {
    const ranges = [];
    const unmatchedClosings = [];
    const unmatchedOpenings = [];

    collectPairedRanges(text, '“', '”', ranges, unmatchedOpenings, unmatchedClosings);
    if (!/[“”]/.test(text)) {
        collectStraightDoubleRanges(text, ranges, unmatchedOpenings, unmatchedClosings);
    }
    if (/‘/.test(text)) {
        collectPairedRanges(text, '‘', '’', ranges, unmatchedOpenings, unmatchedClosings);
    }

    ranges.sort((left, right) => left.start - right.start);

    return {
        ranges,
        firstUnmatchedOpeningIndex: unmatchedOpenings.length > 0 ? Math.min(...unmatchedOpenings) : -1,
        firstUnmatchedClosingIndex: unmatchedClosings.length > 0 ? Math.min(...unmatchedClosings) : -1,
        hasUnmatchedQuotes: unmatchedOpenings.length > 0 || unmatchedClosings.length > 0,
        unmatchedOpeningCount: unmatchedOpenings.length,
        unmatchedClosingCount: unmatchedClosings.length
    };
}

function collectPairedRanges(text, openChar, closeChar, ranges, unmatchedOpenings, unmatchedClosings) {
    let openIndex = -1;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === openChar && openIndex === -1) {
            openIndex = index;
            continue;
        }

        if (char !== closeChar) continue;

        if (openIndex === -1) {
            unmatchedClosings.push(index);
            continue;
        }

        ranges.push({
            start: openIndex,
            end: index,
            content: text.slice(openIndex + 1, index),
            openChar,
            closeChar
        });
        openIndex = -1;
    }

    if (openIndex !== -1) {
        unmatchedOpenings.push(openIndex);
        ranges.push({
            start: openIndex,
            end: text.length - 1,
            content: text.slice(openIndex + 1),
            openChar,
            closeChar,
            incomplete: true
        });
    }
}

function collectStraightDoubleRanges(text, ranges, unmatchedOpenings, unmatchedClosings) {
    let openIndex = -1;
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== '"') continue;
        if (openIndex === -1) {
            openIndex = index;
        } else {
            ranges.push({
                start: openIndex,
                end: index,
                content: text.slice(openIndex + 1, index),
                openChar: '"',
                closeChar: '"'
            });
            openIndex = -1;
        }
    }
    if (openIndex !== -1) unmatchedOpenings.push(openIndex);
}

function hasTranslatorGlossBetweenQuotes(text, ranges) {
    if (ranges.length < 2) return false;
    const between = [];
    for (let index = 0; index < ranges.length - 1; index += 1) {
        between.push(text.slice(ranges[index].end + 1, ranges[index + 1].start));
    }
    return between.every(part => /^\s*(?:that\s+is|which\s+means|meaning|literally|i\.e\.)[:,]?\s*$/i.test(part));
}

function extractEmbeddedJesusSaying(text, row) {
    if (!splitList(row.flags).includes('other_speaker') && !hasOtherSpeakerFormula(text)) {
        return { changed: false, text };
    }

    const patterns = [
        {
            label: 'extracted embedded Jesus saying from other-speaker report',
            regex: /\bhe\s+(?:now\s+)?say\s+that\s+[‘"“]?([^’”"]+?)[’”"]?\??$/i
        },
        {
            label: 'extracted embedded Jesus saying from other-speaker report',
            regex: /\b(?:he|Jesus)\s+(?:says?|said)\s*,\s*[‘"“]?([^’”"]+?)[’”"]?\??$/i
        },
        {
            label: 'extracted embedded Jesus saying from other-speaker report',
            regex: /\bby\s+saying,\s*[‘"“]?([^’”"]+?)[’”"]?\??$/i
        },
        {
            label: 'extracted remembered Jesus saying',
            regex: /\bused\s+to\s+say\s+when\s+he\s+was\s+alive,\s*(.+)$/i
        }
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern.regex);
        if (!match || !match[1] || !match[1].trim()) continue;
        return {
            changed: true,
            text: match[1],
            operation: pattern.label
        };
    }

    return { changed: false, text };
}

function isLikelySpeechBeforeUnmatchedClose(before, after, row) {
    const cleanBefore = before.trim();
    if (!cleanBefore) return false;
    if (hasOtherSpeakerFormula(after)) return true;
    if (hasObviousTrailingNarration(after)) return true;
    if (/^\s*\([^)]*(?:reader|declared|fulfilled|scripture)[^)]*\)\s*$/i.test(after)) return true;
    if (isLikelyAlreadySpeech(cleanBefore, row)) return true;
    return false;
}

function isLikelyExternalAttribution(prefix, row) {
    const text = normalizeReadableSpacing(prefix);
    if (!text) return false;
    if (/\bJesus\b/i.test(text)) return true;
    if (/\b(?:he|He)\s+(?:said|says|answered|replied|asked|told|ordered|commanded|charged|prayed)\b/i.test(text) &&
        !startsWithParableInternalAttribution(text) &&
        !hasOtherSpeakerFormula(text)) {
        return true;
    }
    if (/\bthe\s+one\s+who\s+(?:testifies|attests)\s+to\s+these\s+things\s+says\b/i.test(text)) return true;
    if (splitList(row.flags).some(flag => ['long_prefix_before_quote', 'pre_speech_narration', 'speaker_setup'].includes(flag)) &&
        !hasOtherSpeakerFormula(text)) {
        return true;
    }
    return false;
}

function hasObviousTrailingNarration(text) {
    return /\b(?:Then\s+all\s+the\s+disciples|And\s+from\s+that\s+hour|Then\s+he\s+left|Thus\s+he\s+declared|Let\s+the\s+reader\s+understand|Judas|Judah)\b/i.test(text);
}

function isOnlySpeakerSetup(text) {
    return /^(?:But\s+in\s+reply\s+)?(?:Jesus|he|He)\s+(?:said|says|answered|replied|asked|told)\s*(?:to\s+(?:him|them|her|the\s+\w+))?\s*[:,]?\s*$/i.test(text);
}

function hasOtherSpeakerMixedIntoRaw(row, rawText, parableContext) {
    if (parableContext && !/^\s*(?:They|Peter|Thomas|She|His\s+disciples|The\s+disciples)\b/i.test(rawText)) {
        return false;
    }

    if (splitList(row.flags).includes('other_speaker')) {
        if (isEmbeddedSpeechReport(rawText)) return false;
        return true;
    }

    return hasOtherSpeakerFormula(rawText) && !isEmbeddedSpeechReport(rawText);
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

function matchesSimpleApprovedPattern(row, candidate, patterns) {
    const rawText = normalizeReadableSpacing(row.rawText);
    const flags = splitList(row.flags);
    if (candidate !== rawText) return false;
    if (/[()[\]“”"]/.test(candidate)) return false;
    if (hasOtherSpeakerFormula(candidate) && !isEmbeddedSpeechReport(candidate)) return false;
    if (flags.every(flag => ['bracket_or_editorial_material', 'post_speech_narration', 'quote_artifact', 'anchor_mismatch_risk'].includes(flag))) {
        return Boolean(patterns.rawTextEqualsSuggestedManualSpeechText?.count);
    }
    return flags.length === 0;
}

function isLikelyAlreadySpeech(text, row) {
    if (!text.trim()) return false;
    if (/^(?:And|But|For|So|When|If|Because|Therefore|Truly|Amen|I|You|My|Father|The|Blessed|Woe|Let|See|Look|Do|Go|What|Why|How|Where|Who)\b/i.test(text)) {
        return true;
    }
    if (stringValue(row.bsbAnchor) && overlapScore(text, row.bsbAnchor) > 0.45) return true;
    return false;
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

function startsWithParableInternalAttribution(text) {
    return /^\s*(?:But\s+in\s+reply\s+)?(?:His|The|their|a)\s+(?:master|lord|father|king|servant|slave|son|owner|manager|steward|bridegroom)\s+(?:said|replied|answered)\b/i.test(text) ||
        /^\s*(?:But\s+)?(?:he|He)\s+replied,\s*[‘'"]/i.test(text);
}

function isEmbeddedSpeechReport(text) {
    return /\b(?:many|people|they|you|those|everyone|whoever)\s+(?:will\s+)?say\b/i.test(text) ||
        /\b(?:it\s+was\s+said|you\s+have\s+heard\s+it\s+was\s+said|you\s+say|they\s+said\s+he\s+is|they\s+say)\b/i.test(text);
}

function hasOtherSpeakerFormula(text) {
    return OTHER_SPEAKER_FORMULA_PATTERNS.some(pattern => pattern.regex.test(text));
}

function overlapScore(left, right) {
    const leftTokens = new Set(tokenize(left).filter(token => token.length > 2));
    const rightTokens = new Set(tokenize(right).filter(token => token.length > 2));
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
    let shared = 0;
    leftTokens.forEach(token => {
        if (rightTokens.has(token)) shared += 1;
    });
    return shared / Math.min(leftTokens.size, rightTokens.size);
}

function normalizeReadableSpacing(value) {
    return stringValue(value)
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/([a-z0-9])([“‘"])/g, '$1 $2')
        .replace(/([”’"])([A-Za-z0-9])/g, '$1 $2')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/([,;:])(?=\S)/g, '$1 ')
        .replace(/([.!?])(?=[A-Z“‘"])/g, '$1 ')
        .replace(/\b(now|therefore|then)(for|and|but)\b/ig, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
}

function getCandidateQuoteRisk(text) {
    const value = stringValue(text);
    const risks = [];
    const leftDouble = (value.match(/“/g) || []).length;
    const rightDouble = (value.match(/”/g) || []).length;
    const straightDouble = (value.match(/"/g) || []).length;
    const leftSingle = (value.match(/‘/g) || []).length;
    const rightSingle = (value.match(/’/g) || []).length;

    if (leftDouble !== rightDouble) risks.push('unmatched curly double quotes');
    if (straightDouble % 2 !== 0) risks.push('unmatched straight double quote');
    if (leftSingle > 0 && rightSingle < leftSingle) risks.push('unmatched curly single quotes');
    return risks;
}

function buildReviewNote(status, reasons) {
    const prefix = {
        auto_candidate_safe: 'script: auto candidate',
        review_needed: 'script: review needed',
        manual_required: 'script: manual required'
    }[status];
    const reasonText = reasons.filter(Boolean).join('; ');
    return reasonText ? `${prefix}; ${reasonText}` : prefix;
}

function createSummary() {
    return {
        approvedRows: 0,
        generatedRows: 0,
        reclassifiedExistingRows: 0,
        auto_candidate_safe: 0,
        review_needed: 0,
        manual_required: 0,
        blankCandidates: 0,
        examplesByStatus: {
            auto_candidate_safe: [],
            review_needed: [],
            manual_required: []
        }
    };
}

function exampleDecision(row, decision) {
    return {
        id: stringValue(row.id),
        reference: stringValue(row.reference),
        translationKey: stringValue(row.translationKey),
        status: decision.status,
        candidate: truncate(decision.candidate, 180),
        reviewNote: decision.reviewNote
    };
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

function loadJson(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing ${label}: ${relativePath(filePath)}`);
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Could not parse ${relativePath(filePath)}: ${error.message}`);
    }
}

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

function toCsv(rows, columns) {
    const lines = [columns.join(',')];
    rows.forEach(row => {
        lines.push(columns.map(column => csvEscape(row[column])).join(','));
    });
    return lines.join('\r\n');
}

function csvEscape(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function ensureColumns(headers, requiredColumns) {
    const missing = requiredColumns.filter(column => !headers.includes(column));
    if (missing.length > 0) {
        throw new Error(`Manual review sheet is missing required column(s): ${missing.join(', ')}`);
    }
}

function splitList(value) {
    return stringValue(value)
        .split(';')
        .map(item => item.trim())
        .filter(Boolean);
}

function tokenize(text) {
    return stringValue(text).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
}

function lastPatternIndex(text, patterns) {
    let lastIndex = -1;
    patterns.forEach(pattern => {
        const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
        const regex = new RegExp(pattern.source, flags);
        let match;
        while ((match = regex.exec(text)) !== null) {
            lastIndex = Math.max(lastIndex, match.index);
            if (match[0].length === 0) regex.lastIndex += 1;
        }
    });
    return lastIndex;
}

function addLimited(list, value) {
    if (list.length < 12) list.push(value);
}

function dedupe(values) {
    return Array.from(new Set(values.filter(Boolean)));
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
