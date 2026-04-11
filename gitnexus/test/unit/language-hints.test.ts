import { describe, it, expect } from 'vitest';
import { SupportedLanguages } from 'gitnexus-shared';
import { resolveLanguageForFile } from '../../src/core/ingestion/utils/language-hints.js';

describe('resolveLanguageForFile', () => {
  it('treats .h files with ObjC markers as Objective-C', () => {
    const code = `
      @protocol MOSubScrollViewProtocol <NSObject>
      @end
    `;
    const lang = resolveLanguageForFile('MOSubScrollViewProtocol.h', code);
    expect(lang).toBe(SupportedLanguages.ObjectiveC);
  });

  it('keeps non-ObjC .h files as C++', () => {
    const code = `
      #pragma once
      struct Widget { int value; };
    `;
    const lang = resolveLanguageForFile('Widget.h', code);
    expect(lang).toBe(SupportedLanguages.CPlusPlus);
  });
});
