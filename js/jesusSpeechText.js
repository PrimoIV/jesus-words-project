let JESUS_SPEECH_OVERRIDES = {};

export async function loadJesusSpeechOverrides(path = 'dev/jesus_speech_overrides.json') {
    if (typeof fetch !== 'function') return {};

    try {
        const response = await fetch(path);
        if (!response.ok) return {};
        const overrides = await response.json();
        setJesusSpeechOverrides(overrides);
        return overrides;
    } catch (error) {
        console.info('Jesus speech overrides not loaded; using dataset text.', error);
        return {};
    }
}

export function setJesusSpeechOverrides(overrides = {}) {
    JESUS_SPEECH_OVERRIDES = overrides && typeof overrides === 'object' ? overrides : {};
}

export function getDisplayJesusText(verseId, verse, translationName) {
    const override = JESUS_SPEECH_OVERRIDES?.[verseId]?.[translationName];
    if (typeof override === 'string') return override;
    return verse?.translations?.[translationName] || '';
}
