const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_CANDIDATE_FILE = path.join(ROOT, 'dev', 'reports', 'jesus_verses_with_speech_candidates.json');
const candidateArg = process.argv[2];
const CANDIDATE_FILE = candidateArg ? path.resolve(ROOT, candidateArg) : DEFAULT_CANDIDATE_FILE;
const TRANSLATION_KEYS = ['NRSVUE', 'DBH', 'LAMSA'];
const NON_EMPTY_STATUSES = new Set(['candidate', 'clean_raw', 'verified']);
const ALLOWED_STATUSES = new Set(['candidate', 'clean_raw', 'verified', 'needs_review', 'needs_review_text_present', 'rejected']);

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

const EXCEPTION_PATTERNS = [
    /\bTruly\s+I\s+say\s+to\s+you\b/i,
    /\bI\s+say\s+to\s+you\b/i,
    /\bBut\s+I\s+say\s+to\s+you\b/i,
    /\bAmen,\s+I\s+tell\s+you\b/i,
    /\bIt\s+is\s+written\b/i,
    /\bYou\s+have\s+heard\s+that\s+it\s+was\s+said\b/i
];

if (!fs.existsSync(CANDIDATE_FILE)) {
    console.error(`Missing speech candidate file: ${path.relative(ROOT, CANDIDATE_FILE).replace(/\\/g, '/')}`);
    console.error('Run: node scripts/generate_speech_text_candidates.js');
    process.exit(1);
}

let dataset;
try {
    dataset = JSON.parse(fs.readFileSync(CANDIDATE_FILE, 'utf8'));
} catch (error) {
    console.error(`Could not parse ${path.relative(ROOT, CANDIDATE_FILE).replace(/\\/g, '/')}: ${error.message}`);
    process.exit(1);
}

const failures = [];

Object.entries(dataset).forEach(([id, record]) => {
    TRANSLATION_KEYS.forEach(translationKey => {
        const speechText = stringValue(record.speechText && record.speechText[translationKey]);
        const speechStatus = stringValue(record.speechStatus && record.speechStatus[translationKey]);
        const reference = record.reference || id;

        if (!ALLOWED_STATUSES.has(speechStatus)) {
            failures.push(`${id} ${translationKey}: unknown speechStatus "${speechStatus}".`);
        }

        if (NON_EMPTY_STATUSES.has(speechStatus) && !speechText) {
            failures.push(`${id} ${translationKey}: ${speechStatus} status has empty speechText.`);
        }

        if (speechStatus === 'needs_review' && speechText) {
            failures.push(`${id} ${translationKey}: needs_review must have blank speechText for now.`);
        }

        if (speechStatus === 'rejected' && speechText) {
            failures.push(`${id} ${translationKey}: rejected should have blank speechText.`);
        }

        if (!speechText) return;

        const matchedLabels = getContaminationMatches(speechText);
        if (matchedLabels.length > 0) {
            failures.push(`${id} ${translationKey} ${reference}: speechText contains ${matchedLabels.join('; ')}: "${truncate(speechText, 220)}"`);
        }
    });
});

if (failures.length > 0) {
    console.error('Speech candidate purity check failed:');
    failures.slice(0, 100).forEach(failure => console.error(`- ${failure}`));
    if (failures.length > 100) {
        console.error(`...and ${failures.length - 100} more failure(s).`);
    }
    process.exit(1);
}

console.log('Speech candidate purity check passed.');

function getContaminationMatches(text) {
    return FAIL_PATTERNS
        .filter(pattern => pattern.regex.test(text))
        .map(pattern => pattern.label);
}

function isException(text) {
    return EXCEPTION_PATTERNS.some(regex => regex.test(text));
}

function stringValue(value) {
    return typeof value === 'string' ? value : '';
}

function truncate(text, maxLength) {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}...`;
}
