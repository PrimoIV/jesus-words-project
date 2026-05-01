export const IGNORE_WORDS = new Set([
    "but", "and", "then", "for", "now", "so", "thus", "therefore",
    "he", "she", "it", "they", "them", "him", "her", "his", "their", "theirs", "its", "we", "us", "our", "you", "your", "yours", "i", "me", "my", "mine",
    "said", "saying", "answered", "replied", "spoke", "asked", "told",
    "to", "a", "an", "the", "this", "that", "these", "those",
    "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "have", "has", "had",
    "in", "on", "at", "by", "from", "with", "about", "as", "into", "like", "through", "after", "over", "between", "out", "against", "during", "without", "before", "under", "around", "among"
]);

export const CRITICAL_WORDS = new Set([
    // Negation & Absolutes & Modals
    "not", "never", "no", "none", "nothing", "nowhere", "must", "may", "all", "every", "many", "will", "would", "should", "shall", "can", "could", "always",
    // Theology & Meaning
    "righteousness", "justice", "sin", "sins", "debt", "debts", "spirit", "breath", "wind",
    "gehenna", "hell", "hades", "aeon", "eternal", "forever", "age", "servant", "slave",
    "repent", "regret", "turn", "necessary", "proper", "kingdom", "heaven", "heavens",
    "faith", "believe", "save", "saved", "healed", "whole", "cured",
    "mercy", "love", "grace", "truth", "light", "life", "way", "world", "earth", "judge", "condemn"
]);

export const SYNONYMS = {
    "replied": "said", "answered": "said", "spoke": "said", "declared": "said",
    "saying": "said", "tell": "said", "tells": "said", "told": "said"
};
