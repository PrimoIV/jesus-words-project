import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const SOURCE_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const AUDIT_FILE = path.join(ROOT, 'dev/reports/possible_mixed_speech_audit.json');
const EXISTING_OVERRIDES_FILE = path.join(ROOT, 'dev/jesus_speech_overrides.json');
const REPORT_DIR = path.join(ROOT, 'dev/reports');
const OUTPUT_FILE = path.join(REPORT_DIR, 'jesus_speech_override_draft.json');
const TRANSLATIONS = ['DBH', 'NRSVUE', 'LAMSA'];

const NAMED_QUOTED_JESUS_MARKER = /\b(?:Jesus|the Lord)(?:\s+then)?\s+(?:said|asked|answered|replied)(?:\s+(?:to\s+)?(?:him|them))?[,:]?\s*[“"]([^”"]+)[”"]/i;
const GENERIC_QUOTED_MARKER = /\bhe\s+(?:said|asked|answered)(?:\s+to\s+(?:him|them))?[,:]?\s*[“"]([^”"]+)[”"]/i;
const EXPLICIT_PLAIN_JESUS_MARKER = /\b(?:Jesus(?:\s+then)? said to him|Jesus(?:\s+then)? said to them|Jesus(?:\s+then)? answered|Jesus(?:\s+then)? asked(?:\s+(?:him|them))?|the Lord said),?\s+/i;
const COMPETING_SPEAKER_MARKER = /\b(?:Jesus|Peter|Simon Peter|disciples|Pharisees|Jews|crowd|man|woman|demon|demons|they|she)\s+(?:said|asked|answered|replied)\b|\b(?:Master|Teacher|Rabbi),/i;
const OTHER_AFTER_JESUS_MARKER = /\b(?:they|Peter|Simon Peter|she|he)\s+said\b/i;
const PLAIN_OTHER_SPEAKER_MARKER = /\b(?:they|Peter|Simon Peter|she|he|the disciples|the Pharisees|the Jews)\s+(?:said|asked|answered|replied)\b/i;
const FALSE_POSITIVE_TERMS = [
    'Yes, Lord',
    'My Lord',
    'Rabbi',
    'Teacher',
    'Master',
    'Legion',
    'We do not know',
    'Caesar’s',
    "Caesar's",
    'Seven',
    'Twelve',
    'No',
    'No one'
];

if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error('Missing source dataset: data/jesus_verses_final.json.');
}

if (!fs.existsSync(AUDIT_FILE)) {
    throw new Error('Missing dev/reports/possible_mixed_speech_audit.json. Run audit_possible_mixed_speech.js first.');
}

const dataset = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
const audit = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
const existingOverrides = fs.existsSync(EXISTING_OVERRIDES_FILE)
    ? JSON.parse(fs.readFileSync(EXISTING_OVERRIDES_FILE, 'utf8'))
    : {};
const highFindings = (audit.findings || []).filter(finding => finding.severity === 'high');

const draft = {
    generatedAt: new Date().toISOString(),
    sourceFile: path.relative(ROOT, SOURCE_FILE).replace(/\\/g, '/'),
    auditFile: path.relative(ROOT, AUDIT_FILE).replace(/\\/g, '/'),
    existingOverridesFile: fs.existsSync(EXISTING_OVERRIDES_FILE)
        ? path.relative(ROOT, EXISTING_OVERRIDES_FILE).replace(/\\/g, '/')
        : null,
    summary: {
        totalHighFindings: highFindings.length,
        skippedExistingOverrides: 0,
        draftedVerses: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        lowConfidence: 0,
        needsManualReview: 0
    },
    drafts: []
};

highFindings.forEach(finding => {
    if (existingOverrides[finding.id]) {
        draft.summary.skippedExistingOverrides += 1;
        return;
    }

    const verse = dataset[finding.id];
    if (!verse) return;

    const translations = {};

    TRANSLATIONS.forEach(name => {
        const original = verse.translations?.[name] || '';
        const proposal = proposeJesusSpeech(original);
        translations[name] = {
            original,
            proposedText: proposal.proposedText,
            confidence: proposal.confidence,
            reason: proposal.reason,
            speakerRisk: proposal.speakerRisk
        };
        incrementConfidence(proposal.confidence);
    });

    draft.drafts.push({
        id: finding.id,
        reference: finding.reference,
        speech: {
            dbh: translations.DBH.proposedText,
            nrsvue: translations.NRSVUE.proposedText,
            lamsa: translations.LAMSA.proposedText
        },
        context: {
            before: null,
            speaker: null,
            after: null
        },
        translations
    });
});

draft.summary.draftedVerses = draft.drafts.length;

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');

console.log(`Jesus speech override draft written to ${path.relative(ROOT, OUTPUT_FILE).replace(/\\/g, '/')}`);
console.log(`Drafted ${draft.summary.draftedVerses} high-severity verses; skipped ${draft.summary.skippedExistingOverrides} existing overrides.`);

function proposeJesusSpeech(text) {
    if (!text) return nullProposal('Missing translation text');

    const namedQuote = text.match(NAMED_QUOTED_JESUS_MARKER);
    if (namedQuote) {
        return validateProposal({
            originalText: text,
            proposedText: cleanProposal(namedQuote[1]),
            confidence: 'high',
            reason: `Extracted quoted speech after ${getMatchedMarker(text, namedQuote.index)}`
        });
    }

    const genericQuote = text.match(GENERIC_QUOTED_MARKER);
    if (genericQuote && canUseGenericHeMarker(text, genericQuote.index || 0)) {
        return validateProposal({
            originalText: text,
            proposedText: cleanProposal(genericQuote[1]),
            confidence: 'medium',
            reason: 'Extracted quoted speech after generic he marker with no competing speaker marker'
        });
    }

    const firstQuote = getFirstQuotedSegment(text);
    if (firstQuote && OTHER_AFTER_JESUS_MARKER.test(text.slice(firstQuote.end)) && !hasCompetingSpeakerBefore(text, firstQuote.start)) {
        return validateProposal({
            originalText: text,
            proposedText: cleanProposal(firstQuote.text),
            confidence: 'medium',
            reason: 'Extracted first quoted segment before another speaker marker'
        });
    }

    const plainMatch = text.match(EXPLICIT_PLAIN_JESUS_MARKER);
    if (plainMatch) {
        const afterMarker = text.slice((plainMatch.index || 0) + plainMatch[0].length);
        const beforeOtherSpeaker = splitBeforeOtherSpeaker(afterMarker);
        if (beforeOtherSpeaker) {
            return validateProposal({
                originalText: text,
                proposedText: beforeOtherSpeaker,
                confidence: 'medium',
                reason: 'Extracted plain text after explicit Jesus marker before another speaker marker'
            });
        }
    }

    return nullProposal(genericQuote ? 'Generic he marker has competing speaker risk' : 'No conservative Jesus-only extraction found');
}

function validateProposal({ originalText, proposedText, confidence, reason }) {
    const speakerRisk = getSpeakerRisk(originalText, proposedText);

    if (speakerRisk === 'high') {
        return {
            proposedText: null,
            confidence: 'low',
            reason: `${reason}; rejected by speaker-risk guard`,
            speakerRisk
        };
    }

    return {
        proposedText,
        confidence,
        reason,
        speakerRisk
    };
}

function getSpeakerRisk(originalText, proposedText) {
    if (!proposedText) return 'high';
    if (FALSE_POSITIVE_TERMS.some(term => matchesFalsePositiveTerm(proposedText, term))) return 'high';
    if (/\bhe\s+(?:said|asked|answered)\b/i.test(originalText) && COMPETING_SPEAKER_MARKER.test(originalText)) return 'medium';
    return 'low';
}

function canUseGenericHeMarker(text, markerIndex) {
    return !hasCompetingSpeakerBefore(text, markerIndex);
}

function hasCompetingSpeakerBefore(text, index) {
    return COMPETING_SPEAKER_MARKER.test(text.slice(0, index));
}

function getMatchedMarker(text, markerIndex = 0) {
    const match = text.slice(markerIndex).match(/\b(?:Jesus|the Lord)\s+(?:said|asked|answered|replied)(?:\s+to\s+(?:him|them))?/i);
    return match ? match[0] : 'explicit Jesus marker';
}

function getFirstQuotedSegment(text) {
    const curly = /“([^”]+)”/.exec(text);
    const straight = /"([^"]+)"/.exec(text);
    const candidates = [curly, straight].filter(Boolean).sort((a, b) => a.index - b.index);
    if (candidates.length === 0) return null;
    const match = candidates[0];
    return {
        text: match[1],
        start: match.index,
        end: match.index + match[0].length
    };
}

function splitBeforeOtherSpeaker(text) {
    const speakerMatch = text.match(PLAIN_OTHER_SPEAKER_MARKER);
    const candidate = speakerMatch ? text.slice(0, speakerMatch.index) : firstSentence(text);
    const cleaned = cleanProposal(candidate);
    return cleaned.length >= 3 ? cleaned : null;
}

function firstSentence(text) {
    const match = text.match(/^(.+?[.!?])(?:\s|$)/);
    return match ? match[1] : '';
}

function cleanProposal(text) {
    return String(text || '')
        .replace(/^[\s“”"']+|[\s“”"']+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function matchesFalsePositiveTerm(text, term) {
    if (term === 'No') return /^No[.!?]?$/i.test(text.trim());
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function nullProposal(reason) {
    return {
        proposedText: null,
        confidence: 'low',
        reason,
        speakerRisk: 'high'
    };
}

function incrementConfidence(confidence) {
    if (confidence === 'high') draft.summary.highConfidence += 1;
    if (confidence === 'medium') draft.summary.mediumConfidence += 1;
    if (confidence === 'low') {
        draft.summary.lowConfidence += 1;
        draft.summary.needsManualReview += 1;
    }
}
