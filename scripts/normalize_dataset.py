import json
import os
import unicodedata
from pathlib import Path

base_dir = Path(__file__).resolve().parent.parent
path = str(base_dir / 'data' / 'jesus_verses.json')

with open(path, 'r', encoding='utf-8') as f:
    dataset = json.load(f)

def normalize_text(text):
    if not isinstance(text, str):
        return text
    # Standard typography normalizations
    text = text.replace('\u201c', '"')
    text = text.replace('\u201d', '"')
    text = text.replace('\u2018', "'")
    text = text.replace('\u2019', "'")
    text = text.replace('\u2014', '--')
    text = text.replace('\u2013', '-')
    text = text.replace('\u2026', '...')
    text = text.replace('\u00A0', ' ')
    
    # Normalize unicode to canonically composed characters
    text = unicodedata.normalize('NFC', text)
    return text

for verse_id, verse_data in dataset.items():
    if 'translations' in verse_data:
        for trans, text in verse_data['translations'].items():
            verse_data['translations'][trans] = normalize_text(text)

with open(path, 'w', encoding='utf-8') as f:
    json.dump(dataset, f, indent=2, ensure_ascii=False)

print('Normalized unicode in jesus_verses.json.')
