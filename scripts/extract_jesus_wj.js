const fs = require('fs');
const path = require('path');

const BOOK_MAP = {
  MAT: "Matthew",
  MRK: "Mark",
  LUK: "Luke",
  JHN: "John",
  REV: "Revelation"
};

const inputFiles = ['MAT.usj', 'MRK.usj', 'LUK.usj', 'JHN.usj', 'REV.usj'];
const sourceDir = path.join(__dirname, '..', 'sources', 'bsb_usj');
const outputFile = path.join(__dirname, '..', 'data', 'jesus_verses_bsb.json');

const outputData = {};

let currentBook = null;
let currentChapter = null;
let currentVerse = null;
let insideWJ = false;

function processNode(node) {
    if (typeof node === 'string') {
        if (insideWJ && currentBook && currentChapter && currentVerse) {
            const key = `${currentBook}_${currentChapter}_${currentVerse}`;
            if (!outputData[key]) {
                const bookName = BOOK_MAP[currentBook];
                if (!bookName) {
                    console.warn(`Warning: Book code ${currentBook} not found in BOOK_MAP`);
                }
                outputData[key] = {
                    book: bookName || currentBook,
                    bookCode: currentBook,
                    chapter: isNaN(Number(currentChapter)) ? currentChapter : Number(currentChapter),
                    verse: isNaN(Number(currentVerse)) ? currentVerse : Number(currentVerse),
                    reference: `${bookName || currentBook} ${currentChapter}:${currentVerse}`,
                    speaker: "Jesus",
                    text: ""
                };
            }
            outputData[key].text += node;
        }
        return;
    }

    if (!node || typeof node !== 'object') return;

    if (node.type === 'book') {
        currentBook = node.code;
    } else if (node.type === 'chapter') {
        currentChapter = node.number;
    } else if (node.type === 'verse') {
        currentVerse = node.number;
    } else if (node.type === 'note') {
        // Skip notes entirely
        return;
    }

    let wasInsideWJ = insideWJ;
    if (node.type === 'char' && node.marker === 'wj') {
        insideWJ = true;
    }

    if (Array.isArray(node.content)) {
        for (const child of node.content) {
            processNode(child);
        }
    }

    if (node.type === 'char' && node.marker === 'wj') {
        insideWJ = wasInsideWJ;
    }
}

for (const file of inputFiles) {
    const filePath = path.join(sourceDir, file);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        continue;
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    currentBook = null;
    currentChapter = null;
    currentVerse = null;
    insideWJ = false;
    
    processNode(data);
}

// Clean up the text by trimming extraneous spaces and specific cleanup rules
for (const key in outputData) {
    let text = outputData[key].text;

    // 1. Initial Normalization (Curly to Straight)
    text = text.replace(/[“”]/g, '"');
    text = text.replace(/[‘’]/g, "'");

    // 2. Replace quote-join artifacts:
    text = text.replace(/,"\s*"/g, ", ");
    text = text.replace(/!"\s*"/g, "! ");
    text = text.replace(/\?"\s*"/g, "? ");
    text = text.replace(/\."\s*"/g, ". ");
    text = text.replace(/"\s*"/g, " ");

    // 3. Fix missing spaces after punctuation:
    text = text.replace(/,([A-Za-z])/g, ", $1");
    text = text.replace(/;([A-Za-z])/g, "; $1");
    text = text.replace(/:([A-Za-z])/g, ": $1");
    text = text.replace(/\.([A-Za-z])/g, ". $1");
    text = text.replace(/\?([A-Za-z])/g, "? $1");
    text = text.replace(/!([A-Za-z])/g, "! $1");

    // 4. Fix apostrophe quote starts:
    text = text.replace(/([A-Za-z])'([A-Z])/g, "$1 '$2");

    // 5. Normalize em dash spacing:
    text = text.replace(/—/g, "-");
    text = text.replace(/\s*-\s*/g, " - ");

    // 6. Fix quote-intro spacing:
    text = text.replace(/:’/g, ": '");
    text = text.replace(/:'/g, ": '");

    // 7. Fix spaced hyphenated words:
    text = text.replace(/\b([A-Za-z]+)\s-\s([A-Za-z]+)\s-\s([A-Za-z]+)\b/g, "$1-$2-$3");
    text = text.replace(/\b([A-Za-z]+)\s-\s([A-Za-z]+)\b/g, "$1-$2");

    // 8. Fix common split-sentence artifact:
    text = text.replace(/,\s+(It is fitting|For truly|But to sit|Do not be afraid|You give them|The girl is not dead|Can you drink|Have you never read)/g, ". $1");

    // 9. Targeted final cleanup:
    text = text.replace(/turn'a man/g, "turn a man");
    text = text.replace(/membersof/g, "members of");
    text = text.replace(/infantsYou/g, "infants You");
    text = text.replace(/same thing\.'I/g, "same thing. 'I");

    // 10. Final Cleanup:
    text = text.replace(/\[\s*['"]+\s*\]/g, ''); // Bracket artifacts
    text = text.replace(/\s+/g, ' ');           // Collapse whitespace
    text = text.trim();

    // 11. Remove leading and trailing quotes
    text = text.replace(/^["']+/, '').replace(/["']+$/, '');
    text = text.trim();

    // Delete bad entries: empty or < 5 characters
    if (!text || text.length < 5) {
        delete outputData[key];
        continue;
    }

    outputData[key].text = text;

    // 12. Rebuild normalized from final cleaned text
    outputData[key].normalized = text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2), 'utf8');
console.log(`Extracted Jesus' words to ${outputFile}`);
