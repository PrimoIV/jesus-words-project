const fs = require('fs');
const path = require('path');

const CONTEXT_FILE = path.join(__dirname, '..', 'data/context/jesus_discourse_blocks.json');

const BOOK_ORDER = new Map([
    ['MAT', 1],
    ['MRK', 2],
    ['LUK', 3],
    ['JHN', 4],
    ['REV', 5]
]);

let cachedBlocks = null;

function loadJesusDiscourseContext() {
    if (cachedBlocks) return cachedBlocks;

    const context = JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8'));
    const blocks = Array.isArray(context) ? context : context.blocks;
    if (!Array.isArray(blocks)) {
        throw new Error(`${relativeContextFile()} must contain a blocks array`);
    }

    cachedBlocks = blocks.map((block, index) => normalizeBlock(block, index));
    return cachedBlocks;
}

function getDiscourseBlocksForVerseId(verseId, options = {}) {
    return loadJesusDiscourseContext().filter(block => (
        isVerseIdInBlockRange(verseId, block)
        && (!options.type || block.type === options.type)
    ));
}

function getPrimaryDiscourseBlockForVerseId(verseId, options = {}) {
    return getDiscourseBlocksForVerseId(verseId, options)[0] || null;
}

function getParableContextForVerseId(verseId) {
    return getPrimaryDiscourseBlockForVerseId(verseId, { type: 'parable' });
}

function isParableContextVerseId(verseId) {
    return Boolean(getParableContextForVerseId(verseId));
}

function isVerseIdInBlockRange(verseId, block) {
    const parsed = parseVerseId(verseId);
    if (!parsed) return false;
    return compareVerseRefs(parsed, block.start) >= 0
        && compareVerseRefs(parsed, block.end) <= 0;
}

function normalizeBlock(block, index) {
    if (!block || typeof block !== 'object') {
        throw new Error(`Discourse block at index ${index} is not an object`);
    }
    if (typeof block.range !== 'string') {
        throw new Error(`Discourse block at index ${index} is missing a range`);
    }

    const [startId, endId] = block.range.split('-');
    const start = parseVerseId(startId);
    const end = parseVerseId(endId);

    if (!start || !end) {
        throw new Error(`Discourse block "${block.range}" has an invalid range`);
    }
    if (compareVerseRefs(start, end) > 0) {
        throw new Error(`Discourse block "${block.range}" starts after it ends`);
    }

    return {
        ...block,
        start,
        end
    };
}

function parseVerseId(id) {
    if (typeof id !== 'string') return null;
    const match = id.match(/^([A-Z]+)_(\d+)_(\d+)$/);
    return match
        ? { id, book: match[1], chapter: Number(match[2]), verse: Number(match[3]) }
        : null;
}

function compareVerseRefs(a, b) {
    return (BOOK_ORDER.get(a.book) || 999) - (BOOK_ORDER.get(b.book) || 999)
        || a.chapter - b.chapter
        || a.verse - b.verse;
}

function relativeContextFile() {
    return path.relative(path.join(__dirname, '..'), CONTEXT_FILE).replace(/\\/g, '/');
}

module.exports = {
    CONTEXT_FILE,
    loadJesusDiscourseContext,
    getDiscourseBlocksForVerseId,
    getPrimaryDiscourseBlockForVerseId,
    getParableContextForVerseId,
    isParableContextVerseId,
    parseVerseId,
    compareVerseRefs
};
