const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATASET_FILE = path.join(ROOT, 'data/jesus_verses_final.json');
const LAMSA_MAP_FILE = path.join(ROOT, 'data/translation_verse_maps/lamsa_verse_map.json');
const NORMALIZED_EPUB_FILE = path.join(ROOT, 'data/translation_verse_maps/lamsa_epub_verse_map_normalized.json');
const PREVIEW_FILE = path.join(ROOT, 'dev/reports/lamsa_replacement_preview.json');
const REPORT_FILE = path.join(ROOT, 'dev/reports/lamsa_source_replacement_apply_report.json');
const BACKUP_DIR = path.join(ROOT, 'dev/backups');
const DATASET_BACKUP_FILE = path.join(BACKUP_DIR, 'jesus_verses_final.before_lamsa_epub_replacement.json');
const LAMSA_MAP_BACKUP_FILE = path.join(BACKUP_DIR, 'lamsa_verse_map.before_lamsa_epub_replacement.json');

const EXPECTED_PRODUCTION_LAMSA_COUNT = 2007;
const EXPECTED_CHANGED_COUNT = 305;
const SPECIAL_CHECK_IDS = ['MAT_27_46', 'MRK_15_34', 'MAT_8_3', 'MRK_4_40', 'MRK_4_41'];

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const loaded = loadInputs();
    const preflight = validateBeforeWrite(loaded);

    if (preflight.errors.length > 0) {
        writeReport(buildReport({
            loaded,
            phase: 'prewrite_validation',
            preflight,
            postflight: null,
            changedVerseIds: [],
            unchangedVerseIds: [],
            mapChangedVerseIds: [],
            backupsCreated: false,
            validationPassed: false
        }));
        printFailed('prewrite validation', preflight.errors);
        process.exit(1);
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(DATASET_BACKUP_FILE, loaded.dataset.raw, 'utf8');
    fs.writeFileSync(LAMSA_MAP_BACKUP_FILE, loaded.oldMap.raw, 'utf8');

    const applyResult = applyReplacement(loaded);

    fs.writeFileSync(DATASET_FILE, `${JSON.stringify(applyResult.nextDataset, null, 2)}\n`, 'utf8');
    fs.writeFileSync(LAMSA_MAP_FILE, `${JSON.stringify(applyResult.nextLamsaMap, null, 2)}\n`, 'utf8');

    const postflight = validateAfterWrite(loaded, applyResult);
    const validationPassed = postflight.errors.length === 0;
    const report = buildReport({
        loaded,
        phase: 'postwrite_validation',
        preflight,
        postflight,
        changedVerseIds: applyResult.changedVerseIds,
        unchangedVerseIds: applyResult.unchangedVerseIds,
        mapChangedVerseIds: applyResult.mapChangedVerseIds,
        backupsCreated: true,
        validationPassed
    });

    writeReport(report);

    if (!validationPassed) {
        printFailed('postwrite validation', postflight.errors);
        process.exit(1);
    }

    printSummary(report);
}

function loadInputs() {
    return {
        dataset: readJsonObjectWithDuplicateCheck(DATASET_FILE),
        oldMap: readJsonObjectWithDuplicateCheck(LAMSA_MAP_FILE),
        normalizedEpub: readJsonObjectWithDuplicateCheck(NORMALIZED_EPUB_FILE),
        preview: readJsonObjectWithDuplicateCheck(PREVIEW_FILE)
    };
}

function validateBeforeWrite(loaded) {
    const errors = [];
    const dataset = loaded.dataset.data;
    const oldMap = loaded.oldMap.data;
    const normalizedEpub = loaded.normalizedEpub.data;
    const preview = loaded.preview.data;
    const productionIds = getProductionLamsaIds(dataset);
    const previewRowsById = new Map((preview.rows || []).map(row => [row.verseId, row]));

    addDuplicateErrors(errors, DATASET_FILE, loaded.dataset.duplicateKeys);
    addDuplicateErrors(errors, LAMSA_MAP_FILE, loaded.oldMap.duplicateKeys);
    addDuplicateErrors(errors, NORMALIZED_EPUB_FILE, loaded.normalizedEpub.duplicateKeys);
    addDuplicateErrors(errors, PREVIEW_FILE, loaded.preview.duplicateKeys);

    if (preview.summary?.validationPassed !== true) {
        errors.push('Replacement preview validationPassed is not true');
    }
    if (preview.summary?.missingInEpub !== 0) {
        errors.push(`Replacement preview missingInEpub is ${preview.summary?.missingInEpub}, expected 0`);
    }
    if (preview.summary?.duplicateVerseIds !== 0) {
        errors.push(`Replacement preview duplicateVerseIds is ${preview.summary?.duplicateVerseIds}, expected 0`);
    }
    if (preview.summary?.totalProductionLamsaVersesChecked !== EXPECTED_PRODUCTION_LAMSA_COUNT) {
        errors.push(`Replacement preview checked ${preview.summary?.totalProductionLamsaVersesChecked} production LAMSA verses, expected ${EXPECTED_PRODUCTION_LAMSA_COUNT}`);
    }
    if (productionIds.length !== EXPECTED_PRODUCTION_LAMSA_COUNT) {
        errors.push(`Current production dataset has ${productionIds.length} LAMSA verses, expected ${EXPECTED_PRODUCTION_LAMSA_COUNT}`);
    }
    if (/\bfew this\b/i.test(normalizedEpub.MRK_15_34 || '')) {
        errors.push('Normalized EPUB MRK_15_34 contains forbidden source corruption "few this"');
    }
    if (fs.existsSync(DATASET_BACKUP_FILE)) {
        errors.push(`Backup already exists: ${relativeToRoot(DATASET_BACKUP_FILE)}`);
    }
    if (fs.existsSync(LAMSA_MAP_BACKUP_FILE)) {
        errors.push(`Backup already exists: ${relativeToRoot(LAMSA_MAP_BACKUP_FILE)}`);
    }

    const oldMapIds = Object.keys(oldMap).sort(compareVerseIds);
    const oldMapIdSet = new Set(oldMapIds);
    const productionIdSet = new Set(productionIds);
    const oldMapMissingProductionIds = productionIds.filter(id => !oldMapIdSet.has(id));
    const oldMapExtraIds = oldMapIds.filter(id => !productionIdSet.has(id));

    if (oldMapMissingProductionIds.length > 0) {
        errors.push(`Old LAMSA map is missing ${oldMapMissingProductionIds.length} production verse ID(s): ${oldMapMissingProductionIds.slice(0, 20).join(', ')}`);
    }
    if (oldMapExtraIds.length > 0) {
        errors.push(`Old LAMSA map contains ${oldMapExtraIds.length} non-production verse ID(s): ${oldMapExtraIds.slice(0, 20).join(', ')}`);
    }

    const missingInEpub = [];
    const missingPreviewRows = [];
    const stalePreviewRows = [];
    const previewNewMismatches = [];
    const expectedChangedVerseIds = [];

    for (const verseId of productionIds) {
        const currentRaw = dataset[verseId].translations.LAMSA;
        const replacement = normalizedEpub[verseId];
        const previewRow = previewRowsById.get(verseId);

        if (typeof replacement !== 'string') {
            missingInEpub.push(verseId);
            continue;
        }
        if (currentRaw !== replacement) {
            expectedChangedVerseIds.push(verseId);
        }
        if (!previewRow) {
            missingPreviewRows.push(verseId);
            continue;
        }
        if (previewRow.oldLamsaRaw !== currentRaw) {
            stalePreviewRows.push(verseId);
        }
        if (previewRow.newLamsaRaw !== replacement) {
            previewNewMismatches.push(verseId);
        }
    }

    if (missingInEpub.length > 0) {
        errors.push(`${missingInEpub.length} production LAMSA verse(s) lack a normalized EPUB replacement: ${missingInEpub.slice(0, 20).join(', ')}`);
    }
    if (missingPreviewRows.length > 0) {
        errors.push(`${missingPreviewRows.length} production LAMSA verse(s) are missing from the replacement preview rows: ${missingPreviewRows.slice(0, 20).join(', ')}`);
    }
    if (stalePreviewRows.length > 0) {
        errors.push(`${stalePreviewRows.length} replacement preview row(s) do not match current production LAMSA text: ${stalePreviewRows.slice(0, 20).join(', ')}`);
    }
    if (previewNewMismatches.length > 0) {
        errors.push(`${previewNewMismatches.length} replacement preview row(s) do not match the normalized EPUB map: ${previewNewMismatches.slice(0, 20).join(', ')}`);
    }
    if (expectedChangedVerseIds.length !== EXPECTED_CHANGED_COUNT) {
        errors.push(`Expected replacement would change ${expectedChangedVerseIds.length} production LAMSA values, expected ${EXPECTED_CHANGED_COUNT}`);
    }

    return {
        errors,
        productionIds,
        expectedChangedVerseIds,
        oldMapMissingProductionIds,
        oldMapExtraIds,
        missingInEpub,
        missingPreviewRows,
        stalePreviewRows,
        previewNewMismatches
    };
}

function applyReplacement(loaded) {
    const dataset = loaded.dataset.data;
    const oldMap = loaded.oldMap.data;
    const normalizedEpub = loaded.normalizedEpub.data;
    const productionIds = getProductionLamsaIds(dataset);
    const nextDataset = JSON.parse(JSON.stringify(dataset));
    const nextLamsaMap = JSON.parse(JSON.stringify(oldMap));
    const changedVerseIds = [];
    const unchangedVerseIds = [];
    const mapChangedVerseIds = [];

    for (const verseId of productionIds) {
        const replacement = normalizedEpub[verseId];
        const oldDatasetValue = dataset[verseId].translations.LAMSA;
        const oldMapValue = oldMap[verseId];

        nextDataset[verseId].translations.LAMSA = replacement;
        nextLamsaMap[verseId] = replacement;

        if (oldDatasetValue === replacement) {
            unchangedVerseIds.push(verseId);
        } else {
            changedVerseIds.push(verseId);
        }
        if (oldMapValue !== replacement) {
            mapChangedVerseIds.push(verseId);
        }
    }

    return {
        nextDataset,
        nextLamsaMap,
        changedVerseIds,
        unchangedVerseIds,
        mapChangedVerseIds
    };
}

function validateAfterWrite(loaded, applyResult) {
    const errors = [];
    const afterDataset = readJsonObjectWithDuplicateCheck(DATASET_FILE).data;
    const afterMap = readJsonObjectWithDuplicateCheck(LAMSA_MAP_FILE).data;
    const beforeDataset = loaded.dataset.data;
    const beforeMap = loaded.oldMap.data;
    const normalizedEpub = loaded.normalizedEpub.data;
    const productionIds = getProductionLamsaIds(beforeDataset);
    const hadMrk441Before = Object.prototype.hasOwnProperty.call(beforeDataset, 'MRK_4_41');

    if (JSON.stringify(afterDataset).match(/\bfew this\b/i)) {
        errors.push('data/jesus_verses_final.json still contains "few this"');
    }
    if (afterDataset.MRK_15_34?.translations?.LAMSA !== normalizedEpub.MRK_15_34) {
        errors.push('MRK_15_34 translations.LAMSA does not equal the normalized EPUB text');
    }
    if (!afterDataset.MAT_8_3?.translations?.LAMSA?.includes('I do wish it, be cleansed.')) {
        errors.push('MAT_8_3 translations.LAMSA does not include "I do wish it, be cleansed."');
    }
    if (!afterDataset.MRK_4_40?.translations?.LAMSA?.endsWith('why do you have no faith?')) {
        errors.push('MRK_4_40 translations.LAMSA does not end at "why do you have no faith?"');
    }
    if (!hadMrk441Before && Object.prototype.hasOwnProperty.call(afterDataset, 'MRK_4_41')) {
        errors.push('MRK_4_41 was added to the production dataset');
    }
    if (applyResult.changedVerseIds.length !== EXPECTED_CHANGED_COUNT) {
        errors.push(`Changed ${applyResult.changedVerseIds.length} production LAMSA raw translation values, expected ${EXPECTED_CHANGED_COUNT}`);
    }
    if (!sameJson(stripProductionLamsa(beforeDataset), stripProductionLamsa(afterDataset))) {
        errors.push('One or more non-LAMSA production dataset fields changed');
    }
    if (!sameJson(getTranslationSnapshot(beforeDataset, 'DBH'), getTranslationSnapshot(afterDataset, 'DBH'))) {
        errors.push('DBH values changed');
    }
    if (!sameJson(getTranslationSnapshot(beforeDataset, 'NRSVUE'), getTranslationSnapshot(afterDataset, 'NRSVUE'))) {
        errors.push('NRSVUE values changed');
    }
    if (!sameJson(getTopLevelFieldSnapshot(beforeDataset, 'speechText'), getTopLevelFieldSnapshot(afterDataset, 'speechText'))) {
        errors.push('speechText fields changed');
    }
    if (!sameJson(getTopLevelFieldSnapshot(beforeDataset, 'speechStatus'), getTopLevelFieldSnapshot(afterDataset, 'speechStatus'))) {
        errors.push('speechStatus fields changed');
    }

    const afterMapIds = Object.keys(afterMap).sort(compareVerseIds);
    if (afterMapIds.length !== EXPECTED_PRODUCTION_LAMSA_COUNT) {
        errors.push(`Production LAMSA map has ${afterMapIds.length} verse IDs after apply, expected ${EXPECTED_PRODUCTION_LAMSA_COUNT}`);
    }
    if (Object.keys(loaded.normalizedEpub.data).length === afterMapIds.length && afterMapIds.length !== EXPECTED_PRODUCTION_LAMSA_COUNT) {
        errors.push('Production LAMSA map appears to have been expanded to the full EPUB map');
    }
    if (!sameJson(Object.keys(beforeMap).sort(compareVerseIds), afterMapIds)) {
        errors.push('Production LAMSA map verse ID set changed');
    }

    const datasetReplacementMismatches = productionIds.filter(verseId => afterDataset[verseId]?.translations?.LAMSA !== normalizedEpub[verseId]);
    const mapReplacementMismatches = productionIds.filter(verseId => afterMap[verseId] !== normalizedEpub[verseId]);
    if (datasetReplacementMismatches.length > 0) {
        errors.push(`${datasetReplacementMismatches.length} dataset LAMSA values do not match normalized EPUB replacements`);
    }
    if (mapReplacementMismatches.length > 0) {
        errors.push(`${mapReplacementMismatches.length} production LAMSA map values do not match normalized EPUB replacements`);
    }

    return {
        errors,
        hadMrk441Before,
        hasMrk441After: Object.prototype.hasOwnProperty.call(afterDataset, 'MRK_4_41'),
        datasetReplacementMismatches,
        mapReplacementMismatches
    };
}

function buildReport({
    loaded,
    phase,
    preflight,
    postflight,
    changedVerseIds,
    unchangedVerseIds,
    mapChangedVerseIds,
    backupsCreated,
    validationPassed
}) {
    const preview = loaded.preview.data;
    const productionIds = preflight.productionIds || getProductionLamsaIds(loaded.dataset.data);
    const previewRowsById = new Map((preview.rows || []).map(row => [row.verseId, row]));
    const sourceCorruptionFixedIds = getPreviewRowsWithNote(preview, 'source_corruption_fixed').map(row => row.verseId);
    const bracketNoteVerseIds = getPreviewRowsWithNote(preview, 'bracket_note_present').map(row => row.verseId);
    const narrationGlossRiskVerseIds = getPreviewRowsWithNote(preview, 'narration_or_gloss_risk').map(row => row.verseId);
    const oldMapDatasetMismatchIds = getPreviewRowsWithNote(preview, 'old_map_dataset_mismatch').map(row => row.verseId);

    return {
        generatedAt: new Date().toISOString(),
        phase,
        inputs: {
            dataset: relativeToRoot(DATASET_FILE),
            lamsaMap: relativeToRoot(LAMSA_MAP_FILE),
            normalizedEpubMap: relativeToRoot(NORMALIZED_EPUB_FILE),
            replacementPreview: relativeToRoot(PREVIEW_FILE)
        },
        outputs: {
            dataset: relativeToRoot(DATASET_FILE),
            lamsaMap: relativeToRoot(LAMSA_MAP_FILE),
            report: relativeToRoot(REPORT_FILE)
        },
        backupFilePaths: {
            jesusVersesFinal: relativeToRoot(DATASET_BACKUP_FILE),
            lamsaVerseMap: relativeToRoot(LAMSA_MAP_BACKUP_FILE)
        },
        backupsCreated,
        changedVerseCount: changedVerseIds.length,
        unchangedVerseCount: unchangedVerseIds.length,
        mapChangedVerseCount: mapChangedVerseIds.length,
        sourceCorruptionsFixed: sourceCorruptionFixedIds.length,
        sourceCorruptionFixedIds,
        bracketNoteVerses: bracketNoteVerseIds.length,
        bracketNoteVerseIds,
        narrationGlossRiskVerses: narrationGlossRiskVerseIds.length,
        narrationGlossRiskVerseIds,
        oldMapDatasetMismatches: {
            count: oldMapDatasetMismatchIds.length,
            verseIds: oldMapDatasetMismatchIds
        },
        productionLamsaVerseCount: productionIds.length,
        expectedChangedVerseCount: EXPECTED_CHANGED_COUNT,
        specialChecks: buildSpecialChecks(loaded, previewRowsById),
        validation: {
            prewriteErrors: preflight.errors,
            postwriteErrors: postflight ? postflight.errors : [],
            validationPassed
        },
        validationPassed
    };
}

function buildSpecialChecks(loaded, previewRowsById) {
    const beforeDataset = loaded.dataset.data;
    const beforeMap = loaded.oldMap.data;
    const normalizedEpub = loaded.normalizedEpub.data;
    const afterDataset = fs.existsSync(DATASET_FILE) ? JSON.parse(fs.readFileSync(DATASET_FILE, 'utf8')) : {};
    const afterMap = fs.existsSync(LAMSA_MAP_FILE) ? JSON.parse(fs.readFileSync(LAMSA_MAP_FILE, 'utf8')) : {};

    return Object.fromEntries(SPECIAL_CHECK_IDS.map(verseId => {
        const beforeDatasetValue = beforeDataset[verseId]?.translations?.LAMSA ?? null;
        const afterDatasetValue = afterDataset[verseId]?.translations?.LAMSA ?? null;
        const beforeMapValue = Object.prototype.hasOwnProperty.call(beforeMap, verseId) ? beforeMap[verseId] : null;
        const afterMapValue = Object.prototype.hasOwnProperty.call(afterMap, verseId) ? afterMap[verseId] : null;
        const previewRow = previewRowsById.get(verseId) || null;

        return [verseId, {
            existedInProductionDatasetBefore: Object.prototype.hasOwnProperty.call(beforeDataset, verseId),
            existsInProductionDatasetAfter: Object.prototype.hasOwnProperty.call(afterDataset, verseId),
            existedInLamsaMapBefore: Object.prototype.hasOwnProperty.call(beforeMap, verseId),
            existsInLamsaMapAfter: Object.prototype.hasOwnProperty.call(afterMap, verseId),
            beforeDatasetLamsa: beforeDatasetValue,
            afterDatasetLamsa: afterDatasetValue,
            beforeLamsaMap: beforeMapValue,
            afterLamsaMap: afterMapValue,
            normalizedEpubLamsa: normalizedEpub[verseId] || null,
            previewCategory: previewRow?.category || null,
            previewNotes: previewRow?.notes || [],
            changedInDataset: beforeDatasetValue !== afterDatasetValue,
            changedInLamsaMap: beforeMapValue !== afterMapValue
        }];
    }));
}

function writeReport(report) {
    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function getProductionLamsaIds(dataset) {
    return Object.entries(dataset)
        .filter(([, record]) => typeof record?.translations?.LAMSA === 'string')
        .map(([verseId]) => verseId)
        .sort(compareVerseIds);
}

function getPreviewRowsWithNote(preview, note) {
    return (preview.rows || [])
        .filter(row => Array.isArray(row.notes) && row.notes.includes(note))
        .sort((a, b) => compareVerseIds(a.verseId, b.verseId));
}

function addDuplicateErrors(errors, file, duplicateKeys) {
    if (duplicateKeys.length > 0) {
        errors.push(`Duplicate verse IDs in ${relativeToRoot(file)}: ${duplicateKeys.join(', ')}`);
    }
}

function stripProductionLamsa(dataset) {
    const clone = JSON.parse(JSON.stringify(dataset));
    for (const record of Object.values(clone)) {
        if (record?.translations && Object.prototype.hasOwnProperty.call(record.translations, 'LAMSA')) {
            delete record.translations.LAMSA;
        }
    }
    return clone;
}

function getTranslationSnapshot(dataset, translationKey) {
    return Object.fromEntries(Object.entries(dataset).map(([verseId, record]) => [
        verseId,
        record?.translations?.[translationKey] ?? null
    ]));
}

function getTopLevelFieldSnapshot(dataset, field) {
    return Object.fromEntries(Object.entries(dataset).map(([verseId, record]) => [
        verseId,
        record && Object.prototype.hasOwnProperty.call(record, field) ? record[field] : null
    ]));
}

function readJsonObjectWithDuplicateCheck(file) {
    const raw = fs.readFileSync(file, 'utf8');
    const keys = scanRootObjectKeys(raw);
    const duplicateKeys = getDuplicateItems(keys);
    const data = JSON.parse(raw);

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(`${relativeToRoot(file)} must contain a JSON object`);
    }

    return { raw, data, duplicateKeys };
}

function getDuplicateItems(items) {
    const seen = new Set();
    const duplicates = new Set();
    for (const item of items) {
        if (seen.has(item)) {
            duplicates.add(item);
        } else {
            seen.add(item);
        }
    }
    return [...duplicates].sort(compareVerseIds);
}

function scanRootObjectKeys(json) {
    let index = skipWhitespace(json, 0);
    if (json[index] !== '{') return [];
    index++;

    const keys = [];
    while (index < json.length) {
        index = skipWhitespace(json, index);
        if (json[index] === '}') break;
        if (json[index] !== '"') {
            throw new Error(`Expected JSON object key at offset ${index}`);
        }

        const key = readJsonString(json, index);
        keys.push(key.value);
        index = skipWhitespace(json, key.end);

        if (json[index] !== ':') {
            throw new Error(`Expected colon after JSON object key at offset ${index}`);
        }

        index = skipJsonValue(json, index + 1);
        index = skipWhitespace(json, index);

        if (json[index] === ',') {
            index++;
            continue;
        }
        if (json[index] === '}') break;

        throw new Error(`Expected comma or end of JSON object at offset ${index}`);
    }

    return keys;
}

function skipJsonValue(json, index) {
    index = skipWhitespace(json, index);

    if (json[index] === '"') {
        return readJsonString(json, index).end;
    }

    if (json[index] === '{' || json[index] === '[') {
        const stack = [json[index]];
        index++;

        while (index < json.length && stack.length > 0) {
            const char = json[index];
            if (char === '"') {
                index = readJsonString(json, index).end;
                continue;
            }
            if (char === '{' || char === '[') {
                stack.push(char);
            } else if (char === '}' || char === ']') {
                const open = stack.pop();
                if ((open === '{' && char !== '}') || (open === '[' && char !== ']')) {
                    throw new Error(`Mismatched JSON delimiter at offset ${index}`);
                }
            }
            index++;
        }

        return index;
    }

    while (index < json.length && !/[,\]}]/.test(json[index])) {
        index++;
    }

    return index;
}

function readJsonString(json, index) {
    let cursor = index + 1;
    while (cursor < json.length) {
        if (json[cursor] === '\\') {
            cursor += 2;
            continue;
        }
        if (json[cursor] === '"') {
            return {
                value: JSON.parse(json.slice(index, cursor + 1)),
                end: cursor + 1
            };
        }
        cursor++;
    }

    throw new Error(`Unterminated JSON string at offset ${index}`);
}

function skipWhitespace(text, index) {
    while (index < text.length && /\s/.test(text[index])) {
        index++;
    }
    return index;
}

function sameJson(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function compareVerseIds(a, b) {
    const parsedA = parseVerseId(a);
    const parsedB = parseVerseId(b);
    if (parsedA && parsedB) {
        return parsedA.book.localeCompare(parsedB.book)
            || parsedA.chapter - parsedB.chapter
            || parsedA.verse - parsedB.verse;
    }
    if (parsedA) return -1;
    if (parsedB) return 1;
    return a.localeCompare(b);
}

function parseVerseId(id) {
    const match = id.match(/^([A-Z]+)_(\d+)_(\d+)$/);
    return match
        ? { book: match[1], chapter: Number(match[2]), verse: Number(match[3]) }
        : null;
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function printFailed(phase, errors) {
    console.error(`LAMSA source replacement failed during ${phase}:`);
    errors.forEach(error => console.error(`- ${error}`));
    console.error(`Report saved to ${relativeToRoot(REPORT_FILE)}`);
}

function printSummary(report) {
    console.log('LAMSA source replacement applied.');
    console.log(`Changed production LAMSA values: ${report.changedVerseCount}`);
    console.log(`Unchanged production LAMSA values: ${report.unchangedVerseCount}`);
    console.log(`Source corruptions fixed: ${report.sourceCorruptionsFixed}`);
    console.log(`Bracket-note verses: ${report.bracketNoteVerses}`);
    console.log(`Narration/gloss risk verses: ${report.narrationGlossRiskVerses}`);
    console.log(`Old map/dataset mismatches carried forward: ${report.oldMapDatasetMismatches.count}`);
    console.log(`Backups saved to ${report.backupFilePaths.jesusVersesFinal} and ${report.backupFilePaths.lamsaVerseMap}`);
    console.log(`Report saved to ${relativeToRoot(REPORT_FILE)}`);
}
