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
const FUNCTION_WORDS = new Set([
    'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
    'now', 'then', 'therefore', 'thus', 'that', 'this', 'these', 'those',
    'who', 'whom', 'whose', 'whoever', 'what', 'whatever', 'which', 'where',
    'when', 'whenever', 'why', 'how', 'if', 'because', 'than', 'any',
    'anyone', 'someone', 'everyone', 'one', 'to', 'of', 'in', 'on', 'at',
    'by', 'from', 'with', 'about', 'as', 'into', 'through', 'after',
    'before', 'over', 'under', 'among', 'between', 'against', 'without',
    'within', 'he', 'she', 'it', 'they', 'them', 'him', 'her', 'his',
    'their', 'its', 'we', 'us', 'our', 'i', 'me', 'my', 'your', 'is',
    'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does',
    'did', 'have', 'has', 'had', 'will', 'would', 'shall', 'should',
    'can', 'could', 'may', 'might'
]);

const PRIORITY = {
    critical: 5,
    interpretive: 4,
    meaning: 3,
    wording: 2,
    grammar: 1
};

const CRITICAL_SET = new Set(CRITICAL_WORDS.map(normalizePhrase));
const PROTECTED_SET = new Set(PROTECTED_TERMS.map(normalizePhrase));
const LOW_SIGNAL_SET = new Set(LOW_SIGNAL_TERMS.map(normalizePhrase));
const COMMON_NOUN_SET = new Set(COMMON_NOUNS.map(normalizePhrase));
const COMMON_VERB_STEM_BY_TERM = buildGroupLookup(COMMON_VERB_STEMS);
const GRAMMAR_KEY_BY_TERM = buildGroupLookup(GRAMMAR_EQUIVALENTS);
const INTERPRETIVE_GROUP_BY_TERM = buildGroupLookup(INTERPRETIVE_TERMS, true);
const INTERPRETIVE_GROUPS = INTERPRETIVE_TERMS
    .map(group => group.map(normalizePhrase).filter(Boolean))
    .filter(group => group.length > 1);
const PROTECTED_LOW_SIGNAL_EXCEPTION_SET = new Set(PROTECTED_LOW_SIGNAL_EXCEPTIONS.map(normalizePhrase));

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
    const normalized = normalizePhrase(token);
    return GRAMMAR_KEY_BY_TERM.get(normalized) || normalized;
}

export function areGrammarEquivalent(a, b) {
    const normA = normalizePhrase(a);
    const normB = normalizePhrase(b);
    return Boolean(normA && normB && getGrammarKey(normA) === getGrammarKey(normB));
}

export function getInterpretiveGroup(token) {
    return INTERPRETIVE_GROUP_BY_TERM.get(normalizePhrase(token)) || null;
}

export function setHighlightReviewLayer(reviewLayer = {}) {
    REVIEW_OVERRIDES = (reviewLayer.overrides || [])
        .map(override => ({
            match: (override.match || []).map(normalizePhrase).filter(Boolean),
            forceType: override.forceType,
            reason: override.reason || 'Reviewed translation-choice pairing'
        }))
        .filter(override => override.match.length >= 2 && PRIORITY[override.forceType]);
}

export function classifyDifference(token, comparisonTokens = []) {
    const normalized = normalizePhrase(token);
    const comparisonValues = buildComparisonValueSet(comparisonTokens);
    const comparisonGrammarKeys = new Set(Array.from(comparisonValues).map(getGrammarKey));
    const interpretiveGroup = getInterpretiveGroup(normalized);

    if (!normalized) {
        return { type: 'grammar', reason: 'No lexical token', matchedGroup: null };
    }

    const reviewOverride = findReviewOverride(normalized, comparisonValues);
    if (reviewOverride) return reviewOverride;

    if (comparisonValues.has(normalized)) {
        return {
            type: 'grammar',
            reason: 'Same normalized wording appears in another translation',
            matchedGroup: null
        };
    }

    if (comparisonGrammarKeys.has(getGrammarKey(normalized))) {
        return {
            type: 'grammar',
            reason: 'Grammar-only equivalent',
            matchedGroup: null
        };
    }

    if (interpretiveGroup) {
        const matchedTerms = interpretiveGroup.filter(term => term !== normalized && comparisonValues.has(term));
        if (matchedTerms.length > 0) {
            return {
                type: 'interpretive',
                reason: 'Known interpretive translation-choice term',
                matchedGroup: interpretiveGroup,
                matchedTerms
            };
        }
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

    if (FUNCTION_WORDS.has(normalized)) {
        return {
            type: 'grammar',
            reason: 'Function word hidden in meaning mode',
            matchedGroup: null
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
        return { spans: [], suppressedLowSignal: [], suppressedByConfidence: [] };
    }

    const tokens = tokenizeText(text);
    const comparisonLookup = buildComparisonPhraseSet(comparisonTexts);
    const phraseSpans = mode === 'exact' ? [] : [
        ...buildReviewPhraseSpans(text, comparisonLookup, translation),
        ...buildInterpretivePhraseSpans(text, comparisonLookup, translation),
        ...buildProtectedPhraseSpans(text, comparisonLookup, translation)
    ];
    const blockedRanges = [];
    const initialSpans = [];

    phraseSpans
        .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)
        .forEach(span => {
            if (blockedRanges.some(range => rangesOverlap(span, range))) return;
            blockedRanges.push({ start: span.start, end: span.end });
            if (shouldShowType(span.type, mode, span.normalized)) initialSpans.push(span);
        });

    tokens.forEach(token => {
        if (blockedRanges.some(range => token.start >= range.start && token.end <= range.end)) return;
        const classification = mode === 'exact'
            ? classifyExactDifference(token, comparisonLookup)
            : classifyDifference(token.normalized, Array.from(comparisonLookup));
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
            priority: PRIORITY[classification.type] || 0
        });
    });

    const suppressedLowSignal = [];
    const visibleCandidates = combineAdjacentSpans(initialSpans.sort((a, b) => a.start - b.start), text)
        .map(addSemanticConfidence)
        .filter(span => {
            if (!shouldSuppressLowSignalSpan(span, mode)) return true;
            suppressedLowSignal.push(span);
            return false;
        });

    return {
        spans: capVisibleSpans(visibleCandidates).map(stripInternalSpanFields),
        suppressedLowSignal: suppressedLowSignal.map(stripInternalSpanFields),
        suppressedByConfidence: []
    };
}

export function analyzeVerseHighlights(verse, translationNames = ['DBH', 'NRSVUE', 'LAMSA'], mode = 'meaning') {
    const translations = verse?.translations || {};
    return Object.fromEntries(translationNames.map(name => {
        const currentText = translations[name] || '';
        const otherTexts = translationNames
            .filter(item => item !== name)
            .map(item => translations[item] || '');
        return [name, buildHighlightSpans(currentText, otherTexts, mode, name)];
    }));
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
        .replace(/([A-Za-z])([\u201c"])/g, '$1 $2')
        .replace(/([\u201d"])([A-Za-z])/g, '$1 $2')
        .replace(/([.;:!?])([A-Za-z\u201c"])/g, '$1 $2')
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

function buildComparisonValueSet(values) {
    const result = new Set();
    values.forEach(value => {
        const phrase = normalizePhrase(value);
        if (phrase) result.add(phrase);
        tokenizeText(value).forEach(token => result.add(token.normalized));
    });
    return result;
}

function buildComparisonPhraseSet(comparisonTexts) {
    const values = new Set();
    comparisonTexts.forEach(text => {
        const tokens = tokenizeText(text);
        tokens.forEach(token => values.add(token.normalized));
        collectTokenNgrams(tokens, 5).forEach(ngram => values.add(ngram.normalized));
    });
    return values;
}

function buildReviewPhraseSpans(text, comparisonLookup, translation) {
    if (REVIEW_OVERRIDES.length === 0) return [];
    const sourceNgrams = collectTokenNgrams(tokenizeText(text), 5);
    const spans = [];

    REVIEW_OVERRIDES.forEach(override => {
        const matchedTerms = override.match.filter(term => comparisonLookup.has(term));
        if (matchedTerms.length === 0) return;
        sourceNgrams.forEach(ngram => {
            if (!override.match.includes(ngram.normalized)) return;
            if (matchedTerms.includes(ngram.normalized) && matchedTerms.length === 1) return;
            spans.push({
                ...ngram,
                text: text.slice(ngram.start, ngram.end),
                type: override.forceType,
                reason: override.reason,
                matchedGroup: override.match,
                matchedTerms: matchedTerms.filter(term => term !== ngram.normalized),
                translation,
                priority: PRIORITY[override.forceType]
            });
        });
    });

    return spans;
}

function buildInterpretivePhraseSpans(text, comparisonLookup, translation) {
    const sourceNgrams = collectTokenNgrams(tokenizeText(text), 5);
    const spans = [];

    INTERPRETIVE_GROUPS.forEach(group => {
        const matchedTerms = group.filter(term => comparisonLookup.has(term));
        if (matchedTerms.length === 0) return;
        sourceNgrams.forEach(ngram => {
            if (!group.includes(ngram.normalized)) return;
            const pairedTerms = matchedTerms.filter(term => term !== ngram.normalized);
            if (pairedTerms.length === 0) return;
            spans.push({
                ...ngram,
                text: text.slice(ngram.start, ngram.end),
                type: 'interpretive',
                reason: 'Known interpretive phrase-level translation choice',
                matchedGroup: group,
                matchedTerms: pairedTerms,
                translation,
                priority: PRIORITY.interpretive
            });
        });
    });

    return spans;
}

function buildProtectedPhraseSpans(text, comparisonLookup, translation) {
    const sourceNgrams = collectTokenNgrams(tokenizeText(text), 5);
    const spans = [];

    PROTECTED_LOW_SIGNAL_EXCEPTION_SET.forEach(exception => {
        if (comparisonLookup.has(exception)) return;
        sourceNgrams.forEach(ngram => {
            if (ngram.normalized !== exception) return;
            spans.push({
                ...ngram,
                text: text.slice(ngram.start, ngram.end),
                type: 'meaning',
                reason: 'Protected phrase differs across translations',
                matchedGroup: [exception],
                matchedTerms: null,
                translation,
                priority: PRIORITY.meaning
            });
        });
    });

    return spans;
}

function classifyExactDifference(token, comparisonLookup) {
    if (comparisonLookup.has(token.normalized)) {
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

function findReviewOverride(normalized, comparisonLookup) {
    const override = REVIEW_OVERRIDES.find(item => {
        if (!item.match.includes(normalized)) return false;
        return item.match.some(term => term !== normalized && comparisonLookup.has(term));
    });

    if (!override) return null;

    return {
        type: override.forceType,
        reason: override.reason,
        matchedGroup: override.match,
        matchedTerms: override.match.filter(term => term !== normalized && comparisonLookup.has(term))
    };
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
    if (PROTECTED_LOW_SIGNAL_EXCEPTION_SET.has(normalizePhrase(span.normalized))) return false;

    const terms = normalizePhrase(span.normalized).split(/\s+/).filter(Boolean);
    if (terms.length !== 1) return false;

    const term = terms[0];
    return FUNCTION_WORDS.has(term) ||
        LOW_SIGNAL_SET.has(term) ||
        COMMON_NOUN_SET.has(term) ||
        COMMON_VERB_STEM_BY_TERM.has(term);
}

function addSemanticConfidence(span) {
    if (span.type !== 'meaning') return span;
    const terms = normalizePhrase(span.normalized).split(/\s+/).filter(Boolean);
    const protectedNearby = terms.some(term => PROTECTED_SET.has(term) || CRITICAL_SET.has(term));
    return {
        ...span,
        semanticConfidence: protectedNearby || terms.length > 1 ? 0.78 : 0.58,
        semanticConfidenceReasons: protectedNearby ? ['protected concept'] : terms.length > 1 ? ['phrase length'] : ['meaning-bearing term']
    };
}

function combineAdjacentSpans(spans, sourceText) {
    const combined = [];
    spans.forEach(span => {
        const previous = combined[combined.length - 1];
        const between = previous ? sourceText.slice(previous.end, span.start) : '';
        if (previous && previous.type === span.type && /^[\s,;:]+$/.test(between)) {
            previous.text = sourceText.slice(previous.start, span.end);
            previous.normalized = `${previous.normalized} ${span.normalized}`;
            previous.end = span.end;
            previous.reason = previous.reason === span.reason ? previous.reason : 'Adjacent related differences';
            previous.priority = Math.max(previous.priority || 0, span.priority || 0);
            previous.matchedGroup = previous.matchedGroup || span.matchedGroup;
            previous.matchedTerms = previous.matchedTerms || span.matchedTerms;
        } else {
            combined.push({ ...span });
        }
    });
    return combined;
}

function capVisibleSpans(spans) {
    const keep = spans.filter(span => span.type === 'critical' || span.type === 'interpretive');
    const capped = spans
        .filter(span => span.type !== 'critical' && span.type !== 'interpretive')
        .map((span, index) => ({ span, index }))
        .sort((a, b) => {
            const priorityDiff = (PRIORITY[b.span.type] || 0) - (PRIORITY[a.span.type] || 0);
            return priorityDiff || a.index - b.index;
        })
        .slice(0, HIGHLIGHT_LIMIT)
        .map(item => item.span);
    return [...keep, ...capped].sort((a, b) => a.start - b.start);
}

function stripInternalSpanFields(span) {
    const { priority, ...publicSpan } = span;
    return publicSpan;
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
