import { SupportedLanguages } from 'gitnexus-shared';
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';
import { createStandardStrategy } from '../standard.js';

const resolveGeneratedSwiftHeader: ImportResolverStrategy = (raw, _filePath, ctx) => {
  if (!raw.endsWith('-Swift.h')) return null;

  const swiftFiles = ctx.allFileList.filter((path) => path.endsWith('.swift'));
  if (swiftFiles.length === 0 || swiftFiles.length > 2000) return null;
  return { kind: 'files', files: swiftFiles };
};

export const objectiveCImportConfig: ImportResolutionConfig = {
  language: SupportedLanguages.ObjectiveC,
  strategies: [resolveGeneratedSwiftHeader, createStandardStrategy(SupportedLanguages.ObjectiveC)],
};
