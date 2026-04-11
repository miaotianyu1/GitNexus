import { SupportedLanguages, getLanguageFromFilename } from 'gitnexus-shared';

const OBJC_HEADER_HINT_RE = /^\s*@(interface|protocol|implementation|class)\b/m;

export const resolveLanguageForFile = (
  filePath: string,
  content?: string,
): SupportedLanguages | null => {
  const lang = getLanguageFromFilename(filePath);
  if (!lang) return null;

  if (filePath.endsWith('.h') && lang !== SupportedLanguages.ObjectiveC) {
    if (content && OBJC_HEADER_HINT_RE.test(content)) {
      return SupportedLanguages.ObjectiveC;
    }
  }

  return lang;
};
