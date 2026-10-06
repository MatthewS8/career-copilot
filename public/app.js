const PROFILE_KEY = 'jobfinder.profile.v1';
const JOBS_KEY = 'jobfinder.jobs.v1';
const statuses = ['Saved', 'Applying', 'Applied', 'Interviewing', 'Archived'];
const profileForm = document.querySelector('#profile-form');
const jobForm = document.querySelector('#job-form');
const jobList = document.querySelector('#job-list');
const recentList = document.querySelector('#recent-list');
const letterDialog = document.querySelector('#letter-dialog');
const letterResult = document.querySelector('#letter-result');
const profile = readStorage(PROFILE_KEY, {});
let jobs = readStorage(JOBS_KEY, []);
let activeJobId = null;

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function persist() {
  localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
  render();
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function linkFor(url) {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function limitText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function limitProfileSource(value) {
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

function makeAutofillRequest(provider, source, value) {
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

function setView(viewName) {
  document.querySelectorAll('.view').forEach((view) => {
    view.hidden = view.id !== `view-${viewName}`;
  });
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === viewName);
  });
  const labels = { dashboard: 'Overview', profile: 'My profile', jobs: 'Saved jobs', settings: 'API settings' };
  document.querySelector('#page-crumb').textContent = labels[viewName] || labels.dashboard;
  if (viewName === 'settings') refreshProviderSettings();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});
document.querySelectorAll('[data-open-view]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    setView(button.dataset.openView);
  });
});

async function refreshProviderSettings() {
  try {
    const response = await fetch('/api/settings');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load API key settings.');
    document.querySelector('#settings-storage-warning').hidden = !data.storageError;
    for (const [provider, state] of Object.entries(data.providers || {})) {
      const label = document.querySelector(`#provider-state-${provider}`);
      const removeButton = document.querySelector(`[data-provider="${provider}"] .remove-provider-key`);
      if (!label || !removeButton) continue;
      if (state.source === 'saved') {
        label.textContent = 'A saved key is encrypted on this server.';
        removeButton.hidden = false;
      } else if (state.source === 'environment') {
        label.textContent = 'Using a key from the server environment.';
        removeButton.hidden = true;
      } else {
        label.textContent = 'No key configured.';
        removeButton.hidden = true;
      }
    }
  } catch {
    document.querySelector('#settings-storage-warning').hidden = false;
    document.querySelector('#settings-storage-message').textContent = 'Could not load API key settings. Check the server and private data files.';
    document.querySelectorAll('.provider-state').forEach((label) => {
      label.textContent = 'Could not load key status.';
    });
  }
}

function settingsResponseError(response, data) {
  if (response.status === 403) {
    return `For security, manage API keys from localhost. Open http://127.0.0.1:${location.port || '3000'} in this browser.`;
  }
  return data.error || 'Could not update this API key.';
}

document.querySelectorAll('.provider-key-form').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const provider = form.dataset.provider;
    const input = form.elements.namedItem('key');
    const status = form.querySelector('[role="status"]');
    const button = form.querySelector('button[type="submit"]');
    if (!input.value.trim()) {
      status.textContent = 'Enter an API key first.';
      return;
    }

    button.disabled = true;
    status.textContent = 'Encrypting and saving…';
    try {
      const response = await fetch('/api/settings/provider-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key: input.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(settingsResponseError(response, data));
      input.value = '';
      status.textContent = 'Saved securely. The key is not shown again.';
      await refreshProviderSettings();
    } catch (error) {
      status.textContent = error.message || 'Could not save this key.';
    } finally {
      button.disabled = false;
    }
  });
});

document.querySelectorAll('.remove-provider-key').forEach((button) => {
  button.addEventListener('click', async () => {
    const provider = button.closest('[data-provider-card]').dataset.providerCard;
    const form = button.closest('.provider-card').querySelector('.provider-key-form');
    const status = form.querySelector('[role="status"]');
    button.disabled = true;
    status.textContent = 'Removing saved key…';
    try {
      const response = await fetch(`/api/settings/provider-key?provider=${encodeURIComponent(provider)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(settingsResponseError(response, data));
      status.textContent = data.environmentConfigured
        ? 'Saved key removed. The server environment key is still active.'
        : 'Saved key removed.';
      await refreshProviderSettings();
    } catch (error) {
      status.textContent = error.message || 'Could not remove this key.';
    } finally {
      button.disabled = false;
    }
  });
});

function updateSearchLinks() {
  const role = profile.roles || '';
  const location = profile.location || '';
  const query = [role, location].filter(Boolean).join(' ');
  if (!query) return;
  const encodedQuery = encodeURIComponent(query);
  const encodedRole = encodeURIComponent(role);
  const encodedLocation = encodeURIComponent(location);
  document.querySelector('#linkedin-search').href = `https://www.linkedin.com/jobs/search/?keywords=${encodedRole}&location=${encodedLocation}`;
  document.querySelector('#indeed-search').href = `https://www.indeed.com/jobs?q=${encodedRole}&l=${encodedLocation}`;
  document.querySelector('#google-search').href = `https://www.google.com/search?ibp=htl%3Bjobs&q=${encodedQuery}`;
}

function renderStats() {
  document.querySelector('#stat-total').textContent = String(jobs.length);
  document.querySelector('#stat-progress').textContent = String(jobs.filter((job) => ['Applying', 'Applied', 'Interviewing'].includes(job.status)).length);
  document.querySelector('#nav-job-count').textContent = String(jobs.length);
  document.querySelector('#jobs-count').textContent = String(jobs.length);
  document.querySelector('#list-count').textContent = `(${jobs.length})`;
  document.querySelector('#stat-role').textContent = profile.roles || 'Not set up yet';
  document.querySelector('#stat-location').textContent = profile.location || 'Tell us what you’re looking for';
  updateSearchLinks();
}

function addJobSummary(container, job) {
  const item = element('article', 'recent-item');
  const initials = `${(job.company || '?').trim().slice(0, 1).toUpperCase()}`;
  const mark = element('span', 'company-mark', initials);
  const details = element('div', 'recent-details');
  details.append(element('strong', '', job.title), element('span', '', job.company));
  const status = element('span', `status-pill status-${(job.status || 'Saved').toLowerCase()}`, job.status || 'Saved');
  const actions = element('button', 'recent-open', 'View →');
  actions.type = 'button';
  actions.addEventListener('click', () => setView('jobs'));
  item.append(mark, details, status, actions);
  container.append(item);
}

function renderJobs() {
  jobList.replaceChildren();
  recentList.replaceChildren();
  const filter = document.querySelector('#job-filter').value;
  const visibleJobs = jobs.filter((job) => filter === 'all' || job.status === filter);
  if (!jobs.length) {
    const empty = element('div', 'empty-state');
    empty.append(element('span', 'empty-mark', '✳'), element('h3', '', 'Your next possibility starts here.'), element('p', '', 'Save a job listing on the left to keep it close and start planning your next step.'));
    jobList.append(empty);
  } else if (!visibleJobs.length) {
    jobList.append(element('div', 'empty-state compact-empty', 'No saved jobs match this filter.'));
  }

  visibleJobs.forEach((job) => {
    const card = element('article', 'job-card');
    const top = element('div', 'job-card-top');
    const company = element('div', 'job-company');
    company.append(element('span', 'company-mark', (job.company || '?').trim().slice(0, 1).toUpperCase()));
    const heading = element('div');
    heading.append(element('h3', '', job.title), element('p', '', job.company));
    company.append(heading);
    const status = document.createElement('select');
    status.className = `status-select status-${(job.status || 'Saved').toLowerCase()}`;
    status.setAttribute('aria-label', `Application status for ${job.title} at ${job.company}`);
    statuses.forEach((value) => {
      const option = element('option', '', value);
      option.value = value;
      option.selected = value === job.status;
      status.append(option);
    });
    status.addEventListener('change', () => {
      jobs = jobs.map((entry) => entry.id === job.id ? { ...entry, status: status.value } : entry);
      persist();
    });
    top.append(company, status);
    card.append(top);

    if (job.notes) card.append(element('p', 'job-notes', job.notes));
    const footer = element('div', 'job-card-footer');
    const safeUrl = linkFor(job.url);
    if (safeUrl) {
      const listing = element('a', 'job-action-link', 'View listing ↗');
      listing.href = safeUrl;
      listing.target = '_blank';
      listing.rel = 'noopener noreferrer';
      footer.append(listing);
    }
    const draftButton = element('button', 'job-action-link', 'Draft cover letter ✳');
    draftButton.type = 'button';
    draftButton.addEventListener('click', () => openLetter(job));
    footer.append(draftButton);
    const removeButton = element('button', 'job-remove', 'Remove');
    removeButton.type = 'button';
    removeButton.addEventListener('click', () => {
      jobs = jobs.filter((entry) => entry.id !== job.id);
      persist();
    });
    footer.append(removeButton);
    card.append(footer);
    jobList.append(card);
  });

  jobs.slice(0, 3).forEach((job) => addJobSummary(recentList, job));
  if (!jobs.length) recentList.append(element('div', 'recent-empty', 'Your saved roles will show up here.'));
}

function render() {
  renderStats();
  renderJobs();
}

function loadProfile() {
  for (const [key, value] of Object.entries(profile)) {
    const field = profileForm.elements.namedItem(key);
    if (field && typeof value === 'string') field.value = value;
  }
}

profileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const saved = Object.fromEntries(new FormData(profileForm).entries());
  Object.assign(profile, saved);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  document.querySelector('#profile-status').textContent = 'Saved — your search is taking shape.';
  render();
});

document.querySelector('#resume-file').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  if (file.size > 2_000_000) {
    document.querySelector('#profile-status').textContent = 'That file is over 2 MB. Please paste a shorter resume instead.';
    event.target.value = '';
    return;
  }
  try {
    profileForm.elements.namedItem('resume').value = await file.text();
    document.querySelector('#profile-status').textContent = `${file.name} loaded. Choose “Autofill from resume” to extract profile details.`;
  } catch {
    document.querySelector('#profile-status').textContent = 'Could not read that file. Please paste your resume text instead.';
  }
});

async function autofillProfile(source, content, button) {
  const status = document.querySelector('#profile-status');
  if (!content.trim()) {
    status.textContent = source === 'resume' ? 'Upload or paste your resume text first.' : 'Paste LinkedIn profile text first.';
    return;
  }

  const { body, shortened } = makeAutofillRequest(
    document.querySelector('#profile-ai-provider').value,
    source,
    content,
  );
  button.disabled = true;
  status.textContent = shortened
    ? 'Extracting details from the first part of your text…'
    : 'Extracting profile details…';
  try {
    const response = await fetch('/api/extract-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not extract profile details.');

    let filled = 0;
    for (const [name, value] of Object.entries(data.profile || {})) {
      const field = profileForm.elements.namedItem(name);
      if (!field || typeof value !== 'string' || !value.trim()) continue;
      if (field.tagName === 'SELECT') {
        if (field.value) continue;
        const option = Array.from(field.options).find((item) => item.value.toLowerCase() === value.trim().toLowerCase());
        if (!option) continue;
        field.value = option.value;
      } else {
        if (field.value.trim()) continue;
        field.value = value;
      }
      filled += 1;
    }
    status.textContent = filled
      ? `${filled} profile field${filled === 1 ? '' : 's'} filled. Review them, then save your profile. Existing entries were left unchanged.${shortened ? ' Only part of the source text was used.' : ''}`
      : `No new fields were added. Existing entries were left unchanged, and unsupported values may need manual entry.${shortened ? ' Only part of the source text was used.' : ''}`;
  } catch (error) {
    status.textContent = error.message || 'Could not connect to the AI service.';
  } finally {
    button.disabled = false;
  }
}

document.querySelector('#autofill-resume').addEventListener('click', (event) => {
  autofillProfile('resume', profileForm.elements.namedItem('resume').value, event.currentTarget);
});

document.querySelector('#autofill-linkedin').addEventListener('click', (event) => {
  autofillProfile('linkedin', document.querySelector('#linkedin-profile-text').value, event.currentTarget);
});

jobForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(jobForm).entries());
  if (!linkFor(data.url)) {
    jobForm.elements.namedItem('url').setCustomValidity('Enter a valid http or https URL.');
    jobForm.elements.namedItem('url').reportValidity();
    return;
  }
  jobForm.elements.namedItem('url').setCustomValidity('');
  jobs.unshift({
    id: crypto.randomUUID(),
    title: data.title.trim(),
    company: data.company.trim(),
    url: linkFor(data.url),
    description: data.description.trim(),
    notes: data.notes.trim(),
    status: 'Saved',
    addedAt: new Date().toISOString(),
  });
  jobForm.reset();
  document.querySelector('#job-filter').value = 'all';
  persist();
});

jobForm.elements.namedItem('url').addEventListener('input', (event) => {
  event.target.setCustomValidity('');
});

document.querySelector('#job-filter').addEventListener('change', renderJobs);

function openLetter(job) {
  activeJobId = job.id;
  document.querySelector('#letter-title').setAttribute('aria-label', `Draft a cover letter for ${job.title}`);
  document.querySelector('#letter-description').value = job.description || '';
  document.querySelector('#letter-status').textContent = '';
  letterResult.value = '';
  letterDialog.showModal();
}

document.querySelector('#generate-letter').addEventListener('click', async () => {
  const job = jobs.find((entry) => entry.id === activeJobId);
  if (!job) return;
  const description = document.querySelector('#letter-description').value.trim();
  if (!description) {
    document.querySelector('#letter-status').textContent = 'Add the job description first.';
    return;
  }
  const button = document.querySelector('#generate-letter');
  button.disabled = true;
  document.querySelector('#letter-status').textContent = 'Writing a first draft…';
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
      provider: document.querySelector('#letter-provider').value,
      profile: profileForLetter,
      job: { title: job.title, company: job.company, description },
    };
    const encoder = new TextEncoder();
    const fieldsToShorten = [
      [payload.profile, 'resume'],
      [payload.job, 'description'],
      [payload.profile, 'experience'],
      [payload.profile, 'priorities'],
      [payload.profile, 'skills'],
    ];
    let body = JSON.stringify(payload);
    for (const [object, field] of fieldsToShorten) {
      if (encoder.encode(body).byteLength <= 45_000) break;
      const original = object[field];
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
    letterResult.value = data.letter;
    document.querySelector('#letter-status').textContent = 'Draft ready — personalize and verify it before sending.';
  } catch (error) {
    document.querySelector('#letter-status').textContent = error.message || 'Could not connect to the AI service.';
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#copy-letter').addEventListener('click', async () => {
  if (!letterResult.value) return;
  try {
    await navigator.clipboard.writeText(letterResult.value);
    document.querySelector('#letter-status').textContent = 'Copied to clipboard.';
  } catch {
    letterResult.focus();
    letterResult.select();
    document.querySelector('#letter-status').textContent = 'Select the text and copy it.';
  }
});

document.querySelector('#download-letter').addEventListener('click', () => {
  if (!letterResult.value) return;
  const job = jobs.find((entry) => entry.id === activeJobId);
  const blob = new Blob([letterResult.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${(job?.company || 'cover-letter').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-cover-letter.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
});

loadProfile();
render();
