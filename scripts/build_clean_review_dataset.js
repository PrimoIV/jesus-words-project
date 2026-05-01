const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/jesus_verses.json');
const AUDIT_FILE = path.join(__dirname, '../dev/reports/jesus_dataset_audit.json');
const OUTPUT_FILE = path.join(__dirname, '../dev/reports/jesus_dataset_review.json');

async function buildReviewDataset() {
    console.log('Building review dataset...');
    
    let dataRaw, auditRaw;
    try {
        dataRaw = await fs.promises.readFile(DATA_FILE, 'utf8');
        auditRaw = await fs.promises.readFile(AUDIT_FILE, 'utf8');
    } catch (err) {
        console.error('Error reading input files:', err);
        return;
    }
    
    const data = JSON.parse(dataRaw);
    const audit = JSON.parse(auditRaw);
    
    // Convert arrays to sets for fast lookup
    const suspiciousSet = new Set(audit.suspicious_commentary || []);
    const nonJesusSet = new Set([
        ...(audit.spoken_by_others || []),
        ...(audit.narration_only || []),
        ...(audit.likely_non_jesus || [])
    ]);
    
    const reviewData = {};
    const summary = {
        must_fix: 0,
        review_non_jesus: 0,
        review_likely_context: 0,
        review_missing_translation: 0,
        likely_ok: 0
    };
    
    for (const [id, entry] of Object.entries(data)) {
        let status = 'likely_ok';
        let reason = '';
        
        const t = entry.translations || {};
        const hasNRSVUE = !!t.NRSVUE;
        const hasDBH = !!t.DBH;
        const hasLAMSA = !!t.LAMSA;
        const transCount = [hasNRSVUE, hasDBH, hasLAMSA].filter(Boolean).length;
        
        // Priority rules as specified:
        if (suspiciousSet.has(id)) {
            status = 'must_fix';
            reason = 'Contains suspicious commentary phrases';
        } else if (nonJesusSet.has(id)) {
            status = 'review_non_jesus';
            reason = 'Likely narration or spoken by someone else';
        } else if (transCount === 1 && hasNRSVUE) {
            status = 'review_likely_context';
            reason = 'Only NRSVUE exists';
        } else if (transCount >= 2 && transCount < 3) {
            status = 'review_missing_translation';
            reason = 'Missing one or more translations';
        }
        
        summary[status]++;
        
        reviewData[id] = {
            id: id,
            reference: `${entry.book} ${entry.chapter}:${entry.verse}`,
            status: status,
            reason: reason,
            translations: entry.translations
        };
    }
    
    const output = {
        summary: summary,
        verses: reviewData
    };
    
    const outputDir = path.dirname(OUTPUT_FILE);
    await fs.promises.mkdir(outputDir, { recursive: true });
    
    await fs.promises.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
    
    console.log(`Review dataset created at ${OUTPUT_FILE}`);
    console.log('Summary:', summary);
}

buildReviewDataset().catch(console.error);
