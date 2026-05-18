const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/jesus_verses_final.json');
const REPORT_FILE = path.join(__dirname, '../dev/reports/jesus_dataset_audit.json');

async function auditDataset() {
    console.log('Starting Jesus dataset audit...');
    
    let dataRaw;
    try {
        dataRaw = await fs.promises.readFile(DATA_FILE, 'utf8');
    } catch (err) {
        console.error('Error reading data file:', err);
        return;
    }
    
    const data = JSON.parse(dataRaw);
    
    const report = {
        total_entries: 0,
        only_one_translation: [],
        missing_translation: [],
        suspicious_commentary: [],
        spoken_by_others: [],
        narration_only: []
    };
    
    const suspiciousPhrases = [
        "Jesus is not saying",
        "traditionally depicted",
        "orientalist",
        "chapTer"
    ];
    
    const otherSpeakers = [
        "Peter", "Satan", "devil", "disciples", "Pharisees", 
        "scribes", "demons", "crowds", "woman", "centurion"
    ];
    
    for (const [verseId, entry] of Object.entries(data)) {
        report.total_entries++;
        const t = entry.translations || {};
        
        const hasNRSVUE = !!t.NRSVUE;
        const hasDBH = !!t.DBH;
        const hasLAMSA = !!t.LAMSA;
        
        const translationCount = [hasNRSVUE, hasDBH, hasLAMSA].filter(Boolean).length;
        
        if (translationCount === 1) {
            report.only_one_translation.push(verseId);
        }
        
        if (!hasNRSVUE || !hasDBH || !hasLAMSA) {
            report.missing_translation.push(verseId);
        }
        
        let hasSuspicious = false;
        let isSpokenByOthers = false;
        let isNarrationOnly = false;
        
        const textToCheck = t.NRSVUE || t.DBH || t.LAMSA || "";
        
        for (const text of Object.values(t)) {
            const lowerText = text.toLowerCase();
            if (suspiciousPhrases.some(phrase => lowerText.includes(phrase.toLowerCase()))) {
                hasSuspicious = true;
            }
        }
        
        if (textToCheck) {
            // Check for others speaking
            const otherSpeakersRegex = new RegExp(`\\b(${otherSpeakers.join('|')})\\s+(said|answered|asked|replied|told|saying|spoke|cried out|called out|came and said)\\b`, 'i');
            if (otherSpeakersRegex.test(textToCheck)) {
                isSpokenByOthers = true;
            }
            
            // Check for narration-only (no quotes and narrative structure)
            const hasQuotes = /["“”'‘]/.test(textToCheck);
            if (!hasQuotes) {
                const hasFirstPerson = /\b(I|me|my|mine|we|us|our)\b/i.test(textToCheck);
                if (!hasFirstPerson) {
                    isNarrationOnly = true;
                } else if (/^(when|then|and|after|from|now)\b/i.test(textToCheck) && !hasFirstPerson) {
                    isNarrationOnly = true;
                }
            }
        }
        
        if (hasSuspicious) report.suspicious_commentary.push(verseId);
        if (isSpokenByOthers) report.spoken_by_others.push(verseId);
        if (isNarrationOnly) report.narration_only.push(verseId);
    }
    
    // Ensure reports directory exists
    const reportDir = path.dirname(REPORT_FILE);
    await fs.promises.mkdir(reportDir, { recursive: true });
    
    const outputData = {
        summary: {
            total_entries: report.total_entries,
            only_one_translation: report.only_one_translation.length,
            missing_translation: report.missing_translation.length,
            suspicious_commentary: report.suspicious_commentary.length,
            spoken_by_others: report.spoken_by_others.length,
            narration_only: report.narration_only.length
        },
        ...report
    };
    
    await fs.promises.writeFile(REPORT_FILE, JSON.stringify(outputData, null, 2));
    
    console.log(`Audit complete! Checked ${report.total_entries} entries.`);
    console.log(`Report saved to: ${REPORT_FILE}`);
}

auditDataset().catch(console.error);
