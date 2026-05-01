# Project Structure

This document outlines the purpose of each top-level directory in the `jesus.words` project. The folder structure securely separates the live frontend architecture, developer tooling, and chronological stages of text processing.

### `/archive`
Contains obsolete, retired, or historical files that are no longer actively used by the site or the build scripts, but are kept purely for archival and backup purposes.

### `/assets`
Static branding and visual resources loaded by the frontend, including vector icons (`.svg`), typography fonts, and general UI imagery.

### `/css`
Vanilla CSS stylesheets responsible for the application's appearance. It handles structural styling (`styles.css`), user-toggled themes (`dark-mode.css`), and accessibility overrides (`accessibility.css`).

### `/data`
The vital runtime data directory. Files here (like `jesus_verses.json`) are directly fetched by the live website at runtime. Only completely polished, production-ready outputs should reside here.

### `/dev`
A sandbox for development execution. It contains `/test-data` for isolating experimental scripts and a `/scratch` folder for temporary data processing tasks.

### `/docs`
General project documentation, notes, and planning documents. This folder also houses the core textual sources used by the build scripts.

### `/docs/source_info`
Contains supporting background information on source translations, including translator postscripts and textual variant notes.

### `/docs/sources`
The textual data processing pipeline. This directory houses the primary source texts used for extraction:
- `bsb_usj/`: JSON-based USJ files for the Berean Standard Bible (anchor source).
- `full_txts/`: Raw full-text files for translations (NRSVUE, DBH, LAMSA) used for alignment.

### `/js`
The live vanilla JavaScript logic that powers the website frontend. This includes user interactivity, dataset fetching (`main.js`), rendering rules, and aesthetic enhancements like dark mode and semantic highlighting.

### `/scripts`
The backend build pipeline tools written in Python and Node.js. These standalone scripts execute the heavy lifting of extracting, cleaning, translating, and structuring the raw Bible text sources into the final JSON output served in `/data`.
