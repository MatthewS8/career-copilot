# JobFinder

JobFinder is a small, browser-based workspace for shaping your job search, saving roles, tracking applications, and drafting tailored cover letters with an AI provider you choose.

## Run it

Requires Node.js 18.18 or newer. Install the frontend build dependencies with `npm install`.

```sh
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The server binds to localhost by default. Set `PORT` to change the port, or set `HOST` to bind another interface. The app has no authentication, so only expose it on a trusted private network.

`npm start` type-checks and builds the TypeScript/Svelte frontend and Node.js API server before starting the app. For frontend development, run `npm start` in one terminal and `npm run dev` in another, then open [http://127.0.0.1:5173](http://127.0.0.1:5173). The Vite development server proxies API requests to the server on port 3000.

Run `npm run lint` to apply the strict ESLint rules, `npm run check` to type-check the frontend and server, and `npm run format:check` to verify Prettier formatting. Run `npm run format` to format the project source.

## Set up AI features

Open **API settings** in the app to enter an OpenAI, Gemini, or Anthropic key. The selected provider powers resume autofill, recruiter chat, job matching, and cover-letter drafts. Keys are stored only on the server, encrypted at rest with AES-256-GCM, and never returned to the browser after saving. The server creates a random encryption key and stores it in `.data/key-encryption.key`; encrypted provider keys are saved in `.data/provider-keys.enc`. The data directory is restricted to the current OS user, and both files use owner-only permissions. Back up both files together if you need to retain saved provider keys. Deleting the encryption key makes saved keys unrecoverable.

Alternatively, configure a provider key in the server environment and restart JobFinder:

```sh
OPENAI_API_KEY=your-key npm start
```

Supported environment variables are `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY`. Optional model overrides are `OPENAI_MODEL`, `GEMINI_MODEL`, and `ANTHROPIC_MODEL`. A key saved in API settings takes precedence over that provider's environment key; removing the saved key falls back to the environment key. Set `JOBFINDER_DATA_DIR` to choose another private directory for the encryption and encrypted-key files.

Encryption protects the API keys at rest from someone who can read only the encrypted-key file. The JobFinder server must be able to read both files to use your key, so it cannot protect against someone with access to your OS account or server process. If the encrypted file is damaged and there is no backup, remove `.data/provider-keys.enc` to discard saved keys and try again; keep `key-encryption.key`. Restart JobFinder after restoring files from backup. JobFinder has no sign-in or multi-user protection: keep it bound to localhost by default and do not expose it to an untrusted network. All API endpoints accept requests only when the HTTP Host is a localhost address.

## Autofill your profile

Upload a `.txt`, `.md`, or LaTeX `.tex` resume (or paste its text/source), choose a configured AI provider, and select **Autofill from resume**. LaTeX source is read as text; it is not compiled or rendered. You can also paste text copied from your LinkedIn profile and autofill from that. Extracted values fill empty fields only; review them and save your profile yourself. The source text is sent to the selected AI provider when you click autofill. Resume text is saved with your profile in browser storage when you save; copied LinkedIn text is only used for the extraction request and is not saved.

A LinkedIn profile URL alone cannot be imported: LinkedIn restricts access to profile content. The URL is saved in your browser, but JobFinder does not fetch or scrape LinkedIn. Open your profile and paste the details you want to use.

## Recruiter and job recommendations

On first launch, JobFinder offers a skippable setup path: add a provider key, bring in your CV, have a recruiter conversation, then view recommendations. You can leave any step for later and return to it from the navigation.

The **AI recruiter** uses your profile, resume, and conversation to ask follow-up questions about your experience, identify skills you may want to add, and propose a small set of focused LinkedIn job-alert searches. Chat history and alert suggestions are stored in your browser's local storage. When you send a chat turn, the profile, resume text, and recent conversation are sent to the selected AI provider.

**Find more jobs** requests public listings from the [Remotive public API](https://github.com/remotive-com/remote-jobs-api) and the [Arbeitnow job-board API](https://www.arbeitnow.com/api/job-board-api). Remotive's API listings are delayed by 24 hours, and its usage guidance recommends no more than four requests per day (requests above two per minute are blocked). JobFinder makes one Remotive request for a search. Listings are linked to their source and labeled with the source name; Remotive's terms require linking to its listing and crediting Remotive. The source results are matched and ranked by the selected AI provider using your profile, location/work preferences, recent recruiter chat, and listing details. Those profile/chat details and the job snippets are sent to that provider when you request recommendations. Recommendations are stored in browser local storage; choose **Save to my jobs** to add one to your tracked jobs.

Job-board data can be incomplete, delayed, or out of date. Check the original listing for current availability and application details; a recommendation is not a guarantee that a role is still open or a fit.

## LinkedIn job-alert emails

JobFinder can import leads from a LinkedIn job-alert email that you explicitly paste or load from a local `.eml`/text file. The file is read in your browser; only the email text you choose to import is sent to the selected AI provider for extraction, and the server does not retain it. Imported leads appear in **Recommended** with a Google Jobs search and a company-careers search link, so you can verify the role on permitted sources and save it like any other job.

This is not a mailbox connection: JobFinder does not sign in to LinkedIn or your email, fetch alert emails, scrape LinkedIn, or automatically crawl company websites. Remove private material from an email before importing if you do not want the provider to receive it.

## Other job-search tools

- Saves your job-search preferences and resume text (including LaTeX source) in the browser's local storage.
- Lets you open LinkedIn, Indeed, and Google Jobs searches based on your preferred role and location. These are ordinary search links opened for you to review manually, not sources used by **Find more jobs**.
- Saves job links, descriptions, and notes locally, with application status tracking.
- Drafts, copies, or downloads a cover letter using OpenAI, Gemini, or Anthropic. The selected provider receives the profile and job description when you request a draft.

Job discovery is intentionally limited to the public APIs described above. JobFinder does not log into, crawl, or scrape LinkedIn, Indeed, or other job boards. It does not automate applications; open the original listing and review/apply there yourself. Resume upload reads `.txt`, `.md`, and `.tex` files as text; paste text from other resume formats.

GitHub Copilot is not configured as a provider in this MVP. Your local profile and saved jobs are not encrypted and are available to anyone using the same browser profile. Avoid using JobFinder on a shared device.

## Test

```sh
npm test
```
