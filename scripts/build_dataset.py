import re
import json
import os
from pathlib import Path

base_dir = Path(__file__).resolve().parent.parent

files_info = [
    {
        'key': 'DBH',
        'path': str(base_dir / 'sources' / 'extracted_txt' / 'dbh_jesus_only_formatted.txt')
    },
    {
        'key': 'NRSVUE',
        'path': str(base_dir / 'sources' / 'extracted_txt' / 'nrsvue_jesus_only_formatted.txt')
    },
    {
        'key': 'LAMSA',
        'path': str(base_dir / 'sources' / 'extracted_txt' / 'lamsa_jesus_only_formatted.txt')
    }
]

book_mapping = {
    'Matthew': 'MAT',
    'Mark': 'MRK',
    'Luke': 'LUK',
    'John': 'JOH',
    'Acts': 'ACT',
    'Revelation': 'REV'
}

output_path = str(base_dir / 'data' / 'jesus_verses.json')

pat = re.compile(r'^([a-zA-Z1-3]+)\s+(\d+):(\d+)\s+[—\-]\s+(.*)$')
cleaner_pat = re.compile(r'\s+')
# DBH often has the verse number repeated at the beginning of the text, e.g. "15 But in reply..."
# The user wants formatting artifacts removed but theological wordings kept.
db_verse_pat = re.compile(r'^\d+\s+')

dataset = {}

for info in files_info:
    trans_key = info['key']
    filepath = info['path']
    if not os.path.exists(filepath):
        print(f"Warning: File not found {filepath}")
        continue
        
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            
            match = pat.match(line)
            if match:
                book = match.group(1)
                chapter = match.group(2)
                verse = match.group(3)
                raw_text = match.group(4)
                
                if book not in book_mapping:
                    continue
                
                book_code = book_mapping[book]
                verse_key = f"{book_code}_{chapter}_{verse}"
                
                # Cleanup text: handle double spaces and strip trailing spaces
                text = cleaner_pat.sub(' ', raw_text).strip()
                
                # Strip embedded verse number from start of text if it exists (particularly from DBH)
                text = db_verse_pat.sub('', text)
                
                if verse_key not in dataset:
                    dataset[verse_key] = {
                        "book": book,
                        "chapter": int(chapter),
                        "verse": int(verse),
                        "speaker": "Jesus",
                        "translations": {}
                    }
                
                # Fill missing translation, preventing duplicates for the same translation
                if trans_key not in dataset[verse_key]["translations"]:
                    dataset[verse_key]["translations"][trans_key] = text
            else:
                # Based on previous check, there are no non-matching lines, but just in case
                print(f"Failed to match line in {trans_key}: {line}")

book_order = {"MAT": 1, "MRK": 2, "LUK": 3, "JOH": 4, "ACT": 5, "REV": 6}

def sort_key(k):
    v = dataset[k]
    b = book_order.get(book_mapping.get(v['book'], ''), 99)
    return (b, v['chapter'], v['verse'])

sorted_dataset = {k: dataset[k] for k in sorted(dataset.keys(), key=sort_key)}

os.makedirs(os.path.dirname(output_path), exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(sorted_dataset, f, indent=2, ensure_ascii=False)

print(f"Successfully generated dataset with {len(sorted_dataset)} verses at {output_path}")
