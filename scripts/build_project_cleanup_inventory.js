const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const REPORTS_DIR = path.join(ROOT, 'dev/reports');
const DATA_DIR = path.join(ROOT, 'data');
const INVENTORY_JSON_FILE = path.join(ROOT, 'dev/reports/project_cleanup_inventory.json');
const INVENTORY_CSV_FILE = path.join(ROOT, 'dev/reports/project_cleanup_inventory.csv');
const DEPENDENCY_JSON_FILE = path.join(ROOT, 'dev/reports/project_dependency_map.json');
const DEPENDENCY_CSV_FILE = path.join(ROOT, 'dev/reports/project_dependency_map.csv');

const ROOT_ENV = {
    ROOT,
    __dirname,
    REPORT_DIR: REPORTS_DIR,
    REPORTS_DIR,
    DATA_DIR,
    SCRIPTS_DIR
};

const INVENTORY_COLUMNS = [
    'path',
    'type',
    'classification',
    'reason',
    'referencedByScripts',
    'readByScripts',
    'writtenByScripts',
    'importedByScripts',
    'sizeBytes',
    'lastModified'
];

const DEPENDENCY_COLUMNS = [
    'script',
    'filesRead',
    'filesWritten',
    'filesReferenced',
    'importsRequires',
    'packageImports',
    'modifiesJesusVersesFinal'
];

const MANUAL_REVIEW_PATTERN = /\b(?:reviewed|manual_review_sheet|override_review|review_v\d+|candidates_filled)\b/i;
const LATEST_APPLY_REPORT_PATTERN = /\b(?:lamsa_auto_safe_consolidation_(?:dry_run|apply_summary)|lamsa_held_apply|lamsa_speechtext_auto_apply_report|lamsa_source_replacement_apply_report|speech_manual_override_apply_report)\b/i;
const OLD_SUPERSEDED_REPORT_PATTERN = /\b(?:jesus_speech_contamination_audit_5_16_26|master_dataset_audit)\b/i;
const GENERATED_SNAPSHOT_PATTERN = /\b(?:jesus_verses_with_speech_candidates|jesus_verses_with_speech_candidates_reduced|jesus_verses_with_manual_speech_applied)\b/i;
const ACTIVE_DATA_FILES = new Set([
    'data/jesus_verses_final.json',
    'data/translation_verse_maps/lamsa_verse_map.json',
    'data/translation_verse_maps/dbh_verse_map.json',
    'data/translation_verse_maps/nrsvue_verse_map.json',
    'data/jesus_index_bsb_anchor.json',
    'data/context/jesus_discourse_blocks.json'
]);

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

function main() {
    const scriptFiles = listFiles(SCRIPTS_DIR, file => file.endsWith('.js'));
    const reportFiles = listFiles(REPORTS_DIR, file => file.endsWith('.json') || file.endsWith('.csv'));
    const dataFiles = listFiles(DATA_DIR, file => file.endsWith('.json') || file.endsWith('.csv'));
    const rootStructuredFiles = listFiles(ROOT, file => {
        const relative = relativeToRoot(file);
        return !relative.includes('/') && (file.endsWith('.json') || file.endsWith('.csv'));
    });
    const scannedFiles = uniquePaths([...scriptFiles, ...reportFiles, ...dataFiles, ...rootStructuredFiles]);

    const scriptDependencies = scriptFiles
        .map(analyzeScript)
        .sort((a, b) => a.script.localeCompare(b.script));
    const dependencyIndex = buildDependencyIndex(scriptDependencies);
    const inventoryEntries = scannedFiles
        .map(file => buildInventoryEntry(file, dependencyIndex))
        .sort(compareInventoryEntries);

    const inventoryReport = {
        generatedAt: new Date().toISOString(),
        inputs: {
            scripts: 'scripts/',
            reports: 'dev/reports/',
            data: 'data/',
            rootCsvJson: './*.csv, ./*.json'
        },
        outputs: {
            inventoryJson: relativeToRoot(INVENTORY_JSON_FILE),
            inventoryCsv: relativeToRoot(INVENTORY_CSV_FILE),
            dependencyJson: relativeToRoot(DEPENDENCY_JSON_FILE),
            dependencyCsv: relativeToRoot(DEPENDENCY_CSV_FILE)
        },
        summary: buildInventorySummary(inventoryEntries),
        entries: inventoryEntries
    };

    const dependencyReport = {
        generatedAt: new Date().toISOString(),
        summary: buildDependencySummary(scriptDependencies),
        scripts: scriptDependencies
    };

    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.writeFileSync(INVENTORY_JSON_FILE, `${JSON.stringify(inventoryReport, null, 2)}\n`, 'utf8');
    fs.writeFileSync(INVENTORY_CSV_FILE, `${toCsv(inventoryEntries, INVENTORY_COLUMNS)}\n`, 'utf8');
    fs.writeFileSync(DEPENDENCY_JSON_FILE, `${JSON.stringify(dependencyReport, null, 2)}\n`, 'utf8');
    fs.writeFileSync(DEPENDENCY_CSV_FILE, `${toCsv(scriptDependencies, DEPENDENCY_COLUMNS)}\n`, 'utf8');

    printSummary(inventoryReport.summary, dependencyReport.summary);
}

function analyzeScript(file) {
    const text = fs.readFileSync(file, 'utf8');
    const relativeScript = relativeToRoot(file);
    const constants = extractPathConstants(text);
    const imports = extractImports(text, file);
    const referencedPaths = extractReferencedPaths(text, constants);
    const filesRead = referencedPaths.filter(ref => isReadReference(text, ref)).map(ref => ref.relativePath);
    const filesWritten = referencedPaths.filter(ref => isWriteReference(text, ref)).map(ref => ref.relativePath);
    const filesReferenced = referencedPaths.map(ref => ref.relativePath);
    const localImports = imports.local.map(importPath => importPath.relativePath);
    const modifiesJesusVersesFinal = filesWritten.includes('data/jesus_verses_final.json');

    return {
        script: relativeScript,
        filesRead: unique(filesRead).sort(),
        filesWritten: unique(filesWritten).sort(),
        filesReferenced: unique(filesReferenced).sort(),
        importsRequires: unique(localImports).sort(),
        packageImports: unique(imports.packages).sort(),
        modifiesJesusVersesFinal
    };
}

function extractPathConstants(text) {
    const env = { ...ROOT_ENV };
    const assignments = [...text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*path\.join\(([^;]+?)\);/gs)]
        .map(match => ({ name: match[1], args: match[2] }));

    let changed = true;
    while (changed) {
        changed = false;
        for (const assignment of assignments) {
            if (env[assignment.name]) continue;
            const resolved = resolvePathJoin(assignment.args, env);
            if (resolved) {
                env[assignment.name] = resolved;
                changed = true;
            }
        }
    }

    return env;
}

function resolvePathJoin(argsText, env) {
    const args = parseArgs(argsText);
    const parts = [];

    for (const arg of args) {
        if (arg.type === 'identifier') {
            if (!env[arg.value]) return '';
            parts.push(env[arg.value]);
        } else {
            parts.push(arg.value);
        }
    }

    if (!parts.length) return '';
    return path.normalize(path.join(...parts));
}

function parseArgs(argsText) {
    const args = [];
    const regex = /(['"])((?:\\.|(?!\1).)*)\1|([A-Za-z_$][\w$]*)/g;
    let match;
    while ((match = regex.exec(argsText)) !== null) {
        if (match[1]) {
            args.push({ type: 'string', value: match[2].replace(/\\(['"\\])/g, '$1') });
        } else if (!['path', 'join'].includes(match[3])) {
            args.push({ type: 'identifier', value: match[3] });
        }
    }
    return args;
}

function extractImports(text, scriptFile) {
    const packages = [];
    const local = [];
    const importPatterns = [
        /\brequire\((['"])(.*?)\1\)/g,
        /\bimport\s+(?:[^'"]+\s+from\s+)?(['"])(.*?)\1/g
    ];

    for (const pattern of importPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const target = match[2];
            if (target.startsWith('.') || target.startsWith('/')) {
                const resolved = resolveLocalImport(scriptFile, target);
                local.push({
                    source: target,
                    relativePath: relativeToRoot(resolved)
                });
            } else {
                packages.push(target);
            }
        }
    }

    return { packages, local };
}

function resolveLocalImport(scriptFile, target) {
    const base = path.resolve(path.dirname(scriptFile), target);
    const candidates = [base, `${base}.js`, `${base}.json`];
    return candidates.find(candidate => fs.existsSync(candidate)) || base;
}

function extractReferencedPaths(text, constants) {
    const refs = [];
    const existingRelativeValues = new Map();
    for (const [name, value] of Object.entries(constants)) {
        if (!isProjectFileLike(value)) continue;
        const relativePath = relativeToRoot(value);
        refs.push({
            variable: name,
            fullPath: value,
            relativePath,
            exists: fs.existsSync(value)
        });
        existingRelativeValues.set(relativePath, true);
    }

    const directStrings = extractStringLiterals(text)
        .filter(value => isRelativeProjectPath(value))
        .map(value => {
            const fullPath = path.resolve(ROOT, value.replace(/\//g, path.sep));
            return {
                variable: '',
                fullPath,
                relativePath: relativeToRoot(fullPath),
                exists: fs.existsSync(fullPath)
            };
        });

    for (const directRef of directStrings) {
        if (!existingRelativeValues.has(directRef.relativePath)) refs.push(directRef);
    }

    return dedupeRefs(refs);
}

function isReadReference(text, ref) {
    if (!ref.variable) return false;
    const name = escapeRegex(ref.variable);
    return new RegExp(`(?:readJson|readJsonObjectWithDuplicateCheck|loadCsv|fs\\.readFileSync|fs\\.promises\\.readFile|JSON\\.parse\\s*\\(\\s*fs\\.readFileSync|fs\\.existsSync)\\s*\\(\\s*${name}\\b`).test(text)
        || new RegExp(`\\b${name}\\b[\\s\\S]{0,80}fs\\.existsSync`).test(text)
        || new RegExp(`fs\\.existsSync\\s*\\(\\s*${name}\\b`).test(text);
}

function isWriteReference(text, ref) {
    if (!ref.variable) return false;
    const name = escapeRegex(ref.variable);
    return new RegExp(`(?:fs\\.writeFileSync|fs\\.promises\\.writeFile|writeFileSync|writeFile)\\s*\\(\\s*${name}\\b`).test(text);
}

function buildDependencyIndex(scriptDependencies) {
    const index = new Map();
    const ensure = filePath => {
        if (!index.has(filePath)) {
            index.set(filePath, {
                referencedByScripts: new Set(),
                readByScripts: new Set(),
                writtenByScripts: new Set(),
                importedByScripts: new Set()
            });
        }
        return index.get(filePath);
    };

    for (const dependency of scriptDependencies) {
        dependency.filesReferenced.forEach(filePath => ensure(filePath).referencedByScripts.add(dependency.script));
        dependency.filesRead.forEach(filePath => ensure(filePath).readByScripts.add(dependency.script));
        dependency.filesWritten.forEach(filePath => ensure(filePath).writtenByScripts.add(dependency.script));
        dependency.importsRequires.forEach(filePath => ensure(filePath).importedByScripts.add(dependency.script));
    }

    return index;
}

function buildInventoryEntry(file, dependencyIndex) {
    const relativePath = relativeToRoot(file);
    const stats = fs.statSync(file);
    const deps = dependencyIndex.get(relativePath) || {
        referencedByScripts: new Set(),
        readByScripts: new Set(),
        writtenByScripts: new Set(),
        importedByScripts: new Set()
    };
    const dependencySnapshot = {
        referencedByScripts: [...deps.referencedByScripts].sort(),
        readByScripts: [...deps.readByScripts].sort(),
        writtenByScripts: [...deps.writtenByScripts].sort(),
        importedByScripts: [...deps.importedByScripts].sort()
    };
    const classification = classifyFile({
        file,
        relativePath,
        stats,
        deps: dependencySnapshot
    });

    return {
        path: relativePath,
        type: getFileType(relativePath),
        classification: classification.classification,
        reason: classification.reason,
        referencedByScripts: dependencySnapshot.referencedByScripts.join('; '),
        readByScripts: dependencySnapshot.readByScripts.join('; '),
        writtenByScripts: dependencySnapshot.writtenByScripts.join('; '),
        importedByScripts: dependencySnapshot.importedByScripts.join('; '),
        sizeBytes: stats.size,
        lastModified: stats.mtime.toISOString()
    };
}

function classifyFile({ relativePath, stats, deps }) {
    const basename = path.basename(relativePath);
    const lower = relativePath.toLowerCase();
    const referenced = deps.referencedByScripts.length > 0
        || deps.readByScripts.length > 0
        || deps.writtenByScripts.length > 0
        || deps.importedByScripts.length > 0;

    if (relativePath === 'data/jesus_verses_final.json') {
        return {
            classification: 'keep_active',
            reason: 'Primary production dataset; project rule forbids archive/delete classification.'
        };
    }
    if (stats.size === 0 && !MANUAL_REVIEW_PATTERN.test(basename) && !LATEST_APPLY_REPORT_PATTERN.test(basename)) {
        return {
            classification: 'delete_candidate',
            reason: 'Empty generated/non-review file; verify before deletion.'
        };
    }
    if (deps.importedByScripts.length > 0) {
        return {
            classification: 'keep_active',
            reason: `Imported by current script(s): ${deps.importedByScripts.join('; ')}.`
        };
    }
    if (ACTIVE_DATA_FILES.has(relativePath)) {
        return {
            classification: 'keep_active',
            reason: 'Active project data file or shared context source.'
        };
    }
    if (deps.readByScripts.length > 0) {
        return {
            classification: 'keep_active',
            reason: `Read by current script(s): ${deps.readByScripts.join('; ')}.`
        };
    }
    if (LATEST_APPLY_REPORT_PATTERN.test(basename)) {
        return {
            classification: 'keep_active',
            reason: 'Latest apply/dry-run report; project rule says latest apply reports must not be delete candidates.'
        };
    }
    if (MANUAL_REVIEW_PATTERN.test(basename)) {
        return {
            classification: referenced ? 'unknown_needs_human_review' : 'archive_candidate',
            reason: referenced
                ? 'Manual review artifact referenced by scripts; never classify manually reviewed files as delete.'
                : 'Manual review artifact is not referenced by scripts; archive only after human confirmation.'
        };
    }
    if (relativePath.startsWith('data/')) {
        if (lower.includes('backup')) {
            return {
                classification: referenced ? 'unknown_needs_human_review' : 'archive_candidate',
                reason: referenced
                    ? 'Data backup is referenced by current scripts; human review needed before archiving.'
                    : 'Data backup/snapshot is not referenced by current scripts; archive candidate, not delete.'
            };
        }
        return {
            classification: referenced ? 'keep_active' : 'unknown_needs_human_review',
            reason: referenced
                ? 'Data file is referenced by current scripts.'
                : 'Data file is not referenced by scripts but lives under data/; human review needed before archive/delete.'
        };
    }
    if (relativePath.startsWith('scripts/')) {
        if (deps.writtenByScripts.length > 0) {
            return {
                classification: 'unknown_needs_human_review',
                reason: 'Script appears as a write target, which is unusual; human review needed.'
            };
        }
        if (deps.importedByScripts.length > 0 || basename === 'build_project_cleanup_inventory.js') {
            return {
                classification: 'keep_active',
                reason: basename === 'build_project_cleanup_inventory.js'
                    ? 'Current cleanup inventory generator.'
                    : 'Script is imported by another current script.'
            };
        }
        if (/^(?:apply_|audit_|build_|check_|verify_|extract_|normalize_|diff_|generate_|reduce_|create_|fill_|learn_)/.test(basename)) {
            return {
                classification: 'unknown_needs_human_review',
                reason: 'Standalone workflow script; not imported, so human review should decide active vs archive.'
            };
        }
        return {
            classification: 'unknown_needs_human_review',
            reason: 'Script role is not clear from static dependency scan.'
        };
    }
    if (referenced) {
        return {
            classification: deps.writtenByScripts.length > 0 && deps.readByScripts.length === 0
                ? 'unknown_needs_human_review'
                : 'keep_active',
            reason: deps.writtenByScripts.length > 0 && deps.readByScripts.length === 0
                ? `Generated by current script(s): ${deps.writtenByScripts.join('; ')}; human review needed before archiving.`
                : `Referenced by current script(s): ${deps.referencedByScripts.join('; ')}.`
        };
    }
    if (OLD_SUPERSEDED_REPORT_PATTERN.test(basename)) {
        return {
            classification: 'archive_candidate',
            reason: 'Generated report appears superseded by newer report naming and is not referenced by current scripts.'
        };
    }
    if (GENERATED_SNAPSHOT_PATTERN.test(basename)) {
        return {
            classification: 'archive_candidate',
            reason: 'Generated intermediate snapshot is not referenced by current scripts; archive candidate.'
        };
    }
    if (relativePath.startsWith('dev/reports/')) {
        return {
            classification: 'archive_candidate',
            reason: 'Generated report is not referenced by current scripts; prefer archive over delete.'
        };
    }
    return {
        classification: 'unknown_needs_human_review',
        reason: 'File role is not clear from static scan.'
    };
}

function getFileType(relativePath) {
    if (relativePath.startsWith('scripts/')) return 'script';
    if (relativePath.startsWith('dev/reports/')) return 'report';
    if (relativePath.startsWith('data/')) return 'data';
    if (!relativePath.includes('/')) return 'root_structured_file';
    return 'other';
}

function isProjectFileLike(file) {
    const relative = relativeToRoot(file);
    return isRelativeProjectPath(relative);
}

function isRelativeProjectPath(value) {
    const normalized = String(value || '').replace(/\\/g, '/');
    return /^(?:data|dev\/reports|dev\/backups|dev|docs|scripts|js)\//.test(normalized)
        && /\.(?:json|csv|js|epub)$/i.test(normalized);
}

function extractStringLiterals(text) {
    const values = [];
    const regex = /(['"])((?:\\.|(?!\1).)*)\1/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        values.push(match[2].replace(/\\(['"\\])/g, '$1'));
    }
    return values;
}

function listFiles(dir, predicate) {
    if (!fs.existsSync(dir)) return [];
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (dir === ROOT) continue;
            files.push(...listFiles(fullPath, predicate));
        } else if (entry.isFile() && predicate(fullPath)) {
            files.push(fullPath);
        }
    }
    return files;
}

function buildInventorySummary(entries) {
    return {
        totalFilesScanned: entries.length,
        keepActiveCount: entries.filter(entry => entry.classification === 'keep_active').length,
        archiveCandidateCount: entries.filter(entry => entry.classification === 'archive_candidate').length,
        deleteCandidateCount: entries.filter(entry => entry.classification === 'delete_candidate').length,
        unknownNeedsHumanReviewCount: entries.filter(entry => entry.classification === 'unknown_needs_human_review').length,
        byType: countBy(entries, entry => entry.type),
        byClassification: countBy(entries, entry => entry.classification)
    };
}

function buildDependencySummary(dependencies) {
    return {
        scriptCount: dependencies.length,
        modifiesJesusVersesFinalCount: dependencies.filter(dep => dep.modifiesJesusVersesFinal).length,
        scriptsModifyingJesusVersesFinal: dependencies
            .filter(dep => dep.modifiesJesusVersesFinal)
            .map(dep => dep.script),
        scriptsWithNoFileReferences: dependencies
            .filter(dep => dep.filesReferenced.length === 0 && dep.importsRequires.length === 0)
            .map(dep => dep.script)
    };
}

function countBy(items, getKey) {
    return items.reduce((counts, item) => {
        const key = getKey(item);
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});
}

function toCsv(rows, columns) {
    const csvRows = [columns];
    for (const row of rows) {
        csvRows.push(columns.map(column => {
            const value = row[column];
            return Array.isArray(value) ? value.join('; ') : value;
        }));
    }
    return csvRows.map(row => row.map(csvValue).join(',')).join('\r\n');
}

function csvValue(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function dedupeRefs(refs) {
    const seen = new Set();
    return refs.filter(ref => {
        const key = `${ref.variable}:${ref.relativePath}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function uniquePaths(files) {
    return [...new Set(files.map(file => path.normalize(file)))];
}

function compareInventoryEntries(a, b) {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.path.localeCompare(b.path);
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function relativeToRoot(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function printSummary(inventorySummary, dependencySummary) {
    console.log('Project cleanup inventory complete.');
    console.log(`Files scanned: ${inventorySummary.totalFilesScanned}`);
    console.log(`keep_active: ${inventorySummary.keepActiveCount}`);
    console.log(`archive_candidate: ${inventorySummary.archiveCandidateCount}`);
    console.log(`delete_candidate: ${inventorySummary.deleteCandidateCount}`);
    console.log(`unknown_needs_human_review: ${inventorySummary.unknownNeedsHumanReviewCount}`);
    console.log(`Scripts mapped: ${dependencySummary.scriptCount}`);
    console.log(`Scripts modifying data/jesus_verses_final.json: ${dependencySummary.modifiesJesusVersesFinalCount}`);
    console.log(`Inventory JSON: ${relativeToRoot(INVENTORY_JSON_FILE)}`);
    console.log(`Inventory CSV: ${relativeToRoot(INVENTORY_CSV_FILE)}`);
    console.log(`Dependency JSON: ${relativeToRoot(DEPENDENCY_JSON_FILE)}`);
    console.log(`Dependency CSV: ${relativeToRoot(DEPENDENCY_CSV_FILE)}`);
}
