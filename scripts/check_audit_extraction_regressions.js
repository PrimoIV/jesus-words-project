const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AUDIT_FILE = path.join(ROOT, 'dev', 'reports', 'speech_contamination_audit.json');

if (!fs.existsSync(AUDIT_FILE)) {
    console.error(`Missing audit report: ${path.relative(ROOT, AUDIT_FILE).replace(/\\/g, '/')}`);
    console.error('Run: node scripts/audit_speech_contamination.js');
    process.exit(1);
}

let audit;
try {
    audit = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
} catch (error) {
    console.error(`Could not parse ${path.relative(ROOT, AUDIT_FILE).replace(/\\/g, '/')}: ${error.message}`);
    process.exit(1);
}

const failures = [];

const forbiddenChecks = [
    {
        id: 'JHN_8_25',
        translationKey: 'NRSVUE',
        message: 'must not suggest the other-speaker quote "Who are you?"',
        test: value => value === 'Who are you?'
    },
    {
        id: 'JHN_8_25',
        translationKey: 'DBH',
        message: 'must not suggest the other-speaker quote "Who are you?"',
        test: value => value === 'Who are you?'
    },
    {
        id: 'MRK_10_39',
        translationKey: 'NRSVUE',
        message: 'must not suggest the James/John quote "We are able."',
        test: value => value === 'We are able.'
    },
    {
        id: 'MRK_10_39',
        translationKey: 'DBH',
        message: 'must not suggest the James/John quote "We can."',
        test: value => value === 'We can.'
    },
    {
        id: 'JHN_8_41',
        translationKey: 'NRSVUE',
        message: 'must not suggest the other-speaker quote beginning "We are not illegitimate"',
        test: value => value.includes('We are not illegitimate')
    },
    {
        id: 'JHN_8_41',
        translationKey: 'DBH',
        message: 'must not suggest the other-speaker quote beginning "We were not born"',
        test: value => value.includes('We were not born')
    },
    {
        id: 'MAT_13_51',
        translationKey: 'DBH',
        message: 'must not suggest the disciples response "Yes."',
        test: value => value === 'Yes.'
    },
    {
        id: 'MAT_15_28',
        translationKey: 'LAMSA',
        message: 'must not leave leading "to her"',
        test: value => /^to her\b/i.test(value)
    },
    {
        id: 'LUK_6_3',
        translationKey: 'LAMSA',
        message: 'must not leave leading "saying to them"',
        test: value => /^saying to them\b/i.test(value)
    },
    {
        id: 'MRK_10_52',
        translationKey: 'LAMSA',
        message: 'must not leave trailing narration beginning "And immediately"',
        test: value => value.includes('And immediately')
    },
    {
        id: 'MAT_8_13',
        translationKey: 'LAMSA',
        message: 'must not leave trailing "boy was healed" narration',
        test: value => value.includes('boy was healed')
    }
];

const expectedChecks = [
    {
        id: 'JHN_8_25',
        translationKey: 'NRSVUE',
        expected: 'Why do I speak to you at all?'
    },
    {
        id: 'JHN_8_25',
        translationKey: 'DBH',
        expected: 'To begin with, why am I even speaking to you?'
    },
    {
        id: 'MRK_10_39',
        translationKey: 'NRSVUE',
        expected: 'The cup that I drink you will drink, and with the baptism with which I am baptized you will be baptized,'
    },
    {
        id: 'MRK_10_39',
        translationKey: 'DBH',
        expected: 'You shall drink the cup I drink, and be baptized with the baptism with which I am baptized;'
    },
    {
        id: 'MAT_15_28',
        translationKey: 'LAMSA',
        expected: 'O woman, your faith is great; let it be to you as you wish'
    },
    {
        id: 'LUK_6_3',
        translationKey: 'LAMSA',
        expected: 'Have you not read what David did when he and those who were with him were hungry?'
    },
    {
        id: 'MRK_10_52',
        translationKey: 'LAMSA',
        expected: 'See; your faith has healed you'
    },
    {
        id: 'MAT_8_13',
        translationKey: 'LAMSA',
        expected: 'Go, let it be done to you according to your belief'
    }
];

forbiddenChecks.forEach(check => {
    const value = getSuggestedSpeechText(check.id, check.translationKey);
    if (check.test(value)) {
        failures.push(`${check.id} ${check.translationKey}: ${check.message}. Current value: "${value}"`);
    }
});

expectedChecks.forEach(check => {
    const value = getSuggestedSpeechText(check.id, check.translationKey);
    if (value !== check.expected) {
        failures.push(`${check.id} ${check.translationKey}: expected "${check.expected}", got "${value}"`);
    }
});

if (failures.length > 0) {
    console.error('Audit extraction regression checks failed:');
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
}

console.log(`Audit extraction regression checks passed (${forbiddenChecks.length + expectedChecks.length} checks).`);

function getSuggestedSpeechText(id, translationKey) {
    const value = audit[id] && audit[id].translations && audit[id].translations[translationKey];
    if (!value) {
        failures.push(`${id} ${translationKey}: missing audit entry.`);
        return '';
    }
    return typeof value.suggestedSpeechText === 'string' ? value.suggestedSpeechText : '';
}
