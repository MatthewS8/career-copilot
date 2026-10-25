# Career Copilot

Career Copilot is a self-hosted AI career consultant for shaping your job search, finding and evaluating roles, tracking applications, and drafting tailored cover letters with an AI provider you choose.

## Run it

Requires Node.js 18.18 or newer. Install the frontend build dependencies with `npm install`.

```sh
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The server binds to localhost by default. Set `PORT` to change the port, or set `HOST` to bind another interface.

`npm start` type-checks and builds the TypeScript/Svelte frontend and Node.js API server before starting the app. For frontend development, run `npm start` in one terminal and `npm run dev` in another, then open [http://127.0.0.1:5173](http://127.0.0.1:5173). The Vite development server proxies API requests to the server on port 3000.

Run `npm run lint` to apply the strict ESLint rules, `npm run check` to type-check the frontend and server, and `npm run format:check` to verify Prettier formatting. Run `npm run format` to format the project source.

## Set up AI features

Open **API settings** in the app to enter an OpenAI, Gemini, or Anthropic key. The selected provider powers resume autofill, recruiter chat, job matching, and cover-letter drafts. Keys are stored only on the server, encrypted at rest with AES-256-GCM, and never returned to the browser after saving. The server creates a random encryption key and stores it in `.data/key-encryption.key`; encrypted provider keys are saved in `.data/provider-keys.enc`. The data directory is restricted to the current OS user, and both files use owner-only permissions. Back up both files together if you need to retain saved provider keys. Deleting the encryption key makes saved keys unrecoverable.

AI provider keys are configured only in **API settings**. The server encrypts them at rest; they are never read from environment variables. Optional model overrides are `OPENAI_MODEL`, `GEMINI_MODEL`, and `ANTHROPIC_MODEL`. Set `JOBFINDER_DATA_DIR` to choose another private directory for the encryption and encrypted-key files. The environment-variable name remains for backwards compatibility.

Optional live-job verification for imported alerts is configured through a local `.env` file. Copy `.env.example` to `.env`, enter your private source credentials, then restart Career Copilot:

```sh
cp .env.example .env
```

Set `ADZUNA_COUNTRIES` to a comma-separated list of Adzuna two-letter country codes. Jooble requires a separate key for every country domain, supplied in the quoted `JOOBLE_API_KEYS` JSON map. Keep `.env` out of source control, browser storage, and chat. Jobicy needs no key.

Before configuring a source, review and accept its current terms. Career Copilot preserves visible source attribution and original-listing links for Jobicy, Adzuna, and Jooble results; it does not guarantee that a source result is still open or equivalent to an alert lead. Jooble's free allocation is limited, so configure only the countries you genuinely intend to search.

Encryption protects the API keys at rest from someone who can read only the encrypted-key file. The Career Copilot server must be able to read both files to use your key, so it cannot protect against someone with access to your OS account or server process. If the encrypted file is damaged and there is no backup, remove `.data/provider-keys.enc` to discard saved keys and try again; keep `key-encryption.key`. Restart Career Copilot after restoring files from backup.

## Accounts and self-hosting

On first run, create the owner account. Career Copilot stores a password hash and a persistent session cookie; sessions last 30 days and refresh while the app is used. Profile data, API keys, and saved workspace data are isolated by account on the server.

To put Career Copilot behind Nginx, first create the owner account through your current local URL so existing browser data is uploaded. Then set `JOBFINDER_PUBLIC_URL` to the full canonical URL (for example, `http://jobs.home.arpa`) and restart the server. Requests arriving at another host are redirected to that URL. Configure Nginx to preserve the `Host` header and proxy to Career Copilot on loopback. HTTP is supported for a trusted LAN, but HTTPS is recommended because HTTP session cookies and submitted data can be observed on the network. The environment-variable name remains for backwards compatibility.

## Autofill your profile

Upload a `.txt`, `.md`, or LaTeX `.tex` resume (or paste its text/source), choose a configured AI provider, and select **Autofill from resume**. LaTeX source is read as text; it is not compiled or rendered. You can also paste text copied from your LinkedIn profile and autofill from that. Extracted values fill empty fields only; review them and save your profile yourself. The source text is sent to the selected AI provider when you click autofill. When you save, the profile and resume text are stored on the Career Copilot server; copied LinkedIn text is only used for the extraction request and is not saved.

A LinkedIn profile URL alone cannot be imported: LinkedIn restricts access to profile content. The URL is saved with your server-side profile, but Career Copilot does not fetch or scrape LinkedIn. Open your profile and paste the details you want to use.

## Recruiter and job recommendations

On first launch, Career Copilot offers a skippable setup path: add a provider key, bring in your CV, have a recruiter conversation, then view recommendations. You can leave any step for later and return to it from the navigation.

The **AI recruiter** uses your profile, resume, and conversation to ask follow-up questions about your experience, identify skills you may want to add, and propose a small set of focused LinkedIn job-alert searches. Chat history and alert suggestions are saved to your account workspace. When you send a chat turn, the profile, resume text, and recent conversation are sent to the selected AI provider.

**Find more jobs** requests public listings from the [Remotive public API](https://github.com/remotive-com/remote-jobs-api) and the [Arbeitnow job-board API](https://www.arbeitnow.com/api/job-board-api). Remotive's API listings are delayed by 24 hours, and its usage guidance recommends no more than four requests per day (requests above two per minute are blocked). Career Copilot makes one Remotive request for a search. Listings are linked to their source and labeled with the source name; Remotive's terms require linking to its listing and crediting Remotive. The source results are matched and ranked by the selected AI provider using your profile, location/work preferences, recent recruiter chat, and listing details. Those profile/chat details and the job snippets are sent to that provider when you request recommendations. Recommendations are saved in your account workspace; choose **Save to my jobs** to add one to your tracked jobs. The **Recommended** view is paged, can be ordered by match or date, and can be filtered by place; evaluated match percentages are color-coded.

Job-board data can be incomplete, delayed, or out of date. Check the original listing for current availability and application details; a recommendation is not a guarantee that a role is still open or a fit.

## LinkedIn job-alert emails

Career Copilot can import leads from a LinkedIn job-alert email that you explicitly paste or load from a local `.eml`/text file. Dropping or selecting a supported local file starts extraction immediately when an AI provider is configured; pasted text is sent only after you select **Import leads**. The file is read in your browser; only the email text you choose to import is sent to the selected AI provider for extraction, and the server does not retain it. Career Copilot then sends only each extracted title, company, and location to Jobicy and any configured Adzuna or Jooble API; it never forwards the raw email to them. To respect source rate limits, it checks at most the first five clear leads in one import. An original LinkedIn job URL found in a supported alert is kept for the imported lead; possible live equivalents appear in **Recommended** alongside the imported leads, with source attribution and original-listing links for review. Alert-derived leads are not assigned a match percentage unless an AI matching pass evaluates them.

This is not a mailbox connection: Career Copilot does not sign in to LinkedIn or your email, fetch alert emails, scrape LinkedIn, or automatically crawl company websites. A possible live equivalent is not proof that the original alert role is still available; check the original listing before applying. Remove private material from an email before importing if you do not want the provider to receive it.

## Other job-search tools

- Saves your profile, resume text (including LaTeX source), saved jobs, recommendations, and preferences in your account workspace on the Career Copilot server.
- Lets you open LinkedIn, Indeed, and Google Jobs searches based on your preferred role and location. These are ordinary search links opened for you to review manually, not sources used by **Find more jobs**.
- Saves job links, descriptions, notes, and a per-role research workspace to your account. Add your own research notes, permitted source links, questions, contacts, and follow-ups; Career Copilot does not fetch listings or company sites for this workspace.
- Tracks each saved role with saved, applied, follow-up, and interview dates; a next action, deadline, and lightweight activity history. Status changes are recorded in that history.
- Lets you manually paste a job offer's title, company, link, and description into **Saved jobs**. The pasted description can be used for a tailored cover letter; Career Copilot never fetches the linked LinkedIn page.
- Creates a per-job cover-letter session using OpenAI, Gemini, or Anthropic. Start from scratch or paste a letter to build on, then ask for revisions; the selected provider receives the profile, job description, starting letter, current draft, and submitted revision request. Drafts can be edited, copied, downloaded, or cleared.
- Lets you save a deliberately chosen draft as a named reusable base letter. A later job can copy a selected base into its own starting-letter field; each job keeps its own provenance and edits. AI-generated drafts are retained as immutable local versions that can be restored with confirmation, while user edits remain separate from generated history.
- Can propose an editable CV/resume update from your current resume, profile, your own recruiter messages, and saved-job research/tracking. The proposal never changes the saved resume automatically: you must review and explicitly accept it, and the prior accepted resume remains recoverable in your account history.
- Opens an application studio directly inside each saved-job card. It combines the cover-letter workspace with an application-context chat for role questions and practice answers. The chat sends only the saved role, profile, resume, and user-confirmed application context to the selected provider; it must not invent experience or company facts. Changing a role to **Applied** fills today's date only when no applied date exists, so later manual edits remain intact. Clearing the letter session, application chat, assessments, or restoring a version requires confirmation.

Job discovery is intentionally limited to the public APIs described above. Career Copilot does not log into, crawl, or scrape LinkedIn, Indeed, or other job boards. It does not automate applications; open the original listing and review/apply there yourself. Resume upload reads `.txt`, `.md`, and `.tex` files as text; paste text from other resume formats.

GitHub Copilot is not configured as a provider in this MVP. Account workspace data is not encrypted at rest; protect the server, OS account, and your Career Copilot password. Avoid shared devices.

## Roadmap

Career Copilot's purpose is to be a durable, personal job-search workspace: a place to understand the candidate, assess incoming opportunities, prepare strong applications, and remember the outcome. The features below are ordered so that each one makes the following work more useful. Before starting an item, verify the current implementation—this roadmap is a guide, not a substitute for checking the code and tests.

### What works today

- A guided profile/CV setup and an ongoing AI recruiter interview to gather background, preferences, skills, and job-alert searches. Answers to an assessment's clarification questions can be saved to the profile for future assessments.
- Discovery through permitted public APIs, plus explicit import of locally supplied LinkedIn alert email content. Imported leads can be checked against the permitted verification sources, but Career Copilot never reads a mailbox or fetches LinkedIn pages.
- Recommended roles receive an AI match score when they go through the matching flow. Saved roles can hold the listing text, personal notes, and an application status.
- Every saved role can receive a user-triggered AI fit assessment. The assessment stores a score, rationale, visible pros and cons, unanswered questions, and a suggested next action locally; it is marked stale when the profile, listing description, or recent recruiter context changes.
- Saved roles include a browser-local research and application-tracking workspace for user-authored notes, links, questions, contacts, follow-ups, dates, next actions, deadlines, and activity history.
- A saved role has a local, iterative cover-letter session. You can supply a starting letter or copy a reusable base, generate a tailored draft, edit it, and use follow-up prompts to adjust it; the conversation, generated versions, provenance, and draft reopen with that job.

### Release readiness and polish

1. Focused migration/regression coverage and isolated browser acceptance passes cover reusable bases, provenance, generated-version restoration, persisted resume recovery, and destructive confirmations. Dedicated browser UI-test tooling remains a nice-to-have.
2. Outputs remain truthful and user-controlled: the AI must not invent experience, achievements, or qualifications. Local drafts are editable, copyable/downloadable where applicable, and protected by confirmations for destructive actions.
3. Add a small, embedded application-context chat beside each saved job so the user can ask questions about the role and practice answers to likely questions on the application site. Keep the job description, profile, and any user-confirmed application context within the existing provider-sharing boundary. **Implemented.**
4. Move the cover-letter workspace from a modal into the saved-job page so the letter, application chat, research, and tracker can be used together without losing context. **Implemented.**
5. When a saved job changes to **Applied**, automatically set its Applied date to today's date; preserve later manual edits to that date. **Implemented.**

### Keep the CV current

1. Users can ask the AI to propose a CV update from their current resume, profile, their own recruiter messages, and saved-job research/tracking. The server instructs the provider to use only supplied facts and never to invent experience, achievements, qualifications, dates, employers, or company facts.
2. The proposal is an editable draft. It changes the saved CV only after explicit confirmation, and every replaced resume is retained in local recovery history. **Implemented.**

### Quality and release work

- Add focused API and UI tests for every new persistence shape, scoring response, prompt boundary, and destructive action. Include migration handling for existing browser-local saved jobs.
- Run `npm run check`, `npm run lint`, `npm run format:check`, `npm test`, and `git diff --check` before considering a feature complete. Perform a local acceptance pass with a non-sensitive sample profile and job listing.
- Keep the app personal and local-first. Do not add automatic applications, mailbox access, LinkedIn/Indeed scraping, automatic fetching of listing URLs, or credentials in source control/browser storage/chat.

## Test

```sh
npm test
```
