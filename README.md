# Jesus Words Project

A web application for exploring and studying the direct words of Jesus Christ as recorded in the canonical Gospels.

## Features

- **Organized Content**: Browse teachings by category (Sermon on the Mount, Parables, Sayings)
- **Search Functionality**: Search across all content for specific words or phrases
- **Dark Mode**: Toggle between light and dark themes
- **Accessibility Options**: Popup menu with High Contrast, Large Text, Reduce Motion, and Simplified View. All options can be combined and persist across reloads.
- **Notes/Annotations**: Add, edit, and save notes for each section/verse. Notes are saved in your browser and persist across reloads.
- **Responsive Design**: Works on desktop and mobile devices

## File Structure

```
jesus.words/
├── index.html              # Main HTML file
├── css/
│   ├── styles.css          # Main styles and layout
│   ├── dark-mode.css       # Dark mode specific styles
│   └── accessibility.css   # Accessibility enhancements
├── js/
│   ├── main.js            # Tab navigation and content loading
│   ├── search.js          # Search functionality
│   ├── dark-mode.js       # Dark mode toggle
│   ├── accessibility.js   # Accessibility menu
│   └── notes.js           # Notes functionality (per section/verse)
├── data/
│   ├── home.json          # Home page content
│   ├── sermon.json        # Sermon on the Mount content
│   ├── parables.json      # Parables content
│   └── sayings.json       # Sayings content
└── assets/
    ├── icons/             # SVG icons for UI elements
    ├── images/            # Images (if any)
    └── fonts/             # Custom fonts (if any)
```

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

### Using PHP:
```bash
cd jesus.words
php -S localhost:8000
```

3. **Open your browser** and navigate to `http://localhost:8000`

## Usage

- **Navigation**: Click the tab buttons to switch between Home, Sermon, Parables, and Sayings. Content loads dynamically.
- **Search**: Type in the search box to find content across all sections. Results show the source section.
- **Dark Mode**: Click the sun/moon toggle button (bottom left) for a smooth animated transition. Your preference is saved.
- **Accessibility**: Click the gear icon (bottom left) for a popup menu. Enable High Contrast, Large Text, Reduce Motion, or Simplified View. All options can be combined and persist.
- **Notes**: Add notes to any section or verse using the "My Notes" area in each card. Notes are saved in your browser.

## Development

The project uses vanilla HTML, CSS, and JavaScript with no build process required. Content is stored in JSON files for easy editing.

### Adding Content

Edit the JSON files in the `data/` directory to add or modify content:
- Each file contains a `title` and `sections` array
- Each section has a `heading` and `text` property

### Customizing Styles

- Main styles: `css/styles.css`
- Dark mode: `css/dark-mode.css`
- Accessibility: `css/accessibility.css`

## Browser Support

Works in all modern browsers that support:
- ES6 JavaScript features
- CSS Grid and Flexbox
- Fetch API

## Next Steps

- [ ] Add more comprehensive content to JSON files
- [ ] Implement verse references and cross-references
- [ ] Include multiple Bible translations
- [ ] Add print-friendly styling
- [ ] Implement offline functionality with service workers

## License

This project is for educational and spiritual purposes. Scripture content is in the public domain.

## Full Directory Structure

```
jesus.words/
├── index.html
├── README.md
├── css/
│   ├── styles.css
│   ├── dark-mode.css
│   └── accessibility.css
├── js/
│   ├── main.js
│   ├── search.js
│   ├── dark-mode.js
│   ├── accessibility.js
│   └── notes.js
├── data/
│   ├── hart.json
│   ├── home.json
│   ├── lamsa.json
│   ├── nrsv.json
│   ├── parables.json
│   ├── sayings.json
│   └── sermon.json
├── assets/
│   ├── icons/
│   │   ├── accessibilityicon.svg
│   │   ├── accessicon2.svg
│   │   ├── moon.svg
│   │   └── sun.svg
│   ├── images/   # (currently empty)
│   └── fonts/    # (currently empty)
└── .git/         # (if using git)
```

- All JSON data files for translations and content are in `data/`.
- All scripts are in `js/`.
- All stylesheets are in `css/`.
- All icons are in `assets/icons/`.
- Images and fonts folders are present for future use.

---