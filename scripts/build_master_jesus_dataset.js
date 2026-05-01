const fs = require('fs');
const path = require('path');

const ANCHOR_PATH = path.join(__dirname, '../data/jesus_index_bsb_anchor.json');
const OUTPUT_PATH = path.join(__dirname, '../data/jesus_verses.json');
const REPORT_PATH = path.join(__dirname, '../dev/reports/master_dataset_audit.json');

const SOURCES = {
  NRSVUE: path.join(__dirname, '../sources/extracted_txt/nrsvue_jesus_only_formatted.txt'),
  DBH: path.join(__dirname, '../sources/extracted_txt/dbh_jesus_only_formatted.txt'),
  LAMSA: path.join(__dirname, '../sources/extracted_txt/lamsa_jesus_only_formatted.txt')
};

const BOOK_CODE_MAP = {
  "Matthew": "MAT",
  "Mark": "MRK",
  "Luke": "LUK",
  "John": "JHN",
  "Revelation": "REV"
};

function getBookCode(bookName) {
  return BOOK_CODE_MAP[bookName] || null;
}

function parseReferenceToId(ref) {
  const match = ref.trim().match(/^(.+)\s+(\d+):(\d+)$/);
  if (!match) return null;
  const [_, bookName, chapter, verse] = match;
  const bookCode = getBookCode(bookName);
  if (!bookCode) return null;
  return `${bookCode}_${chapter}_${verse}`;
}

function cleanText(text) {
  if (!text) return "";
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

function loadTranslation(filePath) {
  const data = fs.readFileSync(filePath, 'utf8');
  const lines = data.split(/\r?\n/);
  const idMap = {};
  const refMap = {};
  const malformed = [];
  const extraIgnored = [];

  lines.forEach((line, index) => {
    if (!line.trim()) return;

    // Format: Reference — Text
    // Note: Some lines might have extra dashes, but the first " — " is the separator
    const parts = line.split(' — ');
    if (parts.length < 2) {
      malformed.push({ lineNum: index + 1, content: line });
      return;
    }

    const reference = parts[0].trim();
    // Rejoin rest in case text contains " — "
    const text = cleanText(parts.slice(1).join(' — '));

    const id = parseReferenceToId(reference);
    if (id) {
      // Prefer ID matching
      if (!idMap[id]) {
        idMap[id] = text;
      } else {
        // If ID exists, append? No, usually it's a split verse in the source.
        // Actually, some sources might have multiple lines for one verse.
        idMap[id] += " " + text;
      }
    } else {
      // Store in refMap for fallback
      if (!refMap[reference]) {
        refMap[reference] = text;
      } else {
        refMap[reference] += " " + text;
      }
    }
  });

  return { idMap, refMap, malformed };
}

function build() {
  console.log("Loading anchor...");
  const anchorData = JSON.parse(fs.readFileSync(ANCHOR_PATH, 'utf8'));
  const anchorIds = Object.keys(anchorData);

  const finalDataset = {};
  const audit = {
    totalAnchorVerses: anchorIds.length,
    translations: {}
  };

  const translations = {};
  for (const [name, path] of Object.entries(SOURCES)) {
    console.log(`Loading ${name} source...`);
    translations[name] = loadTranslation(path);
    audit.translations[name] = {
      matchedCount: 0,
      missingCount: 0,
      missingIds: [],
      extraSourceReferencesIgnored: [],
      malformedLines: translations[name].malformed
    };
  }

  anchorIds.forEach(id => {
    const anchorEntry = anchorData[id];
    const verseOutput = {
      id: id,
      book: anchorEntry.book,
      bookCode: anchorEntry.bookCode,
      chapter: anchorEntry.chapter,
      verse: anchorEntry.verse,
      reference: anchorEntry.reference,
      speaker: anchorEntry.speaker,
      normalized: anchorEntry.normalized,
      translations: {},
      anchor: {
        BSB: anchorEntry.text
      },
      status: {}
    };

    for (const name of Object.keys(SOURCES)) {
      const trans = translations[name];
      let text = trans.idMap[id];

      if (!text) {
        // Fallback to reference matching
        text = trans.refMap[anchorEntry.reference];
      }

      if (text) {
        verseOutput.translations[name] = cleanText(text);
        verseOutput.status[name] = "matched";
        audit.translations[name].matchedCount++;
      } else {
        verseOutput.translations[name] = "";
        verseOutput.status[name] = "missing";
        audit.translations[name].missingCount++;
        if (audit.translations[name].missingIds.length < 50) {
          audit.translations[name].missingIds.push(id);
        }
      }
    }

    finalDataset[id] = verseOutput;
  });

  // Track ignored references from source
  for (const name of Object.keys(SOURCES)) {
    const trans = translations[name];
    const usedIds = new Set(anchorIds);
    
    // Check idMap for entries not in anchor
    for (const id in trans.idMap) {
      if (!usedIds.has(id)) {
        if (audit.translations[name].extraSourceReferencesIgnored.length < 50) {
          audit.translations[name].extraSourceReferencesIgnored.push(id);
        }
      }
    }

    // Check refMap for references that didn't match an ID or were never used
    const anchorRefs = new Set(anchorIds.map(id => anchorData[id].reference));
    for (const ref in trans.refMap) {
        if (!anchorRefs.has(ref)) {
            if (audit.translations[name].extraSourceReferencesIgnored.length < 50) {
                audit.translations[name].extraSourceReferencesIgnored.push(ref);
            }
        }
    }
  }

  console.log(`Saving final dataset to ${OUTPUT_PATH}...`);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(finalDataset, null, 2));

  console.log(`Saving audit report to ${REPORT_PATH}...`);
  // Trim audit report for readable JSON
  const trimmedAudit = {
    totalAnchorVerses: audit.totalAnchorVerses,
    translations: {}
  };

  for (const name of Object.keys(SOURCES)) {
    trimmedAudit.translations[name] = {
      matchedCount: audit.translations[name].matchedCount,
      missingCount: audit.translations[name].missingCount,
      missingIds: audit.translations[name].missingIds,
      extraSourceReferencesIgnored: audit.translations[name].extraSourceReferencesIgnored,
      malformedLinesCount: audit.translations[name].malformedLines.length,
      first5MalformedLines: audit.translations[name].malformedLines.slice(0, 5)
    };
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(trimmedAudit, null, 2));

  console.log("Build complete.");
}

build();
