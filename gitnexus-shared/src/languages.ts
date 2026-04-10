/**
 * Supported language enum — single source of truth.
 *
 * Both CLI and web use this to identify which language a file/node belongs to.
 * The CLI uses it throughout the ingestion pipeline; the web uses it for display.
 */
export enum SupportedLanguages {
  JavaScript = 'javascript',
  TypeScript = 'typescript',
  Python = 'python',
  Java = 'java',
  /** Objective-C source (tree-sitter-objc, .m/.mm/.h). */
  ObjectiveC = 'objectivec',
  C = 'c',
  CPlusPlus = 'cpp',
  CSharp = 'csharp',
  Go = 'go',
  Ruby = 'ruby',
  Rust = 'rust',
  PHP = 'php',
  Kotlin = 'kotlin',
  Swift = 'swift',
  Dart = 'dart',
  Vue = 'vue',
  /** Standalone regex processor — no tree-sitter, no LanguageProvider. */
  Cobol = 'cobol',
}
