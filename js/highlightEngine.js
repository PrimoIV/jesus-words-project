import {
    COMMON_NOUNS,
    COMMON_VERB_STEMS,
    CRITICAL_WORDS,
    GRAMMAR_EQUIVALENTS,
    INTERPRETIVE_TERMS,
    LOW_SIGNAL_TERMS,
    PROTECTED_LOW_SIGNAL_EXCEPTIONS,
    PROTECTED_TERMS
} from './highlightRules.js';

const HIGHLIGHT_LIMIT = 4;
const SEMANTIC_CONFIDENCE_THRESHOLD = 0.45;
const FUNCTION_WORDS = new Set([
    'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
    'now', 'then', 'therefore', 'thus', 'that', 'this', 'these', 'those',
    'who', 'whom', 'whose', 'whoever', 'what', 'whatever', 'which', 'where',
    'when', 'whenever', 'why', 'how', 'if', 'because', 'than', 'any', 'anyone',
    'someone', 'everyone', 'noone', 'one',
    'to', 'of', 'in', 'on', 'at', 'by', 'from', 'with', 'about', 'as',
    'into', 'through', 'after', 'before', 'over', 'under', 'among', 'between',
    'against', 'without', 'within', 'he', 'she', 'it', 'they', 'them', 'him',
    'her', 'his', 'their', 'theirs', 'its', 'we', 'us', 'our', 'ours', 'i',
    'me', 'my', 'mine', 'your', 'yours', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'am', 'do', 'does', 'did', 'have', 'has', 'had', 'will',
    'would', 'shall', 'should', 'can', 'could', 'may', 'might'
]);
const PRIORITY = {
    critical: 5,
    interpretive: 4,
    meaning: 3,
    wording: 2,
    grammar: 1
};

const CRITICAL_SET = new Set(CRITICAL_WORDS);
const PROTECTED_SET = new Set(PROTECTED_TERMS);
const LOW_SIGNAL_SET = new Set(LOW_SIGNAL_TERMS.map(normalizePhrase));
const COMMON_NOUN_SET = new Set(COMMON_NOUNS.map(normalizePhrase));
const COMMON_VERB_STEM_BY_TERM = buildGroupLookup(COMMON_VERB_STEMS);
const HIGH_FREQUENCY_SET = new Set([
    ...LOW_SIGNAL_SET,
    ...COMMON_NOUN_SET,
    ...COMMON_VERB_STEMS.flatMap(group => group.map(normalizePhrase))
]);
const PROTECTED_LOW_SIGNAL_EXCEPTION_SET = new Set(PROTECTED_LOW_SIGNAL_EXCEPTIONS.map(normalizePhrase));
const GRAMMAR_KEY_BY_TERM = buildGroupLookup(GRAMMAR_EQUIVALENTS);
const INTERPRETIVE_GROUP_BY_TERM = buildGroupLookup(INTERPRETIVE_TERMS, true);
const INTERPRETIVE_PHRASE_GROUPS = INTERPRETIVE_TERMS
    .map(group => group.map(normalizePhrase).filter(Boolean))
    .filter(group => group.some(term => term.includes(' ')));
let REVIEW_OVERRIDES = [];

function buildGroupLookup(groups, storeGroup = false) {
    const lookup = new Map();
    groups.forEach(group => {
        const normalizedGroup = group.map(normalizePhrase).filter(Boolean);
        const key = normalizedGroup[0];
        normalizedGroup.forEach(term => {
            if (!storeGroup) {
                lookup.set(term, key);
                return;
            }
            const existing = lookup.get(term) || [];
            lookup.set(term, Array.from(new Set([...existing, ...normalizedGroup])));
        });
    });
    return lookup;
}

export function tokenizeText(text) {
    if (!text) return [];
    const tokens = [];
    const pattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const value = match[0];
        tokens.push({
            text: value,
            normalized: normalizeToken(value),
            start: match.index,
            end: match.index + value.length
        });
    }
    return tokens;
}

export function normalizeToken(token) {
    return String(token || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}'’]+/gu, '')
        .replace(/^['’]+|['’]+$/g, '')
        .toLowerCase();
}

export function normalizePhrase(phrase) {
    return tokenizeText(phrase)
        .map(token => token.normalized)
        .filter(Boolean)
        .join(' ');
}

export function getGrammarKey(token) {
    const normalized = normalizeToken(token);
    return GRAMMAR_KEY_BY_TERM.get(normalized) || normalized;
}

export function areGrammarEquivalent(a, b) {
    const normA = normalizeToken(a);
    const normB = normalizeToken(b);
    if (!normA || !normB) return false;
    return getGrammarKey(normA) === getGrammarKey(normB);
}

export function getInterpretiveGroup(token) {
    return INTERPRETIVE_GROUP_BY_TERM.get(normalizePhrase(token)) || null;
}

export function setHighlightReviewLayer(reviewLayer = {}) {
    REVIEW_OVERRIDES = (reviewLayer.overrides || [])
        .map(override => ({
            match: (override.match || []).map(normalizePhrase).filter(Boolean),
            forceType: override.forceType,
            reason: override.reason || 'Review override'
        }))
        .filter(override => override.match.length >= 2 && PRIORITY[override.forceType]);
}

export function classifyDifference(token, comparisonTokens) {
    const normalized = normalizeToken(token);
    const comparison = Array.from(comparisonTokens || []).map(normalizeToken).filter(Boolean);
    const comparisonSet = new Set(comparison);
    const comparisonGrammarKeys = new Set(comparison.map(getGrammarKey));
    const interpretiveGroup = getInterpretiveGroup(normalized);
    const hasExactMatch = comparisonSet.has(normalized);
    const hasGrammarMatch = comparisonGrammarKeys.has(getGrammarKey(normalized));
    const matchedInterpretiveTerms = interpretiveGroup
        ? interpretiveGroup.filter(term => term !== normalized && comparisonSet.has(term))
        : [];
    const hasInterpretiveMatch = matchedInterpretiveTerms.length > 0;

    if (!normalized) {
        return {
            type: 'grammar',
            reason: 'No lexical token',
            matchedGroup: null
        };
    }

    const reviewOverride = findReviewOverride(normalized, comparisonSet);
    if (reviewOverride) return reviewOverride;

    if (FUNCTION_WORDS.has(normalized)) {
        return {
            type: 'grammar',
            reason: 'Function word hidden in meaning mode',
            matchedGroup: null
        };
    }

    if (hasExactMatch) {
        return {
            type: 'grammar',
            reason: 'Same normalized wording appears in another translation',
            matchedGroup: null
        };
    }

    if (hasInterpretiveMatch) {
        return {
            type: 'interpretive',
            reason: 'Known interpretive translation-choice term',
            matchedGroup: interpretiveGroup,
            matchedTerms: matchedInterpretiveTerms
        };
    }

    if (hasGrammarMatch) {
        return {
            type: 'grammar',
            reason: 'Grammar-only equivalent',
            matchedGroup: null
        };
    }

    if (CRITICAL_SET.has(normalized)) {
        return {
            type: 'critical',
            reason: 'Critical word differs across translations',
            matchedGroup: interpretiveGroup
        };
    }

    if (PROTECTED_SET.has(normalized)) {
        return {
            type: 'meaning',
            reason: 'Protected term differs across translations',
            matchedGroup: interpretiveGroup
        };
    }

    return {
        type: 'meaning',
        reason: 'Meaning-bearing wording differs across translations',
        matchedGroup: null
    };
}

export function buildHighlightSpans(text, comparisonTexts = [], mode = 'meaning', translation = '') {
    return buildHighlightSpansWithDiagnostics(text, comparisonTexts, mode, translation).spans;
}

export function buildHighlightSpansWithDiagnostics(text, comparisonTexts = [], mode = 'meaning', translation = '') {
    if (!text || mode === 'clean') {
        return {
            spans: [],
            suppressedLowSignal: [],
            suppressedByConfidence: []
        };
    }

    const tokens = tokenizeText(text);
    const comparisonTokens = comparisonTexts.flatMap(item => tokenizeText(item).map(token => token.normalized));
    const comparisonSet = new Set(comparisonTokens);
    const reviewPhraseSpans = mode === 'exact' ? [] : buildReviewPhraseSpans(text, comparisonTexts, translation);
    const interpretivePhraseSpans = mode === 'exact' ? [] : buildInterpretivePhraseSpans(text, comparisonTexts, translation, reviewPhraseSpans);
    const protectedLowSignalPhraseSpans = mode === 'meaning'
        ? buildProtectedLowSignalPhraseSpans(text, comparisonTexts, translation, [...reviewPhraseSpans, ...interpretivePhraseSpans])
        : [];
    const coveredRanges = [...reviewPhraseSpans, ...interpretivePhraseSpans, ...protectedLowSignalPhraseSpans].map(span => [span.start, span.end]);
    const initialSpans = [...reviewPhraseSpans, ...interpretivePhraseSpans, ...protectedLowSignalPhraseSpans]
        .filter(span => shouldShowType(span.type, mode, span.normalized));

    tokens.forEach(token => {
        if (coveredRanges.some(([start, end]) => token.start >= start && token.end <= end)) return;

        const classification = mode === 'exact'
            ? classifyExactDifference(token, comparisonSet)
            : classifyDifference(token.normalized, comparisonTokens);

        if (!shouldShowType(classification.type, mode, token.normalized)) return;

        initialSpans.push({
            text: text.slice(token.start, token.end),
            normalized: token.normalized,
            type: classification.type,
            reason: classification.reason,
            matchedGroup: classification.matchedGroup,
            matchedTerms: classification.matchedTerms || null,
            translation,
            start: token.start,
            end: token.end,
            comparisonTokens,
            priority: PRIORITY[classification.type] || 0
        });
    });

    const combinedSpans = combineAdjacentSpans(initialSpans, text);
    const suppressedLowSignal = [];
    const lowSignalFilteredSpans = combinedSpans.filter(span => {
        if (!shouldSuppressLowSignalSpan(span, mode)) return true;
        suppressedLowSignal.push(span);
        return false;
    });
    const suppressedByConfidence = [];
    const confidenceFilteredSpans = lowSignalFilteredSpans
        .map(span => addSemanticConfidence(span, text))
        .filter(span => {
            if (!shouldSuppressByConfidence(span, mode)) return true;
            suppressedByConfidence.push(span);
            return false;
        });

    return {
        spans: capVisibleSpans(confidenceFilteredSpans).map(stripInternalSpanFields),
        suppressedLowSignal: suppressedLowSignal.map(stripInternalSpanFields),
        suppressedByConfidence: suppressedByConfidence.map(stripInternalSpanFields)
    };
}

export function analyzeVerseHighlights(verse, translationNames = ['DBH', 'NRSVUE', 'LAMSA'], mode = 'meaning') {
    const translations = verse?.translations || {};
    const result = {};

    translationNames.forEach(name => {
        const currentText = translations[name] || '';
        const otherTexts = translationNames
            .filter(item => item !== name)
            .map(item => translations[item] || '');
        result[name] = buildHighlightSpans(currentText, otherTexts, mode, name);
    });

    return result;
}

export function renderHighlightedText(text, highlightSpans = [], mode = 'meaning') {
    if (!text) return '<span class="placeholder-text">Missing translation</span>';
    if (mode === 'clean' || highlightSpans.length === 0) return escapeHtml(text);

    const spans = [...highlightSpans].sort((a, b) => a.start - b.start);
    let html = '';
    let cursor = 0;

    spans.forEach(span => {
        if (span.start < cursor) return;
        html += escapeHtml(text.slice(cursor, span.start));
        html += `<span class="${getHighlightClass(span.type)}" data-highlight-type="${escapeHtml(span.type)}" title="${escapeHtml(span.reason)}">${escapeHtml(text.slice(span.start, span.end))}</span>`;
        cursor = span.end;
    });

    html += escapeHtml(text.slice(cursor));
    return html;
}

export function formatDisplayText(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .replace(/([A-Za-z])([“"])/g, '$1 $2')
        .replace(/([”"])([A-Za-z])/g, '$1 $2')
        .replace(/([.;:!?])([A-Za-z“"])/g, '$1 $2')
        .replace(/\b(now)(for|then|therefore|when|while)\b/gi, '$1 $2')
        .replace(/\b(and|but|for|then|therefore|while|when)([A-Z][a-z])\b/g, '$1 $2')
        .trim();
}

export function processWords(text) {
    const tokens = tokenizeText(text);
    return {
        words: tokens.map(token => token.text),
        tokenSet: new Set(tokens.map(token => token.normalized))
    };
}

export function generateHighlightedNodes(wordsArray, setA, setB) {
    const text = (wordsArray || []).join(' ');
    const comparisonTexts = [Array.from(setA || []).join(' '), Array.from(setB || []).join(' ')];
    const template = document.createElement('template');
    template.innerHTML = renderHighlightedText(text, buildHighlightSpans(text, comparisonTexts, 'meaning'), 'meaning');
    return Array.from(template.content.childNodes);
}

function classifyExactDifference(token, comparisonSet) {
    if (comparisonSet.has(token.normalized)) {
        return {
            type: 'grammar',
            reason: 'Same normalized wording appears in another translation',
            matchedGroup: null
        };
    }

    return {
        type: CRITICAL_SET.has(token.normalized) ? 'critical' : 'wording',
        reason: 'Raw wording differs after punctuation and case cleanup',
        matchedGroup: getInterpretiveGroup(token.normalized)
    };
}

function buildReviewPhraseSpans(text, comparisonTexts, translation) {
    if (REVIEW_OVERRIDES.length === 0) return [];
    const comparisonPhraseSet = buildComparisonPhraseSet(comparisonTexts);
    const sourceNgrams = collectTokenNgrams(tokenizeText(text), 4);
    const spans = [];

    REVIEW_OVERRIDES.forEach(override => {
        const presentComparisonTerms = override.match.filter(term => comparisonPhraseSet.has(term));
        if (presentComparisonTerms.length === 0) return;

        sourceNgrams.forEach(ngram => {
            if (!override.match.includes(ngram.normalized)) return;
            const matchedTerms = presentComparisonTerms.filter(term => term !== ngram.normalized);
            if (matchedTerms.length === 0) return;
            if (spans.some(span => rangesOverlap(span, ngram))) return;

            spans.push({
                text: text.slice(ngram.start, ngram.end),
                normalized: ngram.normalized,
                type: override.forceType,
                reason: override.reason,
                matchedGroup: override.match,
                matchedTerms,
                translation,
                start: ngram.start,
                end: ngram.end,
                priority: PRIORITY[override.forceType]
            });
        });
    });

    return sortLongestFirst(spans);
}

function buildInterpretivePhraseSpans(text, comparisonTexts, translation, blockedSpans = []) {
    const sourceTokens = tokenizeText(text);
    if (sourceTokens.length === 0) return [];

    const comparisonPhraseSet = buildComparisonPhraseSet(comparisonTexts);
    const sourceNgrams = collectTokenNgrams(sourceTokens, 4);
    const spans = [];

    INTERPRETIVE_PHRASE_GROUPS.forEach(group => {
        const presentComparisonTerms = group.filter(term => comparisonPhraseSet.has(term));
        if (presentComparisonTerms.length === 0) return;

        sourceNgrams.forEach(ngram => {
            if (!group.includes(ngram.normalized)) return;
            const matchedTerms = presentComparisonTerms.filter(term => term !== ngram.normalized);
            if (matchedTerms.length === 0) return;
            if (blockedSpans.some(span => rangesOverlap(span, ngram))) return;
            if (spans.some(span => rangesOverlap(span, ngram))) return;

            spans.push({
                text: text.slice(ngram.start, ngram.end),
                normalized: ngram.normalized,
                type: 'interpretive',
                reason: 'Known interpretive phrase-level translation choice',
                matchedGroup: group,
                matchedTerms,
                translation,
                start: ngram.start,
                end: ngram.end,
                priority: PRIORITY.interpretive
            });
        });
    });

    return sortLongestFirst(spans);
}

function buildProtectedLowSignalPhraseSpans(text, comparisonTexts, translation, blockedSpans = []) {
    const sourceTokens = tokenizeText(text);
    if (sourceTokens.length === 0) return [];

    const comparisonPhraseSet = buildComparisonPhraseSet(comparisonTexts);
    const sourceNgrams = collectTokenNgrams(sourceTokens, 5);
    const spans = [];

    PROTECTED_LOW_SIGNAL_EXCEPTION_SET.forEach(exception => {
        if (comparisonPhraseSet.has(exception)) return;

        sourceNgrams.forEach(ngram => {
            if (ngram.normalized !== exception) return;
            if (blockedSpans.some(span => rangesOverlap(span, ngram))) return;
            if (spans.some(span => rangesOverlap(span, ngram))) return;

            spans.push({
                text: text.slice(ngram.start, ngram.end),
                normalized: ngram.normalized,
                type: 'meaning',
                reason: 'Protected phrase differs across translations',
                matchedGroup: [exception],
                matchedTerms: null,
                translation,
                start: ngram.start,
                end: ngram.end,
                priority: PRIORITY.meaning
            });
        });
    });

    return sortLongestFirst(spans);
}

function buildComparisonPhraseSet(comparisonTexts) {
    return new Set(comparisonTexts.flatMap(comparisonText => {
        const comparisonTokens = tokenizeText(comparisonText).map(token => token.normalized);
        return collectNormalizedNgrams(comparisonTokens, 4);
    }));
}

function findReviewOverride(normalized, comparisonSet) {
    const override = REVIEW_OVERRIDES.find(item => {
        if (!item.match.includes(normalized)) return false;
        return item.match.some(term => term !== normalized && comparisonSet.has(term));
    });

    if (!override) return null;

    return {
        type: override.forceType,
        reason: override.reason,
        matchedGroup: override.match,
        matchedTerms: override.match.filter(term => term !== normalized && comparisonSet.has(term))
    };
}

function sortLongestFirst(spans) {
    return spans.sort((a, b) => {
        const lengthDiff = (b.end - b.start) - (a.end - a.start);
        return lengthDiff || a.start - b.start;
    });
}

function collectNormalizedNgrams(tokens, maxLength) {
    const values = [];
    for (let length = 1; length <= maxLength; length += 1) {
        for (let index = 0; index <= tokens.length - length; index += 1) {
            values.push(tokens.slice(index, index + length).join(' '));
        }
    }
    return values;
}

function collectTokenNgrams(tokens, maxLength) {
    const values = [];
    for (let length = 1; length <= maxLength; length += 1) {
        for (let index = 0; index <= tokens.length - length; index += 1) {
            const slice = tokens.slice(index, index + length);
            values.push({
                normalized: slice.map(token => token.normalized).join(' '),
                start: slice[0].start,
                end: slice[slice.length - 1].end
            });
        }
    }
    return values;
}

function rangesOverlap(a, b) {
    return a.start < b.end && b.start < a.end;
}

function shouldShowType(type, mode, normalized = '') {
    if (mode === 'clean') return false;
    if (mode === 'exact') return type !== 'grammar';
    if (mode === 'theology') return type === 'critical' || type === 'interpretive' || PROTECTED_SET.has(normalized);
    return type !== 'grammar';
}

function shouldSuppressLowSignalSpan(span, mode) {
    if (mode !== 'meaning') return false;
    if (span.type === 'critical' || span.type === 'interpretive') return false;
    if (isProtectedLowSignalException(span.normalized)) return false;

    const terms = normalizePhrase(span.normalized).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return false;

    const lowSignalCount = terms.filter(term => LOW_SIGNAL_SET.has(term)).length;
    if (terms.length === 1) return lowSignalCount === 1;

    const hasStrongTerm = terms.some(term => (
        CRITICAL_SET.has(term) ||
        (PROTECTED_SET.has(term) && !LOW_SIGNAL_SET.has(term))
    ));
    if (hasStrongTerm) return false;

    return lowSignalCount / terms.length >= 0.6;
}

function addSemanticConfidence(span, sourceText) {
    if (span.type !== 'meaning') return span;

    const confidence = calculateSemanticConfidence(span, sourceText);
    return {
        ...span,
        semanticConfidence: confidence.score,
        semanticConfidenceReasons: confidence.reasons
    };
}

function calculateSemanticConfidence(span, sourceText) {
    const terms = normalizePhrase(span.normalized).split(/\s+/).filter(Boolean);
    const reasons = [];
    let score = 0.45;

    if (terms.length >= 2) {
        score += 0.25;
        reasons.push('phrase length');
    } else {
        score -= 0.18;
        reasons.push('single word');
    }

    if (isProtectedLowSignalException(span.normalized)) {
        score += 0.45;
        reasons.push('protected phrase');
    }

    if (terms.some(term => PROTECTED_SET.has(term) || CRITICAL_SET.has(term))) {
        score += 0.24;
        reasons.push('protected concept nearby');
    }

    if (terms.some(term => isUncommonVocabulary(term))) {
        score += 0.18;
        reasons.push('uncommon vocabulary');
    }

    if (hasPhilosophicallyDistinctiveWording(terms)) {
        score += 0.25;
        reasons.push('distinctive wording');
    }

    if (hasNearbyProtectedConcept(span, sourceText)) {
        score += 0.12;
        reasons.push('near protected concept');
    }

    if (terms.length === 1 && HIGH_FREQUENCY_SET.has(terms[0])) {
        score -= 0.34;
        reasons.push('high-frequency single word');
    }

    if (terms.some(term => COMMON_NOUN_SET.has(term) || COMMON_VERB_STEM_BY_TERM.has(term))) {
        score -= 0.18;
        reasons.push('common noun/verb');
    }

    if (hasCommonStemMatch(terms, span.comparisonTokens || [])) {
        score -= 0.3;
        reasons.push('stem-equivalent substitution');
    }

    if (terms.length === 1 && hasSingularPluralMatch(terms[0], span.comparisonTokens || [])) {
        score -= 0.28;
        reasons.push('singular/plural variation');
    }

    return {
        score: Math.max(0, Math.min(1, Number(score.toFixed(2)))),
        reasons
    };
}

function shouldSuppressByConfidence(span, mode) {
    if (mode !== 'meaning') return false;
    if (span.type !== 'meaning') return false;
    if (isProtectedLowSignalException(span.normalized)) return false;

    const terms = normalizePhrase(span.normalized).split(/\s+/).filter(Boolean);
    if (terms.length !== 1) return false;
    if (span.semanticConfidence >= SEMANTIC_CONFIDENCE_THRESHOLD) return false;
    return HIGH_FREQUENCY_SET.has(terms[0]) || COMMON_NOUN_SET.has(terms[0]) || COMMON_VERB_STEM_BY_TERM.has(terms[0]);
}

function isUncommonVocabulary(term) {
    return term.length >= 8 && !HIGH_FREQUENCY_SET.has(term);
}

function hasPhilosophicallyDistinctiveWording(terms) {
    const distinctive = new Set([
        'age',
        'aeon',
        'cosmos',
        'gehenna',
        'charlatan',
        'charlatans',
        'blissful',
        'kingdom',
        'heavens',
        'eternal',
        'soul',
        'forgive',
        'repent'
    ]);
    return terms.some(term => distinctive.has(term));
}

function hasNearbyProtectedConcept(span, sourceText) {
    const windowText = sourceText.slice(Math.max(0, span.start - 36), Math.min(sourceText.length, span.end + 36));
    const nearbyTerms = tokenizeText(windowText).map(token => token.normalized);
    return nearbyTerms.some(term => PROTECTED_SET.has(term) || CRITICAL_SET.has(term));
}

function hasCommonStemMatch(terms, comparisonTokens) {
    const comparisonStemKeys = new Set(comparisonTokens.map(token => COMMON_VERB_STEM_BY_TERM.get(token)).filter(Boolean));
    return terms.some(term => {
        const key = COMMON_VERB_STEM_BY_TERM.get(term);
        return key && comparisonStemKeys.has(key);
    });
}

function hasSingularPluralMatch(term, comparisonTokens) {
    return comparisonTokens.some(comparison => {
        if (comparison === term) return false;
        return singularize(comparison) === singularize(term);
    });
}

function singularize(term) {
    if (term.endsWith('ies') && term.length > 4) return `${term.slice(0, -3)}y`;
    if (term.endsWith('s') && term.length > 3) return term.slice(0, -1);
    return term;
}

function isProtectedLowSignalException(normalized) {
    const phrase = normalizePhrase(normalized);
    return PROTECTED_LOW_SIGNAL_EXCEPTION_SET.has(phrase);
}

function stripInternalSpanFields(span) {
    const { comparisonTokens, priority, ...publicSpan } = span;
    return publicSpan;
}

function combineAdjacentSpans(spans, sourceText) {
    const combined = [];

    spans.forEach(span => {
        const previous = combined[combined.length - 1];
        const between = previous ? sourceText.slice(previous.end, span.start) : '';
        if (
            previous &&
            previous.type === span.type &&
            /^[\s,;:]+$/.test(between)
        ) {
            previous.text = sourceText.slice(previous.start, span.end);
            previous.normalized = `${previous.normalized} ${span.normalized}`;
            previous.end = span.end;
            previous.priority = Math.max(previous.priority, span.priority);
            previous.reason = previous.reason === span.reason ? previous.reason : 'Adjacent related differences';
            previous.matchedGroup = previous.matchedGroup || span.matchedGroup;
            previous.matchedTerms = previous.matchedTerms || span.matchedTerms;
        } else {
            combined.push({ ...span });
        }
    });

    return combined;
}

function capVisibleSpans(spans) {
    const alwaysKeep = spans.filter(span => span.type === 'critical' || span.type === 'interpretive');
    const capped = spans
        .filter(span => span.type !== 'critical' && span.type !== 'interpretive')
        .map((span, index) => ({ span, index }))
        .sort((a, b) => {
            const priorityDiff = (PRIORITY[b.span.type] || 0) - (PRIORITY[a.span.type] || 0);
            return priorityDiff || a.index - b.index;
        })
        .slice(0, HIGHLIGHT_LIMIT)
        .map(item => item.span);

    return [...alwaysKeep, ...capped].sort((a, b) => a.start - b.start);
}

function getHighlightClass(type) {
    if (type === 'critical') return 'highlight-critical';
    if (type === 'interpretive') return 'highlight-interpretive';
    if (type === 'meaning') return 'highlight-meaning';
    return 'highlight-wording';
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
