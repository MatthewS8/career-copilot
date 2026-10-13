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
  type ChatMessage = { role: 'user' | 'assistant'; content: string };
  type Suggestion = {
    id: string;
    title: string;
    company: string;
    location: string;
    url: string;
    description: string;
    source: string;
    postedAt?: string;
    score: number;
    reason: string;
    companySearchUrl?: string;
  };

  const PROFILE_KEY = 'jobfinder.profile.v1';
  const JOBS_KEY = 'jobfinder.jobs.v1';
  const CHAT_KEY = 'jobfinder.chat.v1';
  const SUGGESTIONS_KEY = 'jobfinder.suggestions.v1';
  const HIDDEN_JOBS_KEY = 'jobfinder.hidden-job-urls.v1';
  const ONBOARDING_KEY = 'jobfinder.onboarding.v1';
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
  let chatMessages = readStorage<ChatMessage[]>(CHAT_KEY, []);
  let suggestions = readStorage<Suggestion[]>(SUGGESTIONS_KEY, []);
  let hiddenJobUrls = new Set(
    readStorage<unknown[]>(HIDDEN_JOBS_KEY, []).filter(
      (url): url is string => typeof url === 'string' && Boolean(linkFor(url)),
    ),
  );
  let alertSuggestions = readStorage<string[]>('jobfinder.linkedin-alert-suggestions.v1', []);
  let linkedinAlertText = '';
  let linkedinAlertStatus = '';
  let importingLinkedinAlert = false;
  let onboardingStep = readStorage<number>(ONBOARDING_KEY, 0);
  let chatInput = '';
  let chatProvider: Provider = 'openai';
  let chatBusy = false;
  let chatStatus = '';
  let discoveredSkills: string[] = [];
  let findingJobs = false;
  let suggestionsStatus = '';
  let view:
    | 'dashboard'
    | 'profile'
    | 'jobs'
    | 'settings'
    | 'recruiter'
    | 'suggestions'
    | 'linkedin-alerts'
    | 'onboarding' = onboardingStep < 4 ? 'onboarding' : 'dashboard';
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
    void refreshProviderSettings();
  });

  function persistJobs() {
    localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
  }

  function setView(nextView: typeof view) {
    view = nextView;
    if (nextView === 'settings') refreshProviderSettings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function completeOnboarding(): void {
    onboardingStep = 4;
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(onboardingStep));
    setView('dashboard');
  }

  function advanceOnboarding(step: number): void {
    onboardingStep = step;
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(onboardingStep));
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
      if (!providerSettings[chatProvider].configured) {
        chatProvider = providers.find((name) => providerSettings[name].configured) ?? chatProvider;
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
      return (
        data.error ||
        `For security, manage API keys from localhost. Open http://127.0.0.1:${location.port || '3000'} in this browser.`
      );
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

  function persistChat(): void {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chatMessages));
  }

  function clearRecruiterConversation(): void {
    if (
      !window.confirm(
        'Clear this recruiter conversation and its unadded suggestions from this browser? This cannot remove information already sent to an AI provider.',
      )
    ) {
      return;
    }
    chatMessages = [];
    discoveredSkills = [];
    alertSuggestions = [];
    chatInput = '';
    chatStatus = 'Conversation cleared from this browser.';
    localStorage.removeItem(CHAT_KEY);
    localStorage.removeItem('jobfinder.linkedin-alert-suggestions.v1');
  }

  function persistSuggestions(): void {
    localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(suggestions));
  }

  async function requestRecruiterReply(): Promise<void> {
    chatBusy = true;
    chatStatus = '';
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: chatProvider,
          profile,
          messages: chatMessages.slice(-30),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The recruiter could not reply.');
      chatMessages = [...chatMessages, { role: 'assistant', content: String(data.reply) }];
      persistChat();
      const known = profile.skills.toLowerCase();
      const found = (Array.isArray(data.skills) ? (data.skills as string[]) : []).filter(
        (skill) => !known.includes(skill.toLowerCase()),
      );
      discoveredSkills = [...new Set([...discoveredSkills, ...found])];
      if (Array.isArray(data.alertSuggestions)) {
        alertSuggestions = (data.alertSuggestions as unknown[])
          .filter((suggestion): suggestion is string => typeof suggestion === 'string')
          .map((suggestion) => suggestion.trim())
          .filter(Boolean)
          .slice(0, 5);
        localStorage.setItem(
          'jobfinder.linkedin-alert-suggestions.v1',
          JSON.stringify(alertSuggestions),
        );
      }
    } catch (error) {
      chatStatus = errorMessage(error, 'The recruiter could not reply.');
    } finally {
      chatBusy = false;
    }
  }

  async function sendChatMessage(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const content = chatInput.trim();
    if (!content || chatBusy) return;
    chatMessages = [...chatMessages, { role: 'user', content }];
    chatInput = '';
    persistChat();
    await requestRecruiterReply();
  }

  async function restartChat(): Promise<void> {
    if (
      chatMessages.length &&
      !window.confirm(
        'Start a new recruiter interview? This clears the current conversation from this browser.',
      )
    ) {
      return;
    }
    chatMessages = [];
    discoveredSkills = [];
    alertSuggestions = [];
    persistChat();
    localStorage.removeItem('jobfinder.linkedin-alert-suggestions.v1');
    await requestRecruiterReply();
  }

  function addDiscoveredSkill(skill: string): void {
    profile = {
      ...profile,
      skills: [profile.skills.trim(), skill].filter(Boolean).join(', '),
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    discoveredSkills = discoveredSkills.filter((entry) => entry !== skill);
  }

  function dismissDiscoveredSkill(skill: string): void {
    discoveredSkills = discoveredSkills.filter((entry) => entry !== skill);
  }

  function changeChatProvider(event: Event): void {
    chatProvider = (event.currentTarget as HTMLSelectElement).value as Provider;
    chatStatus = chatMessages.length
      ? `Next reply will send your profile and the latest conversation messages to ${providerNames[chatProvider]}.`
      : '';
  }

  async function findJobs(): Promise<void> {
    findingJobs = true;
    suggestionsStatus = 'Searching job boards and matching them to you…';
    try {
      const response = await fetch('/api/find-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: chatProvider,
          profile,
          messages: chatMessages.slice(-10),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not find jobs.');
      const known = new Set([
        ...suggestions.map((entry) => entry.url),
        ...jobs.map((entry) => entry.url),
        ...hiddenJobUrls,
      ]);
      const fresh = (data.jobs as Omit<Suggestion, 'id'>[])
        .filter((job) => !known.has(job.url))
        .map((job) => ({ ...job, id: crypto.randomUUID() }));
      suggestions = [...fresh, ...suggestions];
      persistSuggestions();
      suggestionsStatus = fresh.length
        ? `Found ${fresh.length} new ${fresh.length === 1 ? 'match' : 'matches'}.`
        : 'No new matches right now. Try again later or refine your profile.';
      if (fresh.length) setView('suggestions');
    } catch (error) {
      suggestionsStatus = errorMessage(error, 'Could not find jobs.');
    } finally {
      findingJobs = false;
    }
  }

  function companyCareerSearch(title: string, company: string): string {
    return `https://www.google.com/search?q=${encodeURIComponent(`${company} careers ${title}`)}`;
  }

  async function handleLinkedinAlertFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const [file] = input.files ?? [];
    if (!file) return;
    if (file.size > 2_000_000) {
      linkedinAlertStatus =
        'That email file is over 2 MB. Paste only the job-alert portion instead.';
      input.value = '';
      return;
    }
    try {
      linkedinAlertText = await file.text();
      linkedinAlertStatus = `${file.name} loaded locally. Review or trim it before importing.`;
    } catch {
      linkedinAlertStatus = 'Could not read that email file. Paste the alert text instead.';
    }
  }

  async function importLinkedinAlert(): Promise<void> {
    const email = linkedinAlertText.trim();
    if (!email || importingLinkedinAlert) return;
    importingLinkedinAlert = true;
    linkedinAlertStatus = 'Reading the alert and preparing safe search links…';
    try {
      const response = await fetch('/api/import-linkedin-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: chatProvider, email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not read that job alert.');
      const known = new Set([
        ...suggestions.map((entry) => entry.url),
        ...jobs.map((entry) => entry.url),
        ...hiddenJobUrls,
      ]);
      const fresh = (data.jobs as Omit<Suggestion, 'id'>[])
        .map((job) => ({
          ...job,
          url: job.url || updateSearchLink('google'),
          companySearchUrl: job.companySearchUrl || companyCareerSearch(job.title, job.company),
          id: crypto.randomUUID(),
        }))
        .filter((job) => !known.has(job.url));
      suggestions = [...fresh, ...suggestions];
      persistSuggestions();
      linkedinAlertStatus = fresh.length
        ? `Added ${fresh.length} lead${fresh.length === 1 ? '' : 's'} to Recommended. Open the company-career search to verify each listing.`
        : 'No new leads were found in that alert.';
    } catch (error) {
      linkedinAlertStatus = errorMessage(error, 'Could not read that job alert.');
    } finally {
      importingLinkedinAlert = false;
    }
  }

  function saveSuggestion(suggestion: Suggestion): void {
    jobs = [
      {
        id: crypto.randomUUID(),
        title: suggestion.title,
        company: suggestion.company,
        url: suggestion.url,
        description: suggestion.description,
        notes: suggestion.reason,
        status: 'Saved',
        addedAt: new Date().toISOString(),
      },
      ...jobs,
    ];
    persistJobs();
    dismissSuggestion(suggestion.id);
  }

  function dismissSuggestion(id: string): void {
    suggestions = suggestions.filter((entry) => entry.id !== id);
    persistSuggestions();
  }

  function hideSuggestion(suggestion: Suggestion): void {
    hiddenJobUrls.add(suggestion.url);
    hiddenJobUrls = hiddenJobUrls;
    localStorage.setItem(HIDDEN_JOBS_KEY, JSON.stringify([...hiddenJobUrls]));
    dismissSuggestion(suggestion.id);
    suggestionsStatus = 'Job hidden. It will not be suggested again from the same listing.';
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
        class:is-active={view === 'recruiter'}
        type="button"
        data-view="recruiter"
        onclick={() => setView('recruiter')}
      >
        <span class="nav-icon" aria-hidden="true">✎</span> AI recruiter
      </button>
      <button
        class="nav-item"
        class:is-active={view === 'suggestions'}
        type="button"
        data-view="suggestions"
        onclick={() => setView('suggestions')}
      >
        <span class="nav-icon" aria-hidden="true">★</span> Recommended
        <span class="nav-count">{suggestions.length}</span>
      </button>
      <button
        class="nav-item"
        class:is-active={view === 'linkedin-alerts'}
        type="button"
        data-view="linkedin-alerts"
        onclick={() => setView('linkedin-alerts')}
      >
        <span class="nav-icon" aria-hidden="true">✉</span> LinkedIn alerts
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
            recruiter: 'AI recruiter',
            suggestions: 'Recommended jobs',
            'linkedin-alerts': 'LinkedIn alerts',
            onboarding: 'Getting started',
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
      {#if view === 'onboarding'}
        <section class="view onboarding-view" id="view-onboarding">
          <p class="eyebrow">WELCOME TO JOBFINDER</p>
          <h1>Build your search<br />with <em>intention.</em></h1>
          <p class="heading-copy">
            Set up the essentials in a few focused steps. You can skip any of them and return
            whenever you are ready.
          </p>
          <div class="onboarding-steps" aria-label="Getting started progress">
            {#each ['AI key', 'Your CV', 'Recruiter chat', 'Recommendations'] as label, index}
              <span class:current={onboardingStep === index} class:complete={onboardingStep > index}
                >{index + 1}. {label}</span
              >
            {/each}
          </div>
          <article class="panel onboarding-card">
            {#if onboardingStep === 0}
              <p class="eyebrow">STEP 1 OF 4</p>
              <h2>Add an AI provider key</h2>
              <p>
                Choose the provider you want to use. Your key is encrypted on this computer and is
                never shown again.
              </p>
              <label class="field"
                ><span>Provider</span><select bind:value={chatProvider}
                  >{#each providers as provider}<option value={provider}
                      >{providerNames[provider]}</option
                    >{/each}</select
                ></label
              >
              {#if providerSettings[chatProvider].configured}
                <p class="status-message">{providerNames[chatProvider]} is ready.</p>
                <button
                  class="button button-dark"
                  type="button"
                  onclick={() => advanceOnboarding(1)}>Continue to your CV →</button
                >
              {:else}
                <form
                  class="provider-key-form"
                  onsubmit={(event) => saveProviderKey(chatProvider, event)}
                >
                  <label class="field"
                    ><span>API key</span><input
                      type="password"
                      autocomplete="off"
                      bind:value={providerKeys[chatProvider]}
                      placeholder="Paste your key"
                    /></label
                  >
                  <div class="provider-actions">
                    <span class="status-message">{providerStatuses[chatProvider]}</span><button
                      class="button button-dark"
                      type="submit"
                      disabled={providerBusy[chatProvider]}>Save key</button
                    >
                  </div>
                </form>
              {/if}
            {:else if onboardingStep === 1}
              <p class="eyebrow">STEP 2 OF 4</p>
              <h2>Bring your CV</h2>
              <p>
                Upload a plain-text, Markdown, or LaTeX CV, or paste its text. It stays in this
                browser until you choose an AI action.
              </p>
              <label class="upload-control" for="onboarding-resume"
                ><span class="upload-symbol" aria-hidden="true">↑</span><span
                  ><strong>Choose a resume file</strong><small
                    >.txt, .md, and .tex are read locally</small
                  ></span
                ><input
                  id="onboarding-resume"
                  type="file"
                  accept=".txt,.md,.tex,text/plain,text/markdown,text/x-tex,application/x-tex"
                  onchange={handleResumeFile}
                /></label
              >
              <label class="field"
                ><span>Resume text</span><textarea
                  rows="8"
                  bind:value={profile.resume}
                  placeholder="Paste your CV here."
                ></textarea></label
              >
              <div class="provider-actions">
                <button class="text-button" type="button" onclick={() => advanceOnboarding(2)}
                  >Skip for now</button
                ><button
                  class="button button-dark"
                  type="button"
                  onclick={() => {
                    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
                    advanceOnboarding(2);
                  }}>Continue to recruiter →</button
                >
              </div>
            {:else if onboardingStep === 2}
              <p class="eyebrow">STEP 3 OF 4</p>
              <h2>Have a focused recruiter chat</h2>
              <p>
                Tell the recruiter about the work you want next. It will turn your profile and
                answers into a better search plan, including LinkedIn alert ideas.
              </p>
              <div class="provider-actions">
                <button class="text-button" type="button" onclick={() => advanceOnboarding(3)}
                  >Skip for now</button
                ><button
                  class="button button-dark"
                  type="button"
                  disabled={!providerSettings[chatProvider].configured}
                  onclick={() => {
                    setView('recruiter');
                    if (!chatMessages.length) void restartChat();
                  }}>Start the chat →</button
                >
              </div>
            {:else}
              <p class="eyebrow">STEP 4 OF 4</p>
              <h2>Your search is ready to take shape.</h2>
              <p>
                Review roles from public job boards, bring in job alerts you receive, and verify
                promising roles on the company careers page.
              </p>
              <div class="provider-actions">
                <button class="text-button" type="button" onclick={completeOnboarding}
                  >Go to overview</button
                ><button
                  class="button button-dark"
                  type="button"
                  disabled={findingJobs || !providerSettings[chatProvider].configured}
                  onclick={() => {
                    void findJobs();
                    completeOnboarding();
                  }}>Find recommendations →</button
                >
              </div>
            {/if}
            <button class="onboarding-skip" type="button" onclick={completeOnboarding}
              >Set this up later</button
            >
          </article>
        </section>
      {/if}

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

      {#if view === 'recruiter'}
        <section class="view" id="view-recruiter">
          <div class="inner-heading">
            <p class="eyebrow">YOUR AI RECRUITER</p>
            <h1>Tell your story, <em>get found.</em></h1>
            <p class="heading-copy">
              The recruiter reviews your profile, asks about your experience in detail and points
              out skills you may have overlooked.
            </p>
          </div>
          <div class="form-note recruiter-data-note">
            <span aria-hidden="true">✳</span>
            <div>
              <strong>What is shared when you send a message.</strong> Your current profile (including
              any resume text) and up to the latest 30 recruiter messages are sent to the selected
              provider to generate a reply. They remain in this browser until you clear them; the
              provider handles submitted content under its own data policy. Skills are not added to
              your profile unless you choose to add them.
            </div>
          </div>
          <article class="panel chat-panel">
            <div class="chat-toolbar">
              <label class="field"
                ><span>AI provider</span><select
                  value={chatProvider}
                  disabled={chatBusy}
                  onchange={changeChatProvider}
                  >{#each providers as provider (provider)}<option value={provider}
                      >{providerNames[provider]}{providerSettings[provider].configured
                        ? ''
                        : ' (no key)'}</option
                    >{/each}</select
                ></label
              >
              <button
                class="button button-dark"
                type="button"
                disabled={chatBusy || !providerSettings[chatProvider].configured}
                onclick={restartChat}
                >{chatMessages.length ? 'Restart interview' : 'Start interview'}</button
              >
              <button
                class="text-button chat-clear"
                type="button"
                disabled={
                  chatBusy || (!chatMessages.length && !discoveredSkills.length && !alertSuggestions.length)
                }
                onclick={clearRecruiterConversation}>Clear chat</button
              >
              <button
                class="button button-dark"
                type="button"
                disabled={findingJobs || !providerSettings[chatProvider].configured}
                onclick={findJobs}>{findingJobs ? 'Searching…' : 'Find jobs for me'}</button
              >
            </div>
            {#if !providerSettings[chatProvider].configured}
              <p class="status-message" role="status">
                Add an API key for this provider in API settings first.
              </p>
            {/if}
            <div class="chat-log" aria-live="polite">
              {#each chatMessages as message, index (index)}
                <div class={`chat-message chat-${message.role}`}>
                  <strong>{message.role === 'user' ? 'You' : 'Recruiter'}</strong>
                  <p>{message.content}</p>
                </div>
              {/each}
              {#if chatBusy}<p class="status-message">The recruiter is typing…</p>{/if}
            </div>
            {#if discoveredSkills.length}
              <div class="skill-suggestions">
                <strong>Skills the recruiter spotted — add to your profile?</strong>
                {#each discoveredSkills as skill (skill)}
                  <button
                    class="job-action-link"
                    type="button"
                    onclick={() => addDiscoveredSkill(skill)}>+ {skill}</button
                  >
                  <button
                    class="job-remove skill-dismiss"
                    type="button"
                    aria-label={`Dismiss ${skill}`}
                    onclick={() => dismissDiscoveredSkill(skill)}>Not now</button
                  >
                {/each}
                <span class="field-hint">These suggestions stay unsaved until you add one.</span>
              </div>
            {/if}
            {#if alertSuggestions.length}
              <div class="skill-suggestions alert-suggestions">
                <strong>LinkedIn job alerts worth activating</strong>
                <p>
                  Use one alert per focused search. LinkedIn controls the alert; JobFinder does not
                  access your account.
                </p>
                {#each alertSuggestions as suggestion (suggestion)}
                  <a
                    class="job-action-link"
                    href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(suggestion)}&f_TPR=r604800`}
                    target="_blank"
                    rel="noopener noreferrer">Create alert: {suggestion} ↗</a
                  >
                {/each}
              </div>
            {/if}
            <form class="chat-form" onsubmit={sendChatMessage}>
              <label class="sr-only" for="chat-input">Your message</label>
              <textarea
                id="chat-input"
                rows="3"
                maxlength="3000"
                placeholder="Describe a project you worked on, your role and the tools you used…"
                bind:value={chatInput}
              ></textarea>
              <div class="provider-actions">
                <span class="status-message" role="status">{chatStatus || suggestionsStatus}</span>
                {#if chatStatus}
                  <button
                    class="text-button"
                    type="button"
                    disabled={chatBusy || !providerSettings[chatProvider].configured}
                    onclick={() => void requestRecruiterReply()}>Try again</button
                  >
                {/if}
                <button
                  class="button button-dark"
                  type="submit"
                  disabled={chatBusy ||
                    !chatMessages.length ||
                    !providerSettings[chatProvider].configured}>Send</button
                >
              </div>
            </form>
          </article>
        </section>
      {/if}

      {#if view === 'linkedin-alerts'}
        <section class="view" id="view-linkedin-alerts">
          <div class="inner-heading">
            <p class="eyebrow">YOUR LINKEDIN INBOX, ON YOUR TERMS</p>
            <h1>Bring alerts in,<br /><em>without scraping.</em></h1>
            <p class="heading-copy">
              Paste a LinkedIn job-alert email or load a local .eml/text export. The selected
              provider extracts leads from only what you submit; the email is not retained by the
              server.
            </p>
          </div>
          <div class="form-note">
            <span aria-hidden="true">✳</span>
            <div>
              <strong>Verification stays with you.</strong> Each imported lead becomes a recommendation
              with Google Jobs and company-career search links. JobFinder does not sign in to LinkedIn,
              scrape LinkedIn, or automatically crawl company sites.
            </div>
          </div>
          <article class="panel alert-import-card">
            <label class="upload-control" for="linkedin-alert-file"
              ><span class="upload-symbol" aria-hidden="true">↑</span><span
                ><strong>Choose an alert email file</strong><small
                  >.eml or .txt — read locally before you import</small
                ></span
              ><input
                id="linkedin-alert-file"
                type="file"
                accept=".eml,.txt,message/rfc822,text/plain"
                onchange={handleLinkedinAlertFile}
              /></label
            >
            <label class="field"
              ><span>LinkedIn job-alert email text</span><textarea
                rows="12"
                maxlength="20000"
                bind:value={linkedinAlertText}
                placeholder="Paste the job-alert email here. Remove anything you do not want the AI provider to read."
              ></textarea></label
            >
            <div class="provider-actions">
              <span class="status-message" role="status">{linkedinAlertStatus}</span><button
                class="button button-dark"
                type="button"
                disabled={importingLinkedinAlert ||
                  !linkedinAlertText.trim() ||
                  !providerSettings[chatProvider].configured}
                onclick={importLinkedinAlert}
                >{importingLinkedinAlert ? 'Importing…' : 'Import leads'}</button
              >
            </div>
          </article>
        </section>
      {/if}

      {#if view === 'suggestions'}
        <section class="view" id="view-suggestions">
          <div class="inner-heading">
            <p class="eyebrow">HANDPICKED FOR YOU</p>
            <h1>Recommended <em>jobs.</em></h1>
            <p class="heading-copy">
              Postings found on public job boards and ranked against your profile. Review them, save
              the ones you like, and apply later.
            </p>
          </div>
          <div class="provider-actions">
            <span class="status-message" role="status">{suggestionsStatus}</span>
            <button
              class="button button-dark"
              type="button"
              disabled={findingJobs || !providerSettings[chatProvider].configured}
              onclick={findJobs}>{findingJobs ? 'Searching…' : 'Find more jobs'}</button
            >
          </div>
          <div class="job-list">
            {#if suggestions.length === 0}
              <div class="empty-state">
                <span class="empty-mark">✳</span>
                <h3>No recommendations yet.</h3>
                <p>Ask the AI recruiter to find jobs for you.</p>
              </div>
            {/if}
            {#each suggestions as suggestion (suggestion.id)}
              <article class="job-card">
                <div class="job-card-top">
                  <div class="job-company">
                    <span class="company-mark"
                      >{(suggestion.company || '?').trim().slice(0, 1).toUpperCase()}</span
                    >
                    <div>
                      <h3>{suggestion.title}</h3>
                      <p>{suggestion.company} · {suggestion.location} · {suggestion.source}</p>
                      {#if suggestion.postedAt}
                        <p>Posted {new Date(suggestion.postedAt).toLocaleDateString()}</p>
                      {/if}
                    </div>
                  </div>
                  <span class="nav-count">{suggestion.score}% match</span>
                </div>
                {#if suggestion.reason}<p class="job-notes">{suggestion.reason}</p>{/if}
                <div class="job-card-footer">
                  {#if linkFor(suggestion.url)}
                    <a
                      class="job-action-link"
                      href={linkFor(suggestion.url)}
                      target="_blank"
                      rel="noopener noreferrer">View listing ↗</a
                    >
                  {/if}
                  {#if suggestion.companySearchUrl && linkFor(suggestion.companySearchUrl)}
                    <a
                      class="job-action-link"
                      href={linkFor(suggestion.companySearchUrl)}
                      target="_blank"
                      rel="noopener noreferrer">Search company careers ↗</a
                    >
                  {/if}
                  <button
                    class="job-action-link"
                    type="button"
                    onclick={() => saveSuggestion(suggestion)}>Save to my jobs</button
                  >
                  <button
                    class="job-remove"
                    type="button"
                    onclick={() => hideSuggestion(suggestion)}>Hide this job</button
                  >
                </div>
              </article>
            {/each}
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
                          ? 'A key is already saved for this provider. Remove it to add a different one.'
                          : providerSettings[provider].source === 'environment'
                            ? `A key is already set through ${provider.toUpperCase()}_API_KEY on the server. Change it there and restart.`
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
                  {#if !providerSettings[provider].configured}
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
                  {/if}
                  <div class="provider-actions">
                    <span class="status-message" role="status">{providerStatuses[provider]}</span
                    >{#if !providerSettings[provider].configured}<button
                        class="button button-dark"
                        type="submit"
                        disabled={providerBusy[provider]}>Save key</button
                      >{/if}{#if providerSettings[provider].source === 'saved'}<button
                        class="text-button remove-provider-key"
                        type="button"
                        disabled={providerBusy[provider]}
                        onclick={() => removeProviderKey(provider)}>Remove saved key</button
                      >{/if}
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
