# Jesus Words Project
Updated 05/17/2026

A web application for exploring and studying the direct words of Jesus Christ as recorded in the canonical Gospels.

## Features

- **Organized Content**: Browse teachings by category (Sermon on the Mount, Parables, Sayings)
- **Search Functionality**: Search across all content for specific words or phrases
- **Dark Mode**: Toggle between light and dark themes
- **Accessibility Options**: Popup menu with High Contrast, Large Text, Reduce Motion, and Simplified View. All options can be combined and persist across reloads.
- **Semantic Highlighting Engine**: Dynamically compares verses to highlight profound theological differences using heuristic rules.
- **Notes/Annotations**: Add, edit, and save notes for each section/verse. Notes are saved in your browser and persist across reloads.
- **Responsive Design**: Works on desktop and mobile devices

## Structure Overview

For a detailed breakdown of the complete project layout and directory logic, please refer to the [Project Structure](PROJECT_STRUCTURE.md) guide. At a high level:

- `/data`: Contains the finalized core `jesus_verses_final.json` consumed by the live application.
- `/scripts`: The backend Python/Node.js build pipeline for formatting and collating data.
- `/docs/sources`: The offline textual processing repository, starting from raw PDFs/JSON to intermediate text formats.
- `/css` & `/js`: The vanilla frontend layout, styling, themes, and application logic.

## Quick Start

1. **Clone or download** this repository to your local machine
2. **Start a local server** (required for JSON file loading):

### Using Python (recommended):
```bash
cd jesus.words
python -m http.server 8000
```

### Using Node.js:
```bash
cd jesus.words
npx http-server -p 8000
```

3. **Open your browser** and navigate to `http://localhost:8000`

## Usage

- **Navigation**: Click the tab buttons to switch between sections. Content loads dynamically.
- **Search**: Type in the search box to find content across all sections. Results show the source section.
- **Dark Mode**: Click the sun/moon toggle button (bottom left) for a smooth animated transition. Your preference is saved.
- **Accessibility**: Click the gear icon (bottom left) for a popup menu. Enable High Contrast, Large Text, Reduce Motion, or Simplified View. All options can be combined and persist.
- **Notes**: Add notes to any section or verse using the "My Notes" area in each card. Notes are saved in your browser.

## Development

The frontend project uses vanilla HTML, CSS, and JavaScript with no build process required. Content is stored in JSON format for easy loading.

### Rebuilding Dataset Content
To rebuild or modify the data pipeline, execute the processing tools in `/scripts/` against the raw texts in `/docs/sources/`. The master build consumes the formatted files in `/docs/sources/extracted_txt/` and writes the compiled `/data/jesus_verses_final.json`.

Recommended rebuild flow (core steps):
```bash
node scripts/build_master_jesus_dataset.js
node scripts/audit_jesus_dataset.js
# Optional: generate highlight reports or verify pipeline
# node scripts/generate_highlight_report.js
# node scripts/verify_highlight_pipeline.js
```

### Customizing Styles
- Main styles: `css/styles.css`
- Dark mode: `css/dark-mode.css`
- Accessibility: `css/accessibility.css`

## Browser Support

Works in all modern browsers that support:
- ES6 JavaScript features
- CSS Grid and Flexbox
- Fetch API

## License

This project is for educational and spiritual purposes.
