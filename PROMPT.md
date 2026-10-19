# JobFinder Project Handoff

Use this file to resume work in a new chat. Start by reading this file and checking the current repository state; implementation may have changed since this handoff was written. Preserve unrelated user work and never stage or commit the CV or generated LaTeX/PDF artifacts unless explicitly asked.

## Resume Instruction

Read `PROMPT.md`, `README.md`, inspect `git status`, and inspect the relevant current code before making a plan or changing files. This is a living handoff: verify every claimed feature and roadmap item rather than assuming it is still accurate. Preserve unrelated user work. Keep changes focused, add or update tests for behavioral changes, and run the narrowest relevant checks followed by the full checks when appropriate. Do not stage, commit, push, delete, or overwrite user data unless the user explicitly requests it.

## Project Summary

JobFinder is a personal job-search workspace built with Svelte 5, TypeScript, Vite, and a small Node.js HTTP server. It is meant to replace a scattered browser chat with a durable workspace where one person can establish their background and preferences, assess job leads, research opportunities, track applications, and iteratively prepare truthful cover letters.

This is a local-first personal tool, not a multi-user hosted service. The frontend binds to loopback for development. The production server defaults to `127.0.0.1:3000`; it has no authentication. Keep it local and do not expose it to untrusted networks.

## Current Implementation

- `src/App.svelte` contains the Svelte single-page app and its local state/persistence.
- `server.ts` contains the Node HTTP API, encrypted provider-key storage, AI provider adapters, profile extraction, recruiter chat, public job-board fetching, and job matching.
- `public/styles.css` contains the app styles.
- `test/server.test.ts` contains the Node test suite, including mocked provider and job-source requests.
- `vite.config.mjs` proxies `/api` requests from Vite to `http://127.0.0.1:3000`, with `changeOrigin: true` so protected API-key writes work through the development server.
- `README.md` explains setup, privacy, resume import, AI recruiter/recommendations, permitted live-job verification, manual job-offer entry, and the boundary between public job APIs and manual search links.

### Existing Features

- Profile and resume upload/autofill. `.txt`, `.md`, and `.tex` are read as text in the browser; LaTeX is not rendered or compiled. LinkedIn profile content must be pasted by the user; the app does not fetch or scrape profiles.
- API-key settings for OpenAI, Gemini, and Anthropic. Provider keys are entered only through the website and saved encrypted at rest with AES-256-GCM in `.data/`. Saves are serialized and concurrent duplicate saves return HTTP 409. The UI hides the save input when configured.
- AI recruiter chat (`POST /api/chat`) reviews profile/resume details, asks follow-up questions, and can suggest skills to add to the profile. Chat is stored in browser local storage.
- Recruiter chat has clear/restart controls for its local conversation and unadded suggestions, confirms destructive actions, makes failed first turns retryable, and explains that the selected provider receives the current profile (including resume text) plus up to 30 recent messages. Switching providers warns before the next request is sent. Suggested skills are saved only when the user explicitly adds one.
- First-run onboarding guides a user through adding an API key, bringing in a CV, recruiter chat, and recommendations; every step can be skipped and revisited.
- Recruiter chat also suggests focused LinkedIn job-alert queries. JobFinder opens LinkedIn search links only; it never accesses a LinkedIn account.
- LinkedIn job-alert emails can be pasted or loaded locally as `.eml`/text and imported with `POST /api/import-linkedin-alert`. Dropping or selecting a supported file starts extraction when a provider is configured; pasted text needs an explicit import. The user-supplied email text is sent to the selected AI provider only for extraction and is not retained by the server. Raw `.eml` MIME bodies may be harder for a provider to interpret than copied rendered email text.
- For each of up to five extracted alert leads, JobFinder sends only the title, company, and location—not raw email text—to Jobicy and any configured Adzuna and Jooble APIs. It returns possible live equivalents alongside the imported leads, with source attribution and original-listing links. Matches remain suggestions, not proof that the alert role is still open or identical.
- When an alert contains an original LinkedIn job URL, JobFinder preserves it for the imported lead. It accepts common HTML/quoted-printable URL forms, but never follows or fetches the link. A single clear extracted lead falls back to the single extracted LinkedIn job URL when the provider cannot associate it itself.
- Jobicy is available without a key. Adzuna requires `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, and a comma-separated `ADZUNA_COUNTRIES` list. Jooble requires `JOOBLE_API_KEYS`, a JSON map of two-letter country codes to that country's API key. These are loaded from the local `.env` file and must never be committed, saved in browser storage, or pasted into chat.
- This is not mailbox access, LinkedIn scraping, or automatic company-site crawling. Do not add LinkedIn or Indeed scraping. Keep verification limited to documented/public APIs or sources whose terms permit the intended use.
- Job suggestions (`POST /api/find-jobs`) query the public Remotive and Arbeitnow APIs (one Remotive request per search), then ask the selected AI provider to rank a bounded set of results against profile, location/work preferences, and recent chat. Source results are validated and deduplicated; available posting dates are shown. The UI shows recommendations and lets the user open, save, or dismiss them. Saved jobs and recommendations are held in browser local storage. Listings may be stale or incomplete; users must verify details at the original listing.
- Recommended jobs include a persistent **Hide this job** action. Hidden listing URLs are stored in browser local storage and excluded from later recommendation and LinkedIn-email-import results; saved jobs are not affected. Recommendations are paged at ten per page, sortable by evaluated match or date, and filterable by location. Evaluated scores are color-coded; alert-derived leads are explicitly labeled as not evaluated rather than displayed as `0%` matches.
- Manual job saving, application-status tracking, LinkedIn/Indeed/Google Jobs search links, and per-job AI cover-letter sessions. Each session is browser-local and supports an optional user-written starting letter, editable draft, persisted revision conversation, copy/download, and clearing with confirmation.

Do not add LinkedIn or Indeed scraping. Their current terms prohibit unauthorized scraping/automated data collection. Keep search limited to documented/public APIs or sources whose terms permit this, and send users to the original listing to review/apply themselves.

## Provider and Data Notes

- Supported providers: `openai`, `gemini`, `anthropic`.
- Optional model overrides: `OPENAI_MODEL`, `GEMINI_MODEL`, `ANTHROPIC_MODEL`.
- The server loads `.env` without overwriting explicitly supplied server settings. Provider keys are never read from environment variables.
- `JOBFINDER_DATA_DIR` overrides the default `.data` directory. Keep `key-encryption.key` and `provider-keys.enc` together for backups; losing the encryption key makes saved keys unrecoverable.
- The profile and resume are stored unencrypted in the server's `.data/profile.json`; chat, saved jobs, recommendations, hidden-job URLs, onboarding status, and alert suggestions remain in browser local storage. Profile/resume/chat data is sent to the selected AI provider when the user starts an extraction, chat, matching, email-alert import, or cover-letter request. Job search requests are made by the server to third-party job-board APIs. Alert verification sends only extracted title, company, and location to the configured verification sources.
- Provider failures distinguish authentication/access, model, timeout, rate-limit, provider-availability, network, malformed-response, and rejected-request cases without returning provider response content. Server logs record only the operation, provider, HTTP status, error name, and safe category.
- Avoid logging API keys, resume text, chat content, or full provider/job-board response bodies.

## Development and Validation

Requires Node.js 18.18 or newer.

### Local Node/npm installation

This environment uses the user's local NVM installation. If `node` or `npm` is unavailable inside a restricted agent shell, run the command with access to the local machine installation (with user approval when required). The current installation is at `/home/matt/.nvm/versions/node/v26.8.2/bin`; prepend that directory to `PATH` when invoking commands manually if needed.

```sh
npm install
npm run dev:server
```

In a second terminal:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. Vite requires the API server on port 3000 for `/api` requests. `npm run dev:server` compiles the server before starting it; restart it after server changes. Restart `npm run dev` after `vite.config.mjs` changes as well, particularly the API proxy setting.

Production startup:

```sh
npm start
```

Useful checks:

```sh
npm run check
npm run lint
npm run format:check
npm test
```

`npm test` builds the app/server and runs the Node test suite. Provider/job-board network calls are mocked in tests; a passing suite does not verify live provider credentials or external API availability.

## Product Direction and Priorities

The README roadmap is the product-level source of truth. Continue the earliest unfinished priority after validating the current implementation and asking for direction only when a meaningful product choice is not specified.

1. **Saved-job assessment is complete.** Saved roles now have a user-triggered AI assessment with score, rationale, strengths, concerns, unanswered questions, and next action. Assessments stay browser-local, record a timestamp and a deterministic input version, become stale when profile/listing/recent recruiter inputs change, and can be rerun or discarded. The API validates and constrains the structured result; it never treats the score as a fact or fabricates missing listing details.
2. **Job research and practical tracking are complete.** Saved jobs now include a browser-local research area for user notes, permitted URLs, questions, contacts, and follow-ups; and a tracker for saved/applied/follow-up/interview dates, next action, deadline, and activity history. Existing saved jobs are normalized defensively on load. JobFinder does not fetch listings or company sites for research.
3. **Iterative cover-letter workspace is complete.** Every saved job now has a browser-local session with an optional user-written starting letter, editable current draft, and persisted user/AI revision conversation. The provider receives the profile, job description, starting letter, current draft, and requested change for each turn. The user can copy/download the current draft or clear the session with confirmation. Existing browser-local jobs remain compatible because the session field is optional.
4. **Reusable base letters and version restoration are implemented.** Users can explicitly promote a selected final letter into a new named reusable base. A job's letter can copy a selected base into its own starting text with provenance, while immutable generated versions can be restored with confirmation. Existing bases, drafts, and user edits are never silently overwritten.
5. **Next task: acceptance and polish.** Add regression tests, migration tests, and an in-browser acceptance pass. Update README and this handoff whenever the product behavior, privacy boundary, or roadmap materially changes.
6. **Queued application workflow improvements.** Add a small saved-job application-context chat for questions about the role and practice answers to likely application-site questions; move the cover-letter workspace from a modal into the saved-job page; and automatically set the Applied date to today when a job changes to Applied while preserving later manual edits.
7. **Later task: AI-assisted CV updates.** Let the user request proposed CV/resume edits based on knowledge gained from recruiter conversations, saved-job research, and application tracking. Use only user-provided or user-confirmed material; never fabricate experience, achievements, qualifications, or company facts. Show a reviewable diff or draft, require explicit acceptance for each change, and preserve a recoverable original.

## Non-Negotiable Constraints

- Treat JobFinder as a single-user, local-first tool. Keep provider keys encrypted server-side and never return, log, commit, or paste keys, `.env` values, CVs, email bodies, or other secrets into chat/source control.
- Do not add mailbox access, LinkedIn/Indeed scraping, automatic listing-URL fetching, company-site crawling that violates terms, bypasses of access controls, or automatic applications. The user may paste/import content and manually open original listings.
- Use documented/public job APIs or sources whose terms permit the intended use. Preserve source attribution and original-listing links. Clearly label AI judgments and possible live equivalents as suggestions, not facts or guarantees.
- Do not make up work history, achievements, qualifications, company facts, salary, job requirements, or research findings. Cover letters must remain truthful and should be reviewable/editable by the user before use.
- Keep saved jobs, assessments, research, tracker data, and cover-letter artifacts local unless the user explicitly changes that design. Make local persistence, provider-sharing, reruns, data deletion, and destructive actions understandable in the UI. Confirm destructive operations.
- Respect the existing privacy/security controls: localhost-only API handling, strict request validation and size limits, safe error messages, no sensitive logging, and server-side encrypted provider-key storage.
- Keep the Svelte/TypeScript app accessible and responsive. Maintain the existing visual language where practical; do not rewrite unrelated UI or server code to deliver a focused feature.
- When changing persisted browser data, use a tolerant migration/defaulting strategy so prior saved jobs keep working. When changing an API prompt or response shape, validate inputs and add mocked server tests.
- Do not commit anything unless the user explicitly asks. In particular, `cv.tex` and the generated LaTeX/PDF artifacts are personal user files and must remain untracked. `.env` and `.data/` are private local state.

## Validation Checklist

For implementation work, run the narrowest relevant test while iterating, then run these before reporting completion when the environment permits:

```sh
npm run check
npm run lint
npm run format:check
npm test
git diff --check
```

State any check that was not run and why. Test provider/network behavior with mocks; never use the user's credentials merely to validate a change. Use non-sensitive sample data for manual acceptance testing.

## Repository State at Handoff

The saved-job assessment and iterative cover-letter session are committed. The browser-local saved-job research/tracking and reusable-letter workspace are currently uncommitted in `README.md`, `public/styles.css`, and `src/App.svelte`; this `PROMPT.md` remains untracked. `npm run check` passed before the reusable-letter implementation; this environment currently has no Node/npm executable available for rerunning it. Do not rely on this snapshot in a later session: always run `git status` first. The untracked `cv.tex` and generated LaTeX/PDF outputs (`cv.aux`, `cv.fdb_latexmk`, `cv.fls`, `cv.log`, `cv.out`, `cv.pdf`, `cv.synctex.gz`) are personal user data/build artifacts, not part of the app change and must not be staged or committed.
