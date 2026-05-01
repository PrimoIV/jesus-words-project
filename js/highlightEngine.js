import { IGNORE_WORDS, CRITICAL_WORDS, SYNONYMS } from './highlightRules.js';

function normalizeWord(word) {
    return word.replace(/[.,:;!?'"“”‘’\(\)\[\]\-—]/g, '').toLowerCase();
}

function getEquivalence(word) {
    const norm = normalizeWord(word);
    return SYNONYMS[norm] || norm;
}

export function processWords(text) {
    if (!text) return { words: [], tokenSet: new Set() };
    const words = text.split(/\s+/).filter(w => w.trim() !== '');
    const tokenSet = new Set();
    words.forEach(w => {
        const norm = getEquivalence(w);
        if (norm) tokenSet.add(norm);
    });
    return { words, tokenSet };
}

export function generateHighlightedHTML(wordsArray, setA, setB) {
    if (wordsArray.length === 0) return '<div class="placeholder-text">Missing translation</div>';
    
    const MAX_CHUNKS = 4; // Max density allowed
    
    const diffStates = wordsArray.map(w => {
        const norm = getEquivalence(w);
        if (!norm) return false;
        
        const missingFromA = !setA.has(norm);
        const missingFromB = !setB.has(norm);
        
        if (missingFromA || missingFromB) {
            if (IGNORE_WORDS.has(norm)) return false;
            return true;
        }
        return false;
    });
    
    const chunks = [];
    let currentChunk = null;
    
    for (let i = 0; i < wordsArray.length; i++) {
        if (diffStates[i]) {
            if (!currentChunk) {
                currentChunk = { start: i, end: i, score: 0 };
                chunks.push(currentChunk);
            }
            currentChunk.end = i;
            
            const norm = getEquivalence(wordsArray[i]);
            if (CRITICAL_WORDS.has(norm)) {
                currentChunk.score += 20; // Massive weight
            } else {
                currentChunk.score += 1;
            }
        } else {
            currentChunk = null;
        }
    }
    
    if (chunks.length > MAX_CHUNKS) {
        chunks.sort((a, b) => a.score - b.score);
        const chunksToRemove = chunks.slice(0, chunks.length - MAX_CHUNKS);
        chunksToRemove.forEach(chunk => {
            for (let i = chunk.start; i <= chunk.end; i++) diffStates[i] = false;
        });
    }
    
    const renderOutput = [];
    let inSpan = false;
    
    for (let i = 0; i < wordsArray.length; i++) {
        const isDiff = diffStates[i];
        
        if (isDiff && !inSpan) {
            renderOutput.push('<span class="diff-word">' + wordsArray[i]);
            inSpan = true;
        } else if (isDiff && inSpan) {
            renderOutput.push(wordsArray[i]);
        } else if (!isDiff && inSpan) {
            renderOutput[renderOutput.length - 1] += '</span>';
            inSpan = false;
            renderOutput.push(wordsArray[i]);
        } else {
            renderOutput.push(wordsArray[i]);
        }
    }
    
    if (inSpan) renderOutput[renderOutput.length - 1] += '</span>';
    
    return renderOutput.join(' ');
}
