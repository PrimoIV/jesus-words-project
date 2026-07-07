const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REDUCED_FILE = path.join(ROOT, 'dev', 'reports', 'jesus_verses_with_speech_candidates_reduced.json');

if (!fs.existsSync(REDUCED_FILE)) {
    console.error(`Missing reduced candidate file: ${path.relative(ROOT, REDUCED_FILE).replace(/\\/g, '/')}`);
    console.error('Run: node scripts/reduce_speech_review_queue.js');
    process.exit(1);
}

let dataset;
try {
    dataset = JSON.parse(fs.readFileSync(REDUCED_FILE, 'utf8'));
} catch (error) {
    console.error(`Could not parse ${path.relative(ROOT, REDUCED_FILE).replace(/\\/g, '/')}: ${error.message}`);
    process.exit(1);
}

const failures = [];
const checkedValues = [];

expectExact('MAT_4_17', 'NRSVUE', 'Repent, for the kingdom of heaven has come near.');
expectExact('MAT_4_17', 'DBH', 'Change your hearts; for the Kingdom of the heavens has drawn near.');
expectExact('MAT_4_17', 'LAMSA', 'Repent, for the kingdom of heaven is coming near.');

expectExact('MAT_8_3', 'NRSVUE', 'I am willing. Be made clean!');
expectExact('MAT_8_3', 'DBH', 'I wish it; be cleansed.');
expectExact('MAT_8_3', 'LAMSA', 'I do wish, be cleansed.');

expectStartsWith('MAT_8_10', 'NRSVUE', 'Truly I tell you');
expectStartsWith('MAT_8_10', 'DBH', 'Amen, I tell you');
expectStartsWith('MAT_8_10', 'LAMSA', 'Truly I say to you');

expectContains('MAT_9_2', 'NRSVUE', 'Take heart, child');
expectContains('MAT_9_2', 'DBH', 'Take heart, child');
expectContains('MAT_9_2', 'LAMSA', 'Have courage, my son');

expectStartsWith('MAT_9_4', 'NRSVUE', 'Why do you think evil');
expectStartsWith('MAT_9_4', 'DBH', 'Why do you think wicked');
expectStartsWith('MAT_9_4', 'LAMSA', 'Why do you think evil');

expectStartsWith('MAT_9_24', 'NRSVUE', 'Go away');
expectStartsWith('MAT_9_24', 'DBH', 'Go away');
expectDoesNotContain('MAT_9_24', 'LAMSA', 'laughed at him');

expectExact('MAT_9_28', 'LAMSA', 'Do you believe that I can do this?');

expectExact('MAT_5_44', 'DBH', 'I tell you, love your enemies [and speak well of those who revile you, be benevolent to those who hate you] and pray for those who [abuse and] persecute you;');
expectExact('MAT_6_4', 'DBH', 'so that your almsgiving is in secret. And your Father, who watches what is secret, will reward you [openly].');
expectExact('MAT_6_13', 'DBH', 'and do not bring us to trial, but rescue us from the wicked man. [For yours is the Kingdom and the power and the glory unto the ages. Amen.]');
expectStatus('MAT_5_44', 'DBH', 'candidate');
expectStatus('MAT_6_4', 'DBH', 'candidate');
expectStatus('MAT_6_13', 'DBH', 'candidate');
expectSourceOneOf('MAT_5_44', 'DBH', ['audit_suggestion_with_brackets', 'review_reducer_bracketed_speech_preserved']);
expectSourceOneOf('MAT_6_4', 'DBH', ['audit_suggestion_with_brackets', 'review_reducer_bracketed_speech_preserved']);
expectSourceOneOf('MAT_6_13', 'DBH', ['audit_suggestion_with_brackets', 'review_reducer_bracketed_speech_preserved']);
expectStatus('LUK_9_59', 'DBH', 'needs_review');
expectBlank('LUK_9_59', 'DBH');

const forbiddenPatterns = [
    /\bJesus\b/i,
    /\bThey\s+said\b/i,
    /\bAnd\s+immediately\b/i,
    /\bhealed\b/i,
    /\blaughed\s+at\s+him\b/i,
    /\bfollowed\s+him\b/i
];

checkedValues.forEach(({ id, translationKey, value }) => {
    forbiddenPatterns.forEach(pattern => {
        if (pattern.test(value)) {
            failures.push(`${id} ${translationKey}: regression value contains forbidden marker ${pattern}: "${value}"`);
        }
    });
});

if (failures.length > 0) {
    console.error('Review reducer regression checks failed:');
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
}

console.log(`Review reducer regression checks passed (${checkedValues.length} extracted values checked).`);

function expectExact(id, translationKey, expected) {
    const value = getSpeechText(id, translationKey);
    checkedValues.push({ id, translationKey, value });
    if (value !== expected) {
        failures.push(`${id} ${translationKey}: expected "${expected}", got "${value}"`);
    }
}

function expectStartsWith(id, translationKey, expectedPrefix) {
    const value = getSpeechText(id, translationKey);
    checkedValues.push({ id, translationKey, value });
    if (!value.startsWith(expectedPrefix)) {
        failures.push(`${id} ${translationKey}: expected to start with "${expectedPrefix}", got "${value}"`);
    }
}

function expectContains(id, translationKey, expectedText) {
    const value = getSpeechText(id, translationKey);
    checkedValues.push({ id, translationKey, value });
    if (!value.includes(expectedText)) {
        failures.push(`${id} ${translationKey}: expected to contain "${expectedText}", got "${value}"`);
    }
}

function expectDoesNotContain(id, translationKey, forbiddenText) {
    const value = getSpeechText(id, translationKey);
    checkedValues.push({ id, translationKey, value });
    if (value.includes(forbiddenText)) {
        failures.push(`${id} ${translationKey}: expected not to contain "${forbiddenText}", got "${value}"`);
    }
}

function expectStatus(id, translationKey, expectedStatus) {
    const value = getStatus(id, translationKey);
    if (value !== expectedStatus) {
        failures.push(`${id} ${translationKey}: expected speechStatus "${expectedStatus}", got "${value}"`);
    }
}

function expectBlank(id, translationKey) {
    const value = getSpeechText(id, translationKey);
    if (value !== '') {
        failures.push(`${id} ${translationKey}: expected blank speechText, got "${value}"`);
    }
}

function expectSourceOneOf(id, translationKey, expectedSources) {
    const value = getSource(id, translationKey);
    if (!expectedSources.includes(value)) {
        failures.push(`${id} ${translationKey}: expected source one of ${expectedSources.join(', ')}, got "${value}"`);
    }
}

function getSpeechText(id, translationKey) {
    const entry = dataset[id];
    if (!entry || !entry.speechText || typeof entry.speechText[translationKey] !== 'string') {
        failures.push(`${id} ${translationKey}: missing speechText entry.`);
        return '';
    }
    return entry.speechText[translationKey];
}

function getStatus(id, translationKey) {
    const entry = dataset[id];
    if (!entry || !entry.speechStatus || typeof entry.speechStatus[translationKey] !== 'string') {
        failures.push(`${id} ${translationKey}: missing speechStatus entry.`);
        return '';
    }
    return entry.speechStatus[translationKey];
}

function getSource(id, translationKey) {
    const entry = dataset[id];
    if (!entry || !entry.speechAudit || !entry.speechAudit[translationKey]) {
        failures.push(`${id} ${translationKey}: missing speechAudit entry.`);
        return '';
    }
    return entry.speechAudit[translationKey].source || '';
}
