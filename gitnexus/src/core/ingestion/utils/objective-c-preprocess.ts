const NULLABILITY_MACRO_RE = /^\s*NS_ASSUME_NONNULL_(BEGIN|END)\s*$/gm;

export const preprocessObjectiveCContent = (content: string): string => {
  if (!content.includes('NS_ASSUME_NONNULL_')) return content;
  return content.replace(NULLABILITY_MACRO_RE, '');
};
