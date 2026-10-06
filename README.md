# JobFinder

JobFinder is a small, browser-based workspace for shaping your job search, saving roles, tracking applications, and drafting tailored cover letters with an AI provider you choose.

## Run it

Requires Node.js 18 or newer. No third-party packages are needed.

```sh
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The server binds to localhost by default. Set `PORT` to change the port, or set `HOST` to bind another interface. The app has no authentication, so only expose it on a trusted private network.

## Set up AI letter drafting

Add the API key for the provider you want to use to the server environment, then restart JobFinder:

```sh
OPENAI_API_KEY=your-key npm start
```

Supported environment variables are `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY`. Optional model overrides are `OPENAI_MODEL`, `GEMINI_MODEL`, and `ANTHROPIC_MODEL`. Keys stay on the server and are never saved in the browser. The candidate profile and job description are sent to the selected provider only when you request a draft. Review generated text for accuracy before using it.

## What it does

- Saves your job-search preferences and resume text in the browser's local storage.
- Lets you open LinkedIn, Indeed, and Google Jobs searches based on your preferred role and location.
- Saves job links, descriptions, and notes locally, with application status tracking.
- Drafts, copies, or downloads a cover letter using OpenAI, Gemini, or Anthropic.

Job discovery is intentionally user-directed: JobFinder opens searches on job sites, but does not log into, crawl, or scrape LinkedIn or other job boards. Save a listing manually after reviewing it. Resume upload currently reads `.txt` and `.md` files; paste text from other resume formats.

GitHub Copilot is not configured as a provider in this MVP. Your local profile and saved jobs are not encrypted and are available to anyone using the same browser profile. Avoid using JobFinder on a shared device.

## Test

```sh
npm test
```
