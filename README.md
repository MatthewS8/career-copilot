# JobFinder

JobFinder is a small, browser-based workspace for shaping your job search, saving roles, tracking applications, and drafting tailored cover letters with an AI provider you choose.

## Run it

Requires Node.js 18 or newer. Install the frontend build dependencies with `npm install`.

```sh
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The server binds to localhost by default. Set `PORT` to change the port, or set `HOST` to bind another interface. The app has no authentication, so only expose it on a trusted private network.

`npm start` builds the Svelte frontend before starting the Node.js API server. For frontend development, run `npm start` in one terminal and `npm run dev` in another, then open [http://127.0.0.1:5173](http://127.0.0.1:5173). The Vite development server proxies API requests to the server on port 3000.

## Set up AI letter drafting

Open **API settings** in the app to enter an OpenAI, Gemini, or Anthropic key. Keys are stored only on the server, encrypted at rest with AES-256-GCM, and never returned to the browser after saving. The server creates a random encryption key and stores it in `.data/key-encryption.key`; encrypted provider keys are saved in `.data/provider-keys.enc`. The data directory is restricted to the current OS user, and both files use owner-only permissions. Back up both files together if you need to retain saved provider keys. Deleting the encryption key makes saved keys unrecoverable.

Alternatively, configure a provider key in the server environment and restart JobFinder:

```sh
OPENAI_API_KEY=your-key npm start
```

Supported environment variables are `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY`. Optional model overrides are `OPENAI_MODEL`, `GEMINI_MODEL`, and `ANTHROPIC_MODEL`. A key saved in API settings takes precedence over that provider's environment key; removing the saved key falls back to the environment key. Set `JOBFINDER_DATA_DIR` to choose another private directory for the encryption and encrypted-key files.

Encryption protects the API keys at rest from someone who can read only the encrypted-key file. The JobFinder server must be able to read both files to use your key, so it cannot protect against someone with access to your OS account or server process. If the encrypted file is damaged and there is no backup, remove `.data/provider-keys.enc` to discard saved keys and try again; keep `key-encryption.key`. Restart JobFinder after restoring files from backup. JobFinder has no sign-in or multi-user protection: keep it bound to localhost by default and do not expose it to an untrusted network. All API endpoints accept requests only when the HTTP Host is a localhost address. The candidate profile and job description are sent to the selected AI provider only when you request autofill or a cover-letter draft.

## Autofill your profile

Upload a `.txt`, `.md`, or LaTeX `.tex` resume (or paste its text/source), choose a configured AI provider, and select **Autofill from resume**. LaTeX source is read as text; it is not compiled or rendered. You can also paste text copied from your LinkedIn profile and autofill from that. Extracted values fill empty fields only; review them and save your profile yourself. The source text is sent to the selected AI provider when you click autofill. Resume text is saved with your profile in browser storage when you save; copied LinkedIn text is only used for the extraction request and is not saved.

A LinkedIn profile URL alone cannot be imported: LinkedIn restricts access to profile content. The URL is saved in your browser, but JobFinder does not fetch or scrape LinkedIn. Open your profile and paste the details you want to use.

## What it does

- Saves your job-search preferences and resume text (including LaTeX source) in the browser's local storage.
- Lets you open LinkedIn, Indeed, and Google Jobs searches based on your preferred role and location.
- Saves job links, descriptions, and notes locally, with application status tracking.
- Drafts, copies, or downloads a cover letter using OpenAI, Gemini, or Anthropic.

Job discovery is intentionally user-directed: JobFinder opens searches on job sites, but does not log into, crawl, or scrape LinkedIn or other job boards. Save a listing manually after reviewing it. Resume upload reads `.txt`, `.md`, and `.tex` files as text; paste text from other resume formats.

GitHub Copilot is not configured as a provider in this MVP. Your local profile and saved jobs are not encrypted and are available to anyone using the same browser profile. Avoid using JobFinder on a shared device.

## Test

```sh
npm test
```
