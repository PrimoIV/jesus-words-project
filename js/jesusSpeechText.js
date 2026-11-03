let JESUS_SPEECH_OVERRIDES = {};

export async function loadJesusSpeechOverrides(path = 'dev/jesus_speech_overrides.json') {
    if (typeof fetch !== 'function') return {};

    try {
        const response = await fetch(path);
        if (!response.ok) return {};
        const overrides = await response.json();
        setJesusSpeechOverrides(overrides);
        return overrides;
    } catch {
        return {};
    }
}

export function setJesusSpeechOverrides(overrides = {}) {
    JESUS_SPEECH_OVERRIDES = overrides && typeof overrides === 'object' ? overrides : {};
}

export function getDisplayJesusText(verseId, verse, translationName) {
    const override = JESUS_SPEECH_OVERRIDES?.[verseId]?.[translationName];
    if (typeof override === 'string' && override.trim()) return override;

    const speechText = verse?.speechText?.[translationName];
    if (typeof speechText === 'string' && speechText.trim()) return speechText;

    return verse?.translations?.[translationName] || '';
}
