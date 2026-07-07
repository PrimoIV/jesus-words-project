const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const EPUB_FILE = path.join(ROOT, 'docs/sources/lamsa_epub/Holy Bible - George M. Lamsa.epub');
const OUTPUT_FILE = path.join(ROOT, 'data/translation_verse_maps/lamsa_epub_verse_map.json');
const REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_epub_extraction_report.json');

const OPF_FILE = 'OEBPS/volume.opf';
const EXPECTED_METADATA = {
    title: 'Holy Bible',
    creator: 'George M. Lamsa',
    publisher: 'HarperCollins',
    date: '2013',
    identifier: '9780062225092',
    source: 'GoogleEbooks'
};

const BOOKS = [
    {
        name: 'Matthew',
        code: 'MAT',
        file: 'OEBPS/text/9780062225092_40_Matthew.xhtml',
        expectedChapters: 28,
        expectedVerses: 1071
    },
    {
        name: 'Mark',
        code: 'MRK',
        file: 'OEBPS/text/9780062225092_41_Mark.xhtml',
        expectedChapters: 16,
        expectedVerses: 678
    },
    {
        name: 'Luke',
        code: 'LUK',
        file: 'OEBPS/text/9780062225092_42_Luke.xhtml',
        expectedChapters: 24,
        expectedVerses: 1151
    },
    {
        name: 'John',
        code: 'JHN',
        file: 'OEBPS/text/9780062225092_43_John.xhtml',
        expectedChapters: 21,
        expectedVerses: 879
    },
    {
        name: 'Revelation',
        code: 'REV',
        file: 'OEBPS/text/9780062225092_66_Revelation.xhtml',
        expectedChapters: 22,
        expectedVerses: 404
    }
];

const EXPECTED_MARK_15_34 = 'And at the ninth hour, Jesus cried out with a loud voice, saying Eli, Eli, lemana, shabakthani! which means, [“Which means” is used by Mark to explain translation from one Aramaic dialect to another.] My God, my God, for this I was spared!';

const KNOWN_VERSE_BOUNDARY_SPLITS = [
    {
        book: 'Mark',
        chapter: 4,
        verse: 40,
        nextVerse: 41,
        marker: 'And they were exceedingly afraid,'
    }
];

function main() {
    const validationErrors = [];
    const duplicateVerseIds = [];
    const emptyVerseIds = [];
    const numberingWarnings = [];
    const boundarySplits = [];
    const verseMap = {};

    const zip = new ZipReader(EPUB_FILE);
    const metadata = parseMetadata(zip.readText(OPF_FILE));
    const metadataMismatches = compareMetadata(metadata, EXPECTED_METADATA);
    metadataMismatches.forEach(item => {
        validationErrors.push(`EPUB metadata mismatch for ${item.field}: expected "${item.expected}", found "${item.actual}"`);
    });

    const bookReports = [];
    for (const book of BOOKS) {
        const xhtml = zip.readText(book.file);
        const chapters = extractBookChapters(xhtml, book, numberingWarnings, boundarySplits);
        const bookReport = {
            book: book.name,
            code: book.code,
            sourceFile: book.file,
            expectedChapters: book.expectedChapters,
            actualChapters: chapters.length,
            expectedVerses: book.expectedVerses,
            actualVerses: 0,
            chapterVerseCounts: {}
        };

        if (chapters.length !== book.expectedChapters) {
            validationErrors.push(`${book.name} chapter count mismatch: expected ${book.expectedChapters}, found ${chapters.length}`);
        }

        const seenChapters = new Set();
        for (const chapter of chapters) {
            if (seenChapters.has(chapter.number)) {
                validationErrors.push(`${book.name} chapter ${chapter.number} appeared more than once`);
            }
            seenChapters.add(chapter.number);

            bookReport.chapterVerseCounts[chapter.number] = chapter.verses.length;
            bookReport.actualVerses += chapter.verses.length;

            for (const verse of chapter.verses) {
                const verseId = `${book.code}_${chapter.number}_${verse.number}`;
                if (Object.prototype.hasOwnProperty.call(verseMap, verseId)) {
                    duplicateVerseIds.push(verseId);
                    continue;
                }
                if (!verse.text.trim()) {
                    emptyVerseIds.push(verseId);
                }
                verseMap[verseId] = verse.text;
            }
        }

        for (let chapterNumber = 1; chapterNumber <= book.expectedChapters; chapterNumber++) {
            if (!seenChapters.has(chapterNumber)) {
                validationErrors.push(`${book.name} chapter ${chapterNumber} is missing`);
            }
        }

        if (bookReport.actualVerses !== book.expectedVerses) {
            validationErrors.push(`${book.name} verse count mismatch: expected ${book.expectedVerses}, found ${bookReport.actualVerses}`);
        }

        bookReports.push(bookReport);
    }

    duplicateVerseIds.forEach(id => validationErrors.push(`Duplicate verse ID: ${id}`));
    emptyVerseIds.forEach(id => validationErrors.push(`Empty verse text: ${id}`));
    numberingWarnings.forEach(warning => validationErrors.push(warning));

    const specialChecks = {
        MRK_15_34: {
            expected: EXPECTED_MARK_15_34,
            actual: verseMap.MRK_15_34 || null,
            passed: verseMap.MRK_15_34 === EXPECTED_MARK_15_34
        }
    };

    if (!verseMap.MRK_15_34) {
        validationErrors.push('MRK_15_34 is missing');
    } else {
        if (/few this I was spared/i.test(verseMap.MRK_15_34)) {
            validationErrors.push('MRK_15_34 contains the forbidden OCR corruption "few this I was spared"');
        }
        if (verseMap.MRK_15_34 !== EXPECTED_MARK_15_34) {
            validationErrors.push(`MRK_15_34 text mismatch: expected "${EXPECTED_MARK_15_34}", found "${verseMap.MRK_15_34}"`);
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        inputEpub: relativeToRoot(EPUB_FILE),
        outputVerseMap: relativeToRoot(OUTPUT_FILE),
        metadata: {
            expected: EXPECTED_METADATA,
            actual: metadata,
            mismatches: metadataMismatches
        },
        summary: {
            totalVerses: Object.keys(verseMap).length,
            expectedTotalVerses: BOOKS.reduce((sum, book) => sum + book.expectedVerses, 0),
            duplicateVerseIds: duplicateVerseIds.length,
            emptyVerseIds: emptyVerseIds.length,
            numberingWarnings: numberingWarnings.length,
            boundarySplits: boundarySplits.length,
            validationPassed: validationErrors.length === 0
        },
        books: bookReports,
        specialChecks,
        duplicateVerseIds,
        emptyVerseIds,
        boundarySplits,
        numberingWarnings,
        validationErrors
    };

    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

    if (validationErrors.length > 0) {
        console.error(`LAMSA EPUB extraction failed with ${validationErrors.length} validation error(s).`);
        console.error(`Report saved to ${relativeToRoot(REPORT_FILE)}`);
        process.exit(1);
    }

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(verseMap, null, 2)}\n`);

    console.log(`LAMSA EPUB extraction complete: ${Object.keys(verseMap).length} verses.`);
    for (const book of bookReports) {
        console.log(`${book.book}: ${book.actualChapters} chapters, ${book.actualVerses} verses.`);
    }
    console.log(`Verse map saved to ${relativeToRoot(OUTPUT_FILE)}`);
    console.log(`Report saved to ${relativeToRoot(REPORT_FILE)}`);
}

function extractBookChapters(xhtml, book, numberingWarnings, boundarySplits) {
    const headings = [];
    const headingRegex = /<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi;
    let headingMatch;

    while ((headingMatch = headingRegex.exec(xhtml)) !== null) {
        const attributes = headingMatch[1] || '';
        const headingText = cleanText(headingMatch[2]);
        const chapterMatch = headingText.match(/^CHAPTER\s+(\d+)$/i);
        if (!chapterMatch) continue;

        const classMatch = attributes.match(/\bclass\s*=\s*["']([^"']+)["']/i);
        const classNames = classMatch ? classMatch[1].split(/\s+/) : [];
        const looksLikeChapterHeading = classNames.some(className => /^ch\d*$/i.test(className));
        if (!looksLikeChapterHeading) continue;

        headings.push({
            number: Number(chapterMatch[1]),
            start: headingMatch.index,
            end: headingRegex.lastIndex
        });
    }

    return headings.map((heading, index) => {
        const nextHeading = headings[index + 1];
        const chapterHtml = xhtml.slice(heading.end, nextHeading ? nextHeading.start : xhtml.length);
        return {
            number: heading.number,
            verses: extractChapterVerses(chapterHtml, book, heading.number, numberingWarnings, boundarySplits)
        };
    });
}

function extractChapterVerses(chapterHtml, book, chapterNumber, numberingWarnings, boundarySplits) {
    const verses = [];
    const paragraphRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let paragraphMatch;

    while ((paragraphMatch = paragraphRegex.exec(chapterHtml)) !== null) {
        const paragraphText = cleanText(paragraphMatch[1]);
        if (!paragraphText) continue;

        const explicitVerseMatch = paragraphText.match(/^(\d+)\s+([\s\S]*)$/);
        let verseNumber;
        let verseText;

        if (verses.length === 0 && !explicitVerseMatch) {
            verseNumber = 1;
            verseText = paragraphText;
        } else if (explicitVerseMatch) {
            verseNumber = Number(explicitVerseMatch[1]);
            verseText = explicitVerseMatch[2].trim();
        } else {
            numberingWarnings.push(`${book.name} ${chapterNumber}: paragraph without a leading verse number after verse 1: "${paragraphText.slice(0, 120)}"`);
            verseNumber = verses.length + 1;
            verseText = paragraphText;
        }

        const boundarySplit = findKnownBoundarySplit(book.name, chapterNumber, verseNumber, verseText);
        if (boundarySplit) {
            verses.push({
                number: verseNumber,
                text: boundarySplit.firstText
            });
            verses.push({
                number: boundarySplit.nextVerse,
                text: boundarySplit.secondText
            });
            boundarySplits.push({
                book: book.name,
                chapter: chapterNumber,
                verse: verseNumber,
                nextVerse: boundarySplit.nextVerse,
                marker: boundarySplit.marker,
                firstText: boundarySplit.firstText,
                secondText: boundarySplit.secondText
            });
            continue;
        }

        verses.push({ number: verseNumber, text: verseText });
    }

    return verses;
}

function findKnownBoundarySplit(bookName, chapterNumber, verseNumber, verseText) {
    const split = KNOWN_VERSE_BOUNDARY_SPLITS.find(item => (
        item.book === bookName
        && item.chapter === chapterNumber
        && item.verse === verseNumber
    ));
    if (!split) return null;

    const splitIndex = verseText.indexOf(split.marker);
    if (splitIndex <= 0) return null;

    return {
        nextVerse: split.nextVerse,
        marker: split.marker,
        firstText: verseText.slice(0, splitIndex).trim(),
        secondText: verseText.slice(splitIndex).trim()
    };
}

function parseMetadata(opf) {
    return {
        title: readTag(opf, 'dc:title'),
        creator: readTag(opf, 'dc:creator'),
        publisher: readTag(opf, 'dc:publisher'),
        date: readTag(opf, 'dc:date'),
        identifier: readTag(opf, 'dc:identifier'),
        source: readMetaContent(opf, 'GBSEpubSource')
    };
}

function compareMetadata(actual, expected) {
    return Object.entries(expected).flatMap(([field, expectedValue]) => {
        const actualValue = actual[field] || '';
        return actualValue === expectedValue
            ? []
            : [{ field, expected: expectedValue, actual: actualValue }];
    });
}

function readTag(xml, tagName) {
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = xml.match(new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, 'i'));
    return match ? cleanText(match[1]) : '';
}

function readMetaContent(xml, name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = xml.match(new RegExp(`<meta\\b(?=[^>]*\\bname=["']${escapedName}["'])(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*/?>`, 'i'));
    return match ? decodeHtmlEntities(match[1].trim()) : '';
}

function cleanText(html) {
    return decodeHtmlEntities(
        html
            .replace(/<a\b[^>]*\/>/gi, '')
            .replace(/<a\b[^>]*>\s*<\/a>/gi, '')
            .replace(/<br\b[^>]*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim()
    );
}

function decodeHtmlEntities(text) {
    const namedEntities = {
        amp: '&',
        apos: "'",
        gt: '>',
        lt: '<',
        nbsp: ' ',
        quot: '"',
        ldquo: '“',
        rdquo: '”',
        lsquo: '‘',
        rsquo: '’',
        ndash: '–',
        mdash: '—'
    };

    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, body) => {
        if (body[0] === '#') {
            const codePoint = body[1].toLowerCase() === 'x'
                ? Number.parseInt(body.slice(2), 16)
                : Number.parseInt(body.slice(1), 10);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
        }

        return Object.prototype.hasOwnProperty.call(namedEntities, body.toLowerCase())
            ? namedEntities[body.toLowerCase()]
            : entity;
    });
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

class ZipReader {
    constructor(filePath) {
        this.filePath = filePath;
        this.buffer = fs.readFileSync(filePath);
        this.entries = this.readCentralDirectory();
    }

    readText(name) {
        const entry = this.entries.get(name);
        if (!entry) {
            throw new Error(`EPUB entry not found: ${name}`);
        }

        const buffer = this.readEntry(entry);
        return buffer.toString('utf8');
    }

    readCentralDirectory() {
        const eocdOffset = this.findEndOfCentralDirectory();
        const entryCount = this.buffer.readUInt16LE(eocdOffset + 10);
        const centralDirectoryOffset = this.buffer.readUInt32LE(eocdOffset + 16);
        const entries = new Map();

        let offset = centralDirectoryOffset;
        for (let index = 0; index < entryCount; index++) {
            if (this.buffer.readUInt32LE(offset) !== 0x02014b50) {
                throw new Error(`Invalid ZIP central directory at offset ${offset}`);
            }

            const method = this.buffer.readUInt16LE(offset + 10);
            const compressedSize = this.buffer.readUInt32LE(offset + 20);
            const uncompressedSize = this.buffer.readUInt32LE(offset + 24);
            const nameLength = this.buffer.readUInt16LE(offset + 28);
            const extraLength = this.buffer.readUInt16LE(offset + 30);
            const commentLength = this.buffer.readUInt16LE(offset + 32);
            const localHeaderOffset = this.buffer.readUInt32LE(offset + 42);
            const nameStart = offset + 46;
            const name = this.buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');

            entries.set(name, {
                name,
                method,
                compressedSize,
                uncompressedSize,
                localHeaderOffset
            });

            offset = nameStart + nameLength + extraLength + commentLength;
        }

        return entries;
    }

    findEndOfCentralDirectory() {
        const minOffset = Math.max(0, this.buffer.length - 0xffff - 22);
        for (let offset = this.buffer.length - 22; offset >= minOffset; offset--) {
            if (this.buffer.readUInt32LE(offset) === 0x06054b50) {
                return offset;
            }
        }
        throw new Error('End of central directory not found in EPUB');
    }

    readEntry(entry) {
        const offset = entry.localHeaderOffset;
        if (this.buffer.readUInt32LE(offset) !== 0x04034b50) {
            throw new Error(`Invalid ZIP local header for ${entry.name}`);
        }

        const nameLength = this.buffer.readUInt16LE(offset + 26);
        const extraLength = this.buffer.readUInt16LE(offset + 28);
        const dataStart = offset + 30 + nameLength + extraLength;
        const compressed = this.buffer.subarray(dataStart, dataStart + entry.compressedSize);

        if (entry.method === 0) {
            return compressed;
        }
        if (entry.method === 8) {
            const inflated = zlib.inflateRawSync(compressed);
            if (inflated.length !== entry.uncompressedSize) {
                throw new Error(`Unexpected uncompressed size for ${entry.name}: expected ${entry.uncompressedSize}, found ${inflated.length}`);
            }
            return inflated;
        }

        throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}`);
    }
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
