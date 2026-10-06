<script lang="ts">
  import { onMount } from 'svelte';

  type Provider = 'openai' | 'gemini' | 'anthropic';
  type ProviderState = { configured: boolean; source: 'saved' | 'environment' | 'none' };
  type JobStatus = 'Saved' | 'Applying' | 'Applied' | 'Interviewing' | 'Archived';
  type Job = {
    id: string;
    title: string;
    company: string;
    url: string;
    description: string;
    notes: string;
    status: JobStatus;
    addedAt: string;
  };
  type Profile = {
    name: string;
    linkedin: string;
    roles: string;
    location: string;
    workStyle: string;
    skills: string;
    priorities: string;
    experience: string;
    resume: string;
  };
  type AutofillProfileField = Exclude<keyof Profile, 'linkedin' | 'resume'>;

  const PROFILE_KEY = 'jobfinder.profile.v1';
  const JOBS_KEY = 'jobfinder.jobs.v1';
  const statuses: JobStatus[] = ['Saved', 'Applying', 'Applied', 'Interviewing', 'Archived'];
  const providers: Provider[] = ['openai', 'gemini', 'anthropic'];
  const providerNames = {
    openai: 'OpenAI',
    gemini: 'Google Gemini',
    anthropic: 'Anthropic Claude',
  };
  const emptyProfile: Profile = {
    name: '',
    linkedin: '',
    roles: '',
    location: '',
    workStyle: '',
    skills: '',
    priorities: '',
    experience: '',
    resume: '',
  };

  function readStorage<T>(key: string, fallback: T): T {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
    } catch {
      return fallback;
    }
  }

  const storedProfile = readStorage<Partial<Profile>>(PROFILE_KEY, {});
  let profile: Profile = { ...emptyProfile, ...storedProfile };
  let jobs = readStorage<Job[]>(JOBS_KEY, []);
  let view: 'dashboard' | 'profile' | 'jobs' | 'settings' = 'dashboard';
  let jobFilter: 'all' | JobStatus = 'all';
  let profileStatus = '';
  let activeJobId: string | null = null;
  let letterDialog: HTMLDialogElement;
  let letterResultField: HTMLTextAreaElement;
  let letterDescription = '';
  let letterProvider: Provider = 'openai';
  let letterResult = '';
  let letterStatus = '';
  let generatingLetter = false;
  let settingsStorageWarning = false;
  let settingsStorageMessage =
    'The saved-key files could not be decrypted. Restore the matching files from backup and restart JobFinder, or remove provider-keys.enc to discard saved keys and try again. Server environment keys can still be used.';
  let providerSettings: Record<Provider, ProviderState> = {
    openai: { configured: false, source: 'none' },
    gemini: { configured: false, source: 'none' },
    anthropic: { configured: false, source: 'none' },
  };
  let providerStatuses: Record<Provider, string> = { openai: '', gemini: '', anthropic: '' };
  let providerKeys: Record<Provider, string> = { openai: '', gemini: '', anthropic: '' };
  let providerBusy: Record<Provider, boolean> = { openai: false, gemini: false, anthropic: false };

  $: inProgressCount = jobs.filter((job) =>
    ['Applying', 'Applied', 'Interviewing'].includes(job.status),
  ).length;
  $: visibleJobs = jobs.filter((job) => jobFilter === 'all' || job.status === jobFilter);

  onMount(() => {
    if (view === 'settings') refreshProviderSettings();
  });

  function persistJobs() {
    localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
  }

  function setView(nextView: typeof view) {
    view = nextView;
    if (nextView === 'settings') refreshProviderSettings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateSearchLink(site: 'linkedin' | 'indeed' | 'google') {
    const role = profile.roles || '';
    const location = profile.location || '';
    const query = [role, location].filter(Boolean).join(' ');
    const encodedRole = encodeURIComponent(role);
    const encodedLocation = encodeURIComponent(location);
    if (site === 'linkedin') {
      return query
        ? `https://www.linkedin.com/jobs/search/?keywords=${encodedRole}&location=${encodedLocation}`
        : 'https://www.linkedin.com/jobs/';
    }
    if (site === 'indeed') {
      return query
        ? `https://www.indeed.com/jobs?q=${encodedRole}&l=${encodedLocation}`
        : 'https://www.indeed.com/';
    }
    return query
      ? `https://www.google.com/search?ibp=htl%3Bjobs&q=${encodeURIComponent(query)}`
      : 'https://www.google.com/search?ibp=htl%3Bjobs';
  }

  function statusClass(status: JobStatus) {
    return `status-${(status || 'Saved').toLowerCase()}`;
  }

  async function refreshProviderSettings(): Promise<void> {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load API key settings.');
      settingsStorageWarning = Boolean(data.storageError);
      for (const provider of providers) {
        const state = data.providers?.[provider];
        if (state) providerSettings = { ...providerSettings, [provider]: state as ProviderState };
      }
    } catch {
      settingsStorageWarning = true;
      settingsStorageMessage =
        'Could not load API key settings. Check the server and private data files.';
      providerStatuses = {
        openai: 'Could not load key status.',
        gemini: 'Could not load key status.',
        anthropic: 'Could not load key status.',
      };
    }
  }

  function settingsResponseError(response: Response, data: { error?: string }): string {
    if (response.status === 403) {
      return `For security, manage API keys from localhost. Open http://127.0.0.1:${location.port || '3000'} in this browser.`;
    }
    return data.error || 'Could not update this API key.';
  }

  async function saveProviderKey(provider: Provider, event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!providerKeys[provider].trim()) {
      providerStatuses = { ...providerStatuses, [provider]: 'Enter an API key first.' };
      return;
    }
    providerBusy = { ...providerBusy, [provider]: true };
    providerStatuses = { ...providerStatuses, [provider]: 'Encrypting and saving…' };
    try {
      const response = await fetch('/api/settings/provider-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key: providerKeys[provider] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(settingsResponseError(response, data));
      providerKeys = { ...providerKeys, [provider]: '' };
      providerStatuses = {
        ...providerStatuses,
        [provider]: 'Saved securely. The key is not shown again.',
      };
      await refreshProviderSettings();
    } catch (error) {
      providerStatuses = {
        ...providerStatuses,
        [provider]: errorMessage(error, 'Could not save this key.'),
      };
    } finally {
      providerBusy = { ...providerBusy, [provider]: false };
    }
  }

  async function removeProviderKey(provider: Provider): Promise<void> {
    providerBusy = { ...providerBusy, [provider]: true };
    providerStatuses = { ...providerStatuses, [provider]: 'Removing saved key…' };
    try {
      const response = await fetch(
        `/api/settings/provider-key?provider=${encodeURIComponent(provider)}`,
        {
          method: 'DELETE',
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(settingsResponseError(response, data));
      providerStatuses = {
        ...providerStatuses,
        [provider]: data.environmentConfigured
          ? 'Saved key removed. The server environment key is still active.'
          : 'Saved key removed.',
      };
      await refreshProviderSettings();
    } catch (error) {
      providerStatuses = {
        ...providerStatuses,
        [provider]: errorMessage(error, 'Could not remove this key.'),
      };
    } finally {
      providerBusy = { ...providerBusy, [provider]: false };
    }
  }

  function saveProfile(event: SubmitEvent): void {
    event.preventDefault();
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    profileStatus = 'Saved — your search is taking shape.';
  }

  function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  async function handleResumeFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const [file] = input.files ?? [];
    if (!file) return;
    if (file.size > 2_000_000) {
      profileStatus = 'That file is over 2 MB. Please paste a shorter resume instead.';
      input.value = '';
      return;
    }
    try {
      profile.resume = await file.text();
      profile = profile;
      profileStatus = `${file.name} loaded. Choose “Autofill from resume” to extract profile details.`;
    } catch {
      profileStatus = 'Could not read that file. Please paste your resume text instead.';
    }
  }

  function limitProfileSource(value: string): string {
    const encoder = new TextEncoder();
    const characters = Array.from(value.trim());
    let content = '';
    let byteLength = 0;
    for (const character of characters) {
      if (content.length >= 20_000) break;
      const characterBytes = encoder.encode(character).byteLength;
      if (byteLength + characterBytes > 40_000) break;
      content += character;
      byteLength += characterBytes;
    }
    return content;
  }

  function makeAutofillRequest(
    provider: Provider,
    source: 'resume' | 'linkedin',
    value: string,
  ): { body: string; shortened: boolean } {
    const original = value.trim();
    const payload = { provider, source, content: limitProfileSource(original) };
    const encoder = new TextEncoder();
    let body = JSON.stringify(payload);
    let shortened = payload.content.length < original.length;
    if (encoder.encode(body).byteLength > 45_000) {
      const characters = Array.from(payload.content);
      let lower = 0;
      let upper = characters.length;
      let best = '';
      while (lower <= upper) {
        const middle = Math.floor((lower + upper) / 2);
        payload.content = characters.slice(0, middle).join('');
        const candidate = JSON.stringify(payload);
        if (encoder.encode(candidate).byteLength <= 45_000) {
          best = payload.content;
          lower = middle + 1;
        } else {
          upper = middle - 1;
        }
      }
      payload.content = best;
      body = JSON.stringify(payload);
      shortened = true;
    }
    return { body, shortened };
  }

  async function autofillProfile(source: 'resume' | 'linkedin', content: string): Promise<void> {
    if (!content.trim()) {
      profileStatus =
        source === 'resume'
          ? 'Upload or paste your resume text first.'
          : 'Paste LinkedIn profile text first.';
      return;
    }
    const providerSelect = document.querySelector<HTMLSelectElement>('#profile-ai-provider');
    if (!providerSelect) return;
    const { body, shortened } = makeAutofillRequest(
      providerSelect.value as Provider,
      source,
      content,
    );
    profileStatus = shortened
      ? 'Extracting details from the first part of your text…'
      : 'Extracting profile details…';
    const button = document.querySelector<HTMLButtonElement>(
      source === 'resume' ? '#autofill-resume' : '#autofill-linkedin',
    );
    if (!button) return;
    button.disabled = true;
    try {
      const response = await fetch('/api/extract-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not extract profile details.');
      let filled = 0;
      for (const [name, value] of Object.entries(data.profile || {}) as [string, unknown][]) {
        if (
          ![
            'name',
            'roles',
            'location',
            'workStyle',
            'skills',
            'priorities',
            'experience',
          ].includes(name) ||
          typeof value !== 'string' ||
          !value.trim()
        ) {
          continue;
        }
        const field = name as AutofillProfileField;
        if (name === 'workStyle') {
          if (profile.workStyle) continue;
          const option = ['Remote', 'Hybrid', 'On-site', 'Flexible'].find(
            (item) => item.toLowerCase() === value.trim().toLowerCase(),
          );
          if (!option) continue;
          profile.workStyle = option;
        } else {
          if (profile[field].trim()) continue;
          profile[field] = value;
        }
        filled += 1;
      }
      profile = profile;
      profileStatus = filled
        ? `${filled} profile field${filled === 1 ? '' : 's'} filled. Review them, then save your profile. Existing entries were left unchanged.${shortened ? ' Only part of the source text was used.' : ''}`
        : `No new fields were added. Existing entries were left unchanged, and unsupported values may need manual entry.${shortened ? ' Only part of the source text was used.' : ''}`;
    } catch (error) {
      profileStatus = errorMessage(error, 'Could not connect to the AI service.');
    } finally {
      button.disabled = false;
    }
  }

  async function autofillLinkedInText(): Promise<void> {
    const textarea = document.querySelector<HTMLTextAreaElement>('#linkedin-profile-text');
    if (textarea) await autofillProfile('linkedin', textarea.value);
  }

  function linkFor(url: string): string {
    try {
      const parsed = new URL(url);
      return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
      return '';
    }
  }

  function saveJob(event: SubmitEvent): void {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const title = String(formData.get('title') ?? '').trim();
    const company = String(formData.get('company') ?? '').trim();
    const safeUrl = linkFor(String(formData.get('url') ?? ''));
    const description = String(formData.get('description') ?? '').trim();
    const notes = String(formData.get('notes') ?? '').trim();
    const urlInput = form.elements.namedItem('url');
    if (!(urlInput instanceof HTMLInputElement)) return;
    if (!safeUrl) {
      urlInput.setCustomValidity('Enter a valid http or https URL.');
      urlInput.reportValidity();
      return;
    }
    urlInput.setCustomValidity('');
    jobs = [
      {
        id: crypto.randomUUID(),
        title,
        company,
        url: safeUrl,
        description,
        notes,
        status: 'Saved',
        addedAt: new Date().toISOString(),
      },
      ...jobs,
    ];
    jobFilter = 'all';
    form.reset();
    persistJobs();
  }

  function updateJobStatus(job: Job, event: Event): void {
    jobs = jobs.map((entry) =>
      entry.id === job.id
        ? { ...entry, status: (event.currentTarget as HTMLSelectElement).value as JobStatus }
        : entry,
    );
    persistJobs();
  }

  function removeJob(jobId: string): void {
    jobs = jobs.filter((job) => job.id !== jobId);
    persistJobs();
  }

  function openLetter(job: Job): void {
    activeJobId = job.id;
    letterDescription = job.description || '';
    letterStatus = '';
    letterResult = '';
    letterDialog.showModal();
  }

  function limitText(value: string, maxLength: number): string {
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
  }

  async function generateLetter(): Promise<void> {
    const job = jobs.find((entry) => entry.id === activeJobId);
    if (!job) return;
    const description = letterDescription.trim();
    if (!description) {
      letterStatus = 'Add the job description first.';
      return;
    }
    generatingLetter = true;
    letterStatus = 'Writing a first draft…';
    try {
      const profileForLetter = {
        name: limitText(profile.name, 200),
        roles: limitText(profile.roles, 500),
        location: limitText(profile.location, 300),
        workStyle: limitText(profile.workStyle, 100),
        experience: limitText(profile.experience, 2_000),
        skills: limitText(profile.skills, 1_000),
        priorities: limitText(profile.priorities, 1_000),
        resume: limitText(profile.resume, 20_000),
        linkedin: limitText(profile.linkedin, 500),
      };
      const payload = {
        provider: letterProvider,
        profile: profileForLetter,
        job: { title: job.title, company: job.company, description },
      };
      const encoder = new TextEncoder();
      const fieldsToShorten: [Record<string, string>, string][] = [
        [payload.profile, 'resume'],
        [payload.job, 'description'],
        [payload.profile, 'experience'],
        [payload.profile, 'priorities'],
        [payload.profile, 'skills'],
      ];
      let body = JSON.stringify(payload);
      for (const [object, field] of fieldsToShorten) {
        if (encoder.encode(body).byteLength <= 45_000) break;
        const original = object[field] ?? '';
        let lower = 0;
        let upper = original.length;
        let best = '';
        while (lower <= upper) {
          const middle = Math.floor((lower + upper) / 2);
          object[field] = original.slice(0, middle);
          const candidate = JSON.stringify(payload);
          if (encoder.encode(candidate).byteLength <= 45_000) {
            best = object[field];
            lower = middle + 1;
          } else {
            upper = middle - 1;
          }
        }
        object[field] = best;
        body = JSON.stringify(payload);
      }
      if (encoder.encode(body).byteLength > 45_000) {
        throw new Error('Shorten the profile or job description before drafting a letter.');
      }
      const response = await fetch('/api/cover-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The letter could not be generated.');
      letterResult = data.letter;
      letterStatus = 'Draft ready — personalize and verify it before sending.';
    } catch (error) {
      letterStatus = errorMessage(error, 'Could not connect to the AI service.');
    } finally {
      generatingLetter = false;
    }
  }

  async function copyLetter(): Promise<void> {
    if (!letterResult) return;
    try {
      await navigator.clipboard.writeText(letterResult);
      letterStatus = 'Copied to clipboard.';
    } catch {
      letterResultField.focus();
      letterResultField.select();
      letterStatus = 'Select the text and copy it.';
    }
  }

  function downloadLetter(): void {
    if (!letterResult) return;
    const job = jobs.find((entry) => entry.id === activeJobId);
    const blob = new Blob([letterResult], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(job?.company || 'cover-letter').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-cover-letter.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
</script>

<div class="app-shell">
  <aside class="sidebar">
    <a class="brand" href="/" aria-label="JobFinder home">
      <span class="brand-mark" aria-hidden="true">j.</span>
      <span>jobfinder</span>
    </a>
    <div class="sidebar-label">WORKSPACE</div>
    <nav class="primary-nav" aria-label="Main navigation">
      <button
        class="nav-item"
        class:is-active={view === 'dashboard'}
        type="button"
        data-view="dashboard"
        onclick={() => setView('dashboard')}
      >
        <span class="nav-icon" aria-hidden="true">⌂</span> Overview
      </button>
      <button
        class="nav-item"
        class:is-active={view === 'profile'}
        type="button"
        data-view="profile"
        onclick={() => setView('profile')}
      >
        <span class="nav-icon" aria-hidden="true">◎</span> My profile
      </button>
      <button
        class="nav-item"
        class:is-active={view === 'jobs'}
        type="button"
        data-view="jobs"
        onclick={() => setView('jobs')}
      >
        <span class="nav-icon" aria-hidden="true">▤</span> Saved jobs
        <span class="nav-count">{jobs.length}</span>
      </button>
      <button
        class="nav-item"
        class:is-active={view === 'settings'}
        type="button"
        data-view="settings"
        onclick={() => setView('settings')}
      >
        <span class="nav-icon" aria-hidden="true">⚙</span> API settings
      </button>
    </nav>
    <div class="sidebar-bottom">
      <div class="privacy-card">
        <span class="privacy-icon" aria-hidden="true">✳</span>
        <strong>Your search, your data</strong>
        <p>Your profile and saved jobs stay in this browser.</p>
      </div>
      <div class="sidebar-foot">A calmer way to find what’s next.</div>
    </div>
  </aside>

  <div class="content-shell">
    <header class="topbar">
      <div class="breadcrumb">
        Personal workspace <span>/</span>
        <strong
          >{{
            dashboard: 'Overview',
            profile: 'My profile',
            jobs: 'Saved jobs',
            settings: 'API settings',
          }[view]}</strong
        >
      </div>
      <a
        class="topbar-link"
        href="#profile"
        data-open-view="profile"
        onclick={(event) => {
          event.preventDefault();
          setView('profile');
        }}>Set up your profile <span aria-hidden="true">↗</span></a
      >
    </header>

    <main>
      {#if view === 'dashboard'}
        <section class="view" id="view-dashboard">
          <div class="page-heading">
            <div>
              <p class="eyebrow">YOUR CAREER, IN FOCUS</p>
              <h1>A clearer path to<br />your <em>next role.</em></h1>
              <p class="heading-copy">
                Keep good opportunities close, understand what fits, and put your best application
                forward.
              </p>
            </div>
            <div class="heading-art" aria-hidden="true">
              <div class="orbit orbit-one"></div>
              <div class="orbit orbit-two"></div>
              <div class="art-star">✳</div>
              <div class="art-note">made for<br />your next</div>
            </div>
          </div>
          <div class="stats-row">
            <article class="stat-card">
              <span class="stat-label">JOBS SAVED</span>
              <strong>{jobs.length}</strong>
              <span class="stat-foot">opportunities to explore</span>
            </article>
            <article class="stat-card">
              <span class="stat-label">IN PROGRESS</span>
              <strong>{inProgressCount}</strong>
              <span class="stat-foot">applications underway</span>
            </article>
            <article class="stat-card stat-card-accent">
              <span class="stat-label">YOUR SEARCH</span>
              <strong>{profile.roles || 'Not set up yet'}</strong>
              <span class="stat-foot">{profile.location || 'Tell us what you’re looking for'}</span>
            </article>
          </div>
          <div class="section-heading">
            <div>
              <p class="eyebrow">START EXPLORING</p>
              <h2>Find roles that feel right</h2>
            </div>
            <button
              class="text-button"
              type="button"
              data-open-view="profile"
              onclick={() => setView('profile')}
              >Tune your search <span aria-hidden="true">→</span></button
            >
          </div>
          <div class="discovery-grid">
            <article class="panel search-panel">
              <div class="panel-icon lilac" aria-hidden="true">⌕</div>
              <div>
                <h3>Search the places you trust</h3>
                <p>
                  Use your role and location to open a focused search. Save interesting listings
                  here to keep track of them.
                </p>
                <div class="search-links">
                  <a
                    class="search-link"
                    href={updateSearchLink('linkedin')}
                    target="_blank"
                    rel="noopener noreferrer">LinkedIn <span aria-hidden="true">↗</span></a
                  >
                  <a
                    class="search-link"
                    href={updateSearchLink('indeed')}
                    target="_blank"
                    rel="noopener noreferrer">Indeed <span aria-hidden="true">↗</span></a
                  >
                  <a
                    class="search-link"
                    href={updateSearchLink('google')}
                    target="_blank"
                    rel="noopener noreferrer">Google Jobs <span aria-hidden="true">↗</span></a
                  >
                </div>
              </div>
            </article>
            <article class="panel add-prompt">
              <div class="panel-icon peach" aria-hidden="true">＋</div>
              <div>
                <h3>Found something promising?</h3>
                <p>Save the role, add your notes, and come back when you’re ready to apply.</p>
                <button
                  class="button button-dark button-small"
                  type="button"
                  data-open-view="jobs"
                  onclick={() => setView('jobs')}
                  >Add a job <span aria-hidden="true">→</span></button
                >
              </div>
            </article>
          </div>
          <div class="section-heading recent-heading">
            <div>
              <p class="eyebrow">A LITTLE MOMENTUM</p>
              <h2>Your recent saves</h2>
            </div>
            <button
              class="text-button"
              type="button"
              data-open-view="jobs"
              onclick={() => setView('jobs')}>View all <span aria-hidden="true">→</span></button
            >
          </div>
          <div class="recent-list" id="recent-list">
            {#each jobs.slice(0, 3) as job (job.id)}
              <article class="recent-item">
                <span class="company-mark"
                  >{(job.company || '?').trim().slice(0, 1).toUpperCase()}</span
                >
                <div class="recent-details">
                  <strong>{job.title}</strong><span>{job.company}</span>
                </div>
                <span class={`status-pill ${statusClass(job.status)}`}>{job.status || 'Saved'}</span
                >
                <button class="recent-open" type="button" onclick={() => setView('jobs')}
                  >View →</button
                >
              </article>
            {:else}
              <div class="recent-empty">Your saved roles will show up here.</div>
            {/each}
          </div>
        </section>
      {/if}

      {#if view === 'profile'}
        <section class="view" id="view-profile">
          <div class="inner-heading">
            <p class="eyebrow">A SEARCH THAT FITS YOU</p>
            <h1>Let’s get to know <em>you.</em></h1>
            <p class="heading-copy">
              A few thoughtful details help you find roles that match your experience and the life
              you want.
            </p>
          </div>
          <div class="form-note">
            <span aria-hidden="true">✳</span>
            <div>
              <strong>Your profile stays in this browser.</strong> When you choose AI autofill or draft
              a letter, the text you submit is sent to the selected provider. Your API key stays on the
              server; review extracted details before saving.
            </div>
          </div>
          <form class="profile-form" id="profile-form" onsubmit={saveProfile}>
            <div class="form-section">
              <div class="form-section-heading">
                <span class="step-number">01</span>
                <div>
                  <h2>Start with the basics</h2>
                  <p>How should your next opportunity look?</p>
                </div>
              </div>
              <div class="form-grid">
                <label class="field"
                  ><span>Your name</span><input
                    name="name"
                    autocomplete="name"
                    placeholder="e.g. Alex Morgan"
                    bind:value={profile.name}
                  /></label
                >
                <label class="field"
                  ><span>LinkedIn profile URL</span><input
                    name="linkedin"
                    type="url"
                    placeholder="https://www.linkedin.com/in/…"
                    bind:value={profile.linkedin}
                  /><small class="field-hint"
                    >LinkedIn does not allow importing a profile from its URL alone. Open your
                    profile, copy its text, and paste it below.</small
                  ></label
                >
                <label class="field field-wide"
                  ><span>Roles you’re interested in</span><input
                    name="roles"
                    placeholder="e.g. Product Designer, UX Lead"
                    bind:value={profile.roles}
                  /></label
                >
                <label class="field"
                  ><span>Where would you like to work?</span><input
                    name="location"
                    placeholder="e.g. Amsterdam, Remote"
                    bind:value={profile.location}
                  /></label
                >
                <label class="field"
                  ><span>Work style</span><select name="workStyle" bind:value={profile.workStyle}
                    ><option value="">Choose what suits you</option><option value="Remote"
                      >Remote</option
                    ><option value="Hybrid">Hybrid</option><option value="On-site">On-site</option
                    ><option value="Flexible">Flexible</option></select
                  ></label
                >
                <label class="field field-wide"
                  ><span>Industries or skills you’d like to use</span><input
                    name="skills"
                    placeholder="e.g. Climate tech, Figma, user research"
                    bind:value={profile.skills}
                  /></label
                >
                <label class="field field-wide"
                  ><span>What kind of work brings out your best?</span><textarea
                    name="priorities"
                    rows="3"
                    placeholder="Think about the problems you enjoy, the team culture you value, or what you want more of in your next role."
                    bind:value={profile.priorities}
                  ></textarea></label
                >
                <label class="field field-wide"
                  ><span>Experience and strengths</span><textarea
                    name="experience"
                    rows="3"
                    placeholder="A short summary of your experience, accomplishments, and strengths."
                    bind:value={profile.experience}
                  ></textarea></label
                >
              </div>
            </div>
            <div class="form-section resume-section">
              <div class="form-section-heading">
                <span class="step-number">02</span>
                <div>
                  <h2>Bring your experience along</h2>
                  <p>
                    Upload a .txt, .md, or LaTeX .tex resume, or paste its text. Choose an AI
                    provider to suggest profile details.
                  </p>
                </div>
              </div>
              <label class="upload-control" for="resume-file"
                ><span class="upload-symbol" aria-hidden="true">↑</span><span
                  ><strong>Choose a resume file</strong><small
                    >.txt, .md, and .tex files are read locally in your browser</small
                  ></span
                ><input
                  id="resume-file"
                  type="file"
                  accept=".txt,.md,.tex,text/plain,text/markdown,text/x-tex,application/x-tex"
                  onchange={handleResumeFile}
                /></label
              >
              <label class="field"
                ><span>Resume text or LaTeX source</span><textarea
                  name="resume"
                  rows="9"
                  placeholder="Paste the relevant parts of your CV or its LaTeX source here."
                  bind:value={profile.resume}
                ></textarea></label
              >
              <div class="autofill-controls">
                <label class="field"
                  ><span>AI provider</span><select id="profile-ai-provider"
                    ><option value="openai">OpenAI</option><option value="gemini"
                      >Google Gemini</option
                    ><option value="anthropic">Anthropic Claude</option></select
                  ></label
                ><button
                  class="button button-dark"
                  id="autofill-resume"
                  type="button"
                  onclick={() => autofillProfile('resume', profile.resume)}
                  >Autofill from resume <span aria-hidden="true">✳</span></button
                >
              </div>
            </div>
            <div class="form-section linkedin-import-section">
              <div class="form-section-heading">
                <span class="step-number">03</span>
                <div>
                  <h2>Or bring in LinkedIn details</h2>
                  <p>
                    For privacy and access reasons, the app can’t read a LinkedIn profile from its
                    URL. Paste profile text you choose to share.
                  </p>
                </div>
              </div>
              <label class="field"
                ><span>Copied LinkedIn profile text</span><textarea
                  id="linkedin-profile-text"
                  rows="7"
                  placeholder="Open your LinkedIn profile, copy the relevant text, and paste it here."
                ></textarea></label
              >
              <div class="autofill-controls">
                <span class="field-hint"
                  >Only this pasted text is sent when you choose autofill.</span
                ><button
                  class="button button-dark"
                  id="autofill-linkedin"
                  type="button"
                  onclick={autofillLinkedInText}
                  >Autofill from LinkedIn text <span aria-hidden="true">✳</span></button
                >
              </div>
            </div>
            <div class="form-actions">
              <span id="profile-status" class="status-message" role="status">{profileStatus}</span
              ><button class="button button-dark" type="submit"
                >Save my profile <span aria-hidden="true">→</span></button
              >
            </div>
          </form>
        </section>
      {/if}

      {#if view === 'jobs'}
        <section class="view" id="view-jobs">
          <div class="inner-heading jobs-heading">
            <div>
              <p class="eyebrow">YOUR OPPORTUNITY LIST</p>
              <h1>Good things, <em>gathered.</em></h1>
              <p class="heading-copy">
                Save roles you find, jot down what stands out, and keep your application moving.
              </p>
            </div>
            <div class="saved-count"><strong>{jobs.length}</strong><span>saved roles</span></div>
          </div>
          <div class="jobs-layout">
            <section class="panel job-form-panel">
              <p class="eyebrow">SAVE AN OPPORTUNITY</p>
              <h2>Keep it on your radar</h2>
              <form id="job-form" onsubmit={saveJob}>
                <label class="field"
                  ><span>Job title *</span><input
                    name="title"
                    required
                    maxlength="200"
                    placeholder="e.g. Senior Product Designer"
                  /></label
                >
                <label class="field"
                  ><span>Company *</span><input
                    name="company"
                    required
                    maxlength="200"
                    placeholder="Company name"
                  /></label
                >
                <label class="field"
                  ><span>Job listing URL *</span><input
                    name="url"
                    type="url"
                    required
                    placeholder="https://…"
                  /></label
                >
                <label class="field"
                  ><span>Job description</span><textarea
                    name="description"
                    rows="5"
                    maxlength="15000"
                    placeholder="Paste the listing here to use it when drafting a cover letter."
                  ></textarea></label
                >
                <label class="field"
                  ><span>Your notes</span><textarea
                    name="notes"
                    rows="3"
                    placeholder="What caught your eye? Anything to ask about?"
                  ></textarea></label
                >
                <button class="button button-dark button-full" type="submit"
                  >Save this role <span aria-hidden="true">→</span></button
                >
                <p class="form-footnote">
                  Job listings are saved manually. We don’t log into or scrape job sites.
                </p>
              </form>
            </section>
            <section class="job-list-section">
              <div class="list-toolbar">
                <h2>Saved roles <span id="list-count">({jobs.length})</span></h2>
                <label class="sr-only" for="job-filter">Filter saved jobs</label><select
                  id="job-filter"
                  aria-label="Filter saved jobs"
                  bind:value={jobFilter}
                  ><option value="all">All roles</option><option value="Saved">Saved</option><option
                    value="Applying">Applying</option
                  ><option value="Applied">Applied</option><option value="Interviewing"
                    >Interviewing</option
                  ><option value="Archived">Archived</option></select
                >
              </div>
              <div class="job-list" id="job-list">
                {#if jobs.length === 0}
                  <div class="empty-state">
                    <span class="empty-mark">✳</span>
                    <h3>Your next possibility starts here.</h3>
                    <p>
                      Save a job listing on the left to keep it close and start planning your next
                      step.
                    </p>
                  </div>
                {:else if visibleJobs.length === 0}
                  <div class="empty-state compact-empty">No saved jobs match this filter.</div>
                {/if}
                {#each visibleJobs as job (job.id)}
                  <article class="job-card">
                    <div class="job-card-top">
                      <div class="job-company">
                        <span class="company-mark"
                          >{(job.company || '?').trim().slice(0, 1).toUpperCase()}</span
                        >
                        <div>
                          <h3>{job.title}</h3>
                          <p>{job.company}</p>
                        </div>
                      </div>
                      <select
                        class={`status-select ${statusClass(job.status)}`}
                        aria-label={`Application status for ${job.title} at ${job.company}`}
                        value={job.status}
                        onchange={(event) => updateJobStatus(job, event)}
                      >
                        {#each statuses as status (status)}<option value={status}>{status}</option
                          >{/each}
                      </select>
                    </div>
                    {#if job.notes}<p class="job-notes">{job.notes}</p>{/if}
                    <div class="job-card-footer">
                      {#if linkFor(job.url)}
                        <a
                          class="job-action-link"
                          href={linkFor(job.url)}
                          target="_blank"
                          rel="noopener noreferrer">View listing ↗</a
                        >
                      {/if}
                      <button class="job-action-link" type="button" onclick={() => openLetter(job)}
                        >Draft cover letter ✳</button
                      >
                      <button class="job-remove" type="button" onclick={() => removeJob(job.id)}
                        >Remove</button
                      >
                    </div>
                  </article>
                {/each}
              </div>
            </section>
          </div>
        </section>
      {/if}

      {#if view === 'settings'}
        <section class="view" id="view-settings">
          <div class="inner-heading">
            <p class="eyebrow">PRIVATE PROVIDER SETUP</p>
            <h1>Your keys, <em>your control.</em></h1>
            <p class="heading-copy">
              Add an AI provider key here once. JobFinder keeps it on the server and encrypts it
              before saving.
            </p>
          </div>
          <div class="form-note settings-note">
            <span aria-hidden="true">✳</span>
            <div>
              <strong>Encrypted at rest, never sent back to this page.</strong> Keys are encrypted with
              AES-256-GCM and stored in a private local data folder. They are decrypted only by the server
              when an AI request needs them. Anyone with access to this server account can access its
              files and use the app.
            </div>
          </div>
          {#if settingsStorageWarning}
            <div
              class="form-note settings-note settings-error"
              id="settings-storage-warning"
              role="alert"
            >
              <span aria-hidden="true">!</span>
              <div>
                <strong>Saved key storage needs attention.</strong>
                <span id="settings-storage-message">{settingsStorageMessage}</span>
              </div>
            </div>
          {/if}
          <div class="settings-provider-list">
            {#each providers as provider (provider)}
              <article class="panel provider-card" data-provider-card={provider}>
                <div class="provider-heading">
                  <div class:gemini-symbol={provider === 'gemini'} class="provider-symbol">
                    {provider === 'openai' ? 'O' : provider === 'gemini' ? 'G' : 'A'}
                  </div>
                  <div>
                    <h2>{providerNames[provider]}</h2>
                    <p class="provider-state" id={`provider-state-${provider}`}>
                      {providerStatuses[provider] ||
                        (providerSettings[provider].source === 'saved'
                          ? 'A saved key is encrypted on this server.'
                          : providerSettings[provider].source === 'environment'
                            ? 'Using a key from the server environment.'
                            : providerSettings[provider].configured === false
                              ? 'No key configured.'
                              : 'Checking key status…')}
                    </p>
                  </div>
                </div>
                <form
                  class="provider-key-form"
                  data-provider={provider}
                  onsubmit={(event) => saveProviderKey(provider, event)}
                >
                  <label class="field"
                    ><span>API key</span><input
                      type="password"
                      name="key"
                      maxlength="1000"
                      autocomplete="new-password"
                      autocapitalize="off"
                      spellcheck="false"
                      placeholder={`Paste your ${providerNames[provider]} API key`}
                      bind:value={providerKeys[provider]}
                    /></label
                  >
                  <div class="provider-actions">
                    <span class="status-message" role="status">{providerStatuses[provider]}</span
                    ><button
                      class="button button-dark"
                      type="submit"
                      disabled={providerBusy[provider]}>Save key</button
                    ><button
                      class="text-button remove-provider-key"
                      type="button"
                      hidden={providerSettings[provider].source !== 'saved'}
                      disabled={providerBusy[provider]}
                      onclick={() => removeProviderKey(provider)}>Remove saved key</button
                    >
                  </div>
                </form>
              </article>
            {/each}
          </div>
          <p class="settings-warning">
            JobFinder has no sign-in or multi-user protection. Keep it on your own computer at <code
              >127.0.0.1</code
            >; don’t expose this page on a public network. Your keys are not stored in browser
            storage.
          </p>
        </section>
      {/if}
    </main>
    <footer class="app-footer">
      <span>JobFinder</span><span>Find a role that feels like your next chapter.</span>
    </footer>
  </div>
</div>

<dialog class="letter-dialog" bind:this={letterDialog} aria-labelledby="letter-title">
  <form method="dialog" class="dialog-close-form">
    <button class="dialog-close" aria-label="Close">×</button>
  </form>
  <p class="eyebrow">APPLICATION STUDIO</p>
  <h2 id="letter-title">Let’s make it <em>personal.</em></h2>
  <p class="dialog-intro">
    Your profile and this job description will be sent to the AI provider you select to create a
    first draft. Review every detail before using it.
  </p>
  <div class="letter-settings">
    <label class="field"
      ><span>AI provider</span><select bind:value={letterProvider}
        ><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option><option
          value="anthropic">Anthropic Claude</option
        ></select
      ></label
    >
    <label class="field"
      ><span>Job description</span><textarea
        rows="5"
        placeholder="Paste the job description here"
        bind:value={letterDescription}
      ></textarea></label
    >
  </div>
  <div class="dialog-actions">
    <span class="status-message" id="letter-status" role="status">{letterStatus}</span><button
      class="button button-dark"
      id="generate-letter"
      type="button"
      disabled={generatingLetter}
      onclick={generateLetter}>Draft my letter <span aria-hidden="true">✳</span></button
    >
  </div>
  <label class="field letter-result-field" for="letter-result"
    ><span>Your draft</span><textarea
      id="letter-result"
      rows="10"
      readonly
      placeholder="Your cover letter draft will appear here."
      bind:this={letterResultField}
      bind:value={letterResult}
    ></textarea></label
  >
  <div class="letter-result-actions">
    <button class="text-button" id="copy-letter" type="button" onclick={copyLetter}
      >Copy letter <span aria-hidden="true">↗</span></button
    ><button class="text-button" id="download-letter" type="button" onclick={downloadLetter}
      >Download .txt <span aria-hidden="true">↓</span></button
    >
  </div>
</dialog>
