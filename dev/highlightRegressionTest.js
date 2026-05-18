import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildHighlightSpans,
    classifyDifference,
    setHighlightReviewLayer
} from '../js/highlightEngine.js';
import { getDisplayJesusText, setJesusSpeechOverrides } from '../js/jesusSpeechText.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const JESUS_SPEECH_OVERRIDES_FILE = path.join(ROOT, 'dev/jesus_speech_overrides.json');

setHighlightReviewLayer({
    overrides: [
        { match: ['say', 'said'], forceType: 'grammar' },
        { match: ['eternal', 'age-long'], forceType: 'interpretive' }
    ]
});

function typesFor(left, right, mode = 'meaning') {
    return buildHighlightSpans(left, [right], mode).map(span => span.type);
}

function assertNoMeaningHighlight(left, right) {
    assert.deepEqual(
        typesFor(left, right, 'meaning'),
        [],
        `${left} vs ${right} should not highlight in meaning mode`
    );
}

function assertMeaningHighlight(left, right) {
    const types = typesFor(left, right, 'meaning');
    assert.ok(types.length > 0, `${left} vs ${right} should highlight in meaning mode`);
}

function assertInterpretiveHighlight(left, right) {
    const types = typesFor(left, right, 'meaning');
    assert.ok(
        types.includes('interpretive'),
        `${left} vs ${right} should classify at least one span as interpretive; got ${types.join(', ') || 'none'}`
    );
}

function assertNoStandaloneMeaningHighlight(left, right = 'translation choice') {
    const spans = buildHighlightSpans(left, [right], 'meaning');
    assert.ok(
        !spans.some(span => span.type === 'meaning' && span.normalized === left.toLowerCase()),
        `${left} should not highlight as a standalone meaning span`
    );
}

function assertAnyHighlight(left, right) {
    const spans = buildHighlightSpans(left, [right], 'meaning');
    assert.ok(spans.length > 0, `${left} vs ${right} should still highlight`);
}

[
    ['sin', 'sins'],
    ['sins', 'sin'],
    ['debt', 'debts'],
    ['servants', 'servant'],
    ['sons', 'son'],
    ['son', 'sons'],
    ['says', 'said'],
    ['saying', 'said'],
    ['thou', 'you'],
    ['thy', 'your'],
    ['say', 'said']
].forEach(([left, right]) => assertNoMeaningHighlight(left, right));

[
    'man',
    'not',
    'Jesus',
    'also',
    'even',
    'there',
    'things',
    'O',
    'rather',
    'very'
].forEach(term => assertNoStandaloneMeaningHighlight(term));

[
    'hand',
    'came',
    'know',
    'take',
    'time',
    'want'
].forEach(term => assertNoStandaloneMeaningHighlight(term));

[
    ['blessed', 'happy'],
    ['blessed', 'blissful'],
    ['kingdom', 'reign'],
    ['gehenna', 'hell'],
    ['world', 'cosmos'],
    ['evil', 'wicked man'],
    ['falter', 'stumble'],
    ['soul', 'life'],
    ['playacting charlatans', 'hypocrites'],
    ['made clean', 'heal'],
    ['aeon', 'eternal'],
    ['slave', 'servant'],
    ['spirit', 'breath'],
    ['faith', 'trust'],
    ['forgive', 'release'],
    ['forgive', 'let go'],
    ['eternal life', 'life of the Age'],
    ['saved', 'made whole'],
    ['son', 'servant'],
    ['blessed', 'cursed'],
    ['save', 'condemn']
].forEach(([left, right]) => assertMeaningHighlight(left, right));

[
    ['forgive', 'let go'],
    ['repent', 'change your hearts'],
    ['eternal life', 'life of the Age'],
    ['kingdom of heaven', 'kingdom of the heavens'],
    ['made whole', 'saved'],
    ['servant', 'slave'],
    ['happy', 'blessed'],
    ['blissful', 'blessed'],
    ['hell', 'gehenna'],
    ['Gehenna', 'hell'],
    ['trust', 'faith'],
    ['world', 'cosmos'],
    ['wicked man', 'evil'],
    ['falter', 'stumble'],
    ['soul', 'life'],
    ['let go', 'forgive'],
    ['made clean', 'heal'],
    ['playacting charlatans', 'hypocrites']
].forEach(([left, right]) => assertInterpretiveHighlight(left, right));

assertInterpretiveHighlight('eternal', 'age-long');

[
    ['Son of Man', 'the human one'],
    ['I AM', 'ego eimi'],
    ['kingdom of heaven', 'kingdom of the heavens'],
    ['life of the Age', 'eternal life']
].forEach(([left, right]) => assertAnyHighlight(left, right));

[
    ['blessed', ['happy'], 'interpretive'],
    ['gehenna', ['hell'], 'interpretive'],
    ['kingdom', ['reign'], 'interpretive'],
    ['son', ['sons'], 'grammar'],
    ['said', ['says'], 'grammar']
].forEach(([token, comparisons, expected]) => {
    const result = classifyDifference(token, comparisons);
    assert.equal(result.type, expected, `${token}/${comparisons.join(', ')} should classify as ${expected}`);
});

assert.ok(
    ['meaning', 'critical'].includes(classifyDifference('save', ['condemn']).type),
    'save/condemn should classify as meaning or critical'
);

const dataset = JSON.parse(fs.readFileSync(DATASET_FILE, 'utf8'));
const jesusSpeechOverrides = JSON.parse(fs.readFileSync(JESUS_SPEECH_OVERRIDES_FILE, 'utf8'));
setJesusSpeechOverrides(jesusSpeechOverrides);

assert.equal(
    getDisplayJesusText('LUK_8_45', dataset.LUK_8_45, 'DBH'),
    'Who touches me?',
    'LUK_8_45 DBH should reject mixed-speech contamination'
);
assert.equal(
    getDisplayJesusText('LUK_8_45', dataset.LUK_8_45, 'NRSVUE'),
    'Who touched me?',
    'LUK_8_45 NRSVUE should reject mixed-speech contamination'
);
assert.equal(
    getDisplayJesusText('LUK_8_45', dataset.LUK_8_45, 'LAMSA'),
    'Who touched me?',
    'LUK_8_45 LAMSA should reject mixed-speech contamination'
);

console.log('Highlight regression tests passed.');
