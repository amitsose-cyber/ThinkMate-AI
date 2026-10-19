# ThinkMate AI

A responsive, browser-based study companion built with plain HTML, CSS, and JavaScript. It is designed for GitHub Pages and does not need a build step, server, account, or API key.

## Run it

Open `index.html` in a modern browser, or serve this folder with any static web server. The app stores study guides, quiz history, and theme preference in the current browser's `localStorage`.

## Publish with GitHub Pages

1. Create a GitHub repository and upload the files in this folder to the repository root.
2. In the repository, open **Settings → Pages**.
3. Choose **Deploy from a branch**, select the branch and `/ (root)` directory, then save.
4. Open the Pages URL GitHub provides.

## Features

- Paste class notes or upload TXT, Markdown, CSV, HTML, PDF, or DOCX material. PDF and DOCX text is extracted in the browser using open-source readers. For a topic-only start, the app searches Wikipedia for an introductory article and links back to the source.
- Generate a concise source-based summary, key ideas, interactive flashcards, and a topic map.
- Ask the study helper to find passages in the source material.
- Find related YouTube searches.
- Start an MCQ quiz when ready, then review selected and correct answers, explanations, and topic scores.
- Track quiz results and performance by topic.
- Use the interface on desktop and mobile, with a dark theme option.

## Important limits

This is a local-first static website, not a hosted AI service. Pasted/uploaded material stays in the browser; document reader libraries are downloaded from a CDN but the documents are not uploaded. Topic-only search sends the topic to Wikipedia; the app uses the returned article as the source and links to it. It uses lightweight text analysis in the browser and does not call an AI model. The question generator creates practice prompts from phrases in the selected source, so students should check the original material. YouTube links open search results rather than verified or curated recommendations. Topic search and first-time PDF/DOCX extraction need an internet connection; pasted notes and plain text files work offline.

Data is saved only in the browser used to create it. Clearing browser data removes it. There are no user accounts, cross-device sync, or secure backend. Do not store sensitive material here. To add real AI generation or shared accounts later, use a backend and keep API keys on the server; never commit private keys to a GitHub Pages site.

## Files

- `index.html` — page structure and application views
- `style.css` — responsive visual design and theme
- `app.js` — local study guide generation, storage, quizzes, review, and progress
