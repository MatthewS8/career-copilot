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
