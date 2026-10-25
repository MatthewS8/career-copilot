export type Provider = 'openai' | 'gemini' | 'anthropic';
export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type GeneratedLetterVersion = {
  id: string;
  draft: string;
  createdAt: string;
  request: string;
};
export type CoverLetterSession = {
  startingLetter: string;
  draft: string;
  messages: ChatMessage[];
  versions: GeneratedLetterVersion[];
  baseLetterId?: string;
  baseLetterName?: string;
  updatedAt: string;
  provider: Provider;
};
export type ApplicationChatSession = {
  messages: ChatMessage[];
  updatedAt: string;
  provider: Provider;
};
export type JobAssessment = {
  score: number;
  rationale: string;
  strengths: string[];
  concerns: string[];
  unansweredQuestions: string[];
  nextAction: string;
  assessedAt: string;
  inputVersion: string;
};
export type BaseLetter = {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  sourceJobId?: string;
  sourceJobTitle?: string;
};

const providers: Provider[] = ['openai', 'gemini', 'anthropic'];

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function newLetterVersions(value: unknown): GeneratedLetterVersion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((version): version is Partial<GeneratedLetterVersion> =>
      Boolean(version && typeof version === 'object'),
    )
    .map((version) => ({
      id: textValue(version.id) || crypto.randomUUID(),
      draft: textValue(version.draft).slice(0, 15_000),
      createdAt: textValue(version.createdAt) || new Date().toISOString(),
      request: textValue(version.request).slice(0, 2_500),
    }))
    .filter((version) => version.draft)
    .slice(-30);
}

function assessmentItems(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 260))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function newJobAssessment(value: unknown): JobAssessment | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const assessment = value as Partial<JobAssessment>;
  const score = Number(assessment.score);
  const rationale = textValue(assessment.rationale).trim().slice(0, 900);
  if (!Number.isFinite(score) || !rationale) return undefined;
  return {
    score: Math.min(100, Math.max(0, Math.round(score))),
    rationale,
    strengths: assessmentItems(assessment.strengths, 4),
    concerns: assessmentItems(assessment.concerns, 4),
    unansweredQuestions: assessmentItems(assessment.unansweredQuestions, 5),
    nextAction: textValue(assessment.nextAction).trim().slice(0, 260),
    assessedAt: textValue(assessment.assessedAt) || new Date().toISOString(),
    inputVersion: textValue(assessment.inputVersion),
  };
}

export function newCoverLetter(value: unknown): CoverLetterSession | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const session = value as Partial<CoverLetterSession>;
  if (
    !textValue(session.startingLetter) &&
    !textValue(session.draft) &&
    !Array.isArray(session.messages)
  )
    return undefined;
  const coverLetter: CoverLetterSession = {
    startingLetter: textValue(session.startingLetter).slice(0, 15_000),
    draft: textValue(session.draft).slice(0, 15_000),
    messages: (Array.isArray(session.messages) ? (session.messages as unknown[]) : [])
      .filter((message): message is ChatMessage => {
        if (!message || typeof message !== 'object') return false;
        const candidate = message as Partial<ChatMessage>;
        return (
          (candidate.role === 'user' || candidate.role === 'assistant') &&
          typeof candidate.content === 'string'
        );
      })
      .slice(-20),
    versions: newLetterVersions(session.versions),
    updatedAt: textValue(session.updatedAt) || new Date().toISOString(),
    provider: providers.includes(session.provider as Provider)
      ? (session.provider as Provider)
      : 'openai',
  };
  const baseLetterId = textValue(session.baseLetterId);
  const baseLetterName = textValue(session.baseLetterName);
  if (baseLetterId) coverLetter.baseLetterId = baseLetterId;
  if (baseLetterName) coverLetter.baseLetterName = baseLetterName;
  return coverLetter;
}

export function restoreGeneratedLetterVersion(
  session: CoverLetterSession,
  version: GeneratedLetterVersion,
  restoredAt = new Date().toISOString(),
): CoverLetterSession {
  const versions =
    session.draft && session.draft !== version.draft
      ? [
          ...session.versions,
          {
            id: crypto.randomUUID(),
            draft: session.draft,
            createdAt: restoredAt,
            request: 'User-edited draft saved before restoring an earlier version.',
          },
        ].slice(-30)
      : session.versions;
  return { ...session, draft: version.draft, versions, updatedAt: restoredAt };
}

export function newApplicationChat(value: unknown): ApplicationChatSession | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const session = value as Partial<ApplicationChatSession>;
  const messages = (Array.isArray(session.messages) ? (session.messages as unknown[]) : [])
    .filter((message): message is ChatMessage => {
      if (!message || typeof message !== 'object') return false;
      const candidate = message as Partial<ChatMessage>;
      return (
        (candidate.role === 'user' || candidate.role === 'assistant') &&
        typeof candidate.content === 'string'
      );
    })
    .slice(-30);
  if (!messages.length) return undefined;
  return {
    messages,
    updatedAt: textValue(session.updatedAt) || new Date().toISOString(),
    provider: providers.includes(session.provider as Provider)
      ? (session.provider as Provider)
      : 'openai',
  };
}

export function migrateBaseLetters(value: unknown): BaseLetter[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Partial<BaseLetter> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => {
      const base: BaseLetter = {
        id: textValue(entry.id) || crypto.randomUUID(),
        name: textValue(entry.name).slice(0, 120),
        text: textValue(entry.text).slice(0, 15_000),
        createdAt: textValue(entry.createdAt) || new Date().toISOString(),
      };
      const sourceJobId = textValue(entry.sourceJobId);
      const sourceJobTitle = textValue(entry.sourceJobTitle);
      if (sourceJobId) base.sourceJobId = sourceJobId;
      if (sourceJobTitle) base.sourceJobTitle = sourceJobTitle;
      return base;
    })
    .filter((entry) => entry.name && entry.text)
    .slice(-50);
}
