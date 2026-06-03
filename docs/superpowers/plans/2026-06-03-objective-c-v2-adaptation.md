# Objective-C V2 Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase the local Objective-C fork onto the newer GitNexus language-ingestion architecture and restore reliable Objective-C / Swift mixed-project indexing.

**Architecture:** Treat Objective-C as a first-class `LanguageProvider`, not an old `src/languages/*` patch. Keep `.h` compatibility with existing C/C++ projects by adding content-aware header classification before parse grouping, while `.m` and `.mm` map directly to Objective-C.

**Tech Stack:** TypeScript, Vitest, Node.js, Tree-sitter, `tree-sitter-objc`, GitNexus ingestion pipeline, LadybugDB graph output.

**Current Baseline:** local fork is on `gitnexus/package.json` version `1.5.3`; upstream stable release is `v1.6.5` as of 2026-05-16, and `v1.6.6-rc.*` exists as pre-release traffic on 2026-06-03.

**Paths:** All file paths are relative to `/Users/miaotianyu/Desktop/GitNexus-objc`.

---

## Current Execution Status (2026-06-03)

- Branch `objc-v2-adapt-v1.6.5` has been fast-forwarded/merged to upstream `v1.6.5`.
- Objective-C support from `origin/objc-support` has been migrated onto the `v1.6.5` provider architecture:
  - `SupportedLanguages.ObjectiveC`
  - Prism syntax mapping `objectivec`
  - main-thread and worker `tree-sitter-objc` loading
  - Objective-C `LanguageProvider`
  - `.m` / `.mm` static detection plus content-aware Objective-C `.h` classification
  - selector-aware message-send extraction, including nested `alloc` / `new` receiver inference
  - class, protocol, superclass, protocol-conformance, block-typedef, property, and C-family query coverage
  - method metadata extraction for selectors, return types, parameters, `+` static methods, and protocol abstract methods
  - property field metadata extraction for type, `readonly`, and class properties
  - generated `*-Swift.h` bridge imports to Swift source files
  - query compilation coverage
- `tree-sitter-objc` is pinned to `3.0.2` and installed with legacy peer handling because its optional peer range is `tree-sitter ^0.22.1`, while GitNexus currently uses `tree-sitter ^0.21.1`; runtime grammar loading has been verified.
- `graphology-types` is added as a dev dependency because upstream `community-processor.ts` imports it directly and local install did not provide it transitively.
- Verified:
  - `npm run build` in `gitnexus-shared`
  - `npm run build` in `gitnexus`
  - `npx vitest run test/unit/objective-c-parsing.test.ts test/unit/ingestion-utils.test.ts test/unit/parser-loader.test.ts test/integration/tree-sitter-languages.test.ts test/integration/query-compilation.test.ts`
- Not yet implemented:
  - Obsidian usage-summary document update

---

## File Structure

- Modify: `gitnexus-shared/src/languages.ts` - add `SupportedLanguages.ObjectiveC`.
- Modify: `gitnexus-shared/src/language-detection.ts` - map `.m` and `.mm`; keep `.h` out of the static extension map or classify it with content-aware helper.
- Modify: `gitnexus/src/core/tree-sitter/parser-loader.ts` - load `tree-sitter-objc` in the main thread.
- Modify: `gitnexus/src/core/ingestion/workers/parse-worker.ts` - load `tree-sitter-objc` in worker threads.
- Modify: `gitnexus/src/core/ingestion/languages/index.ts` - register the Objective-C provider.
- Create: `gitnexus/src/core/ingestion/languages/objective-c.ts` - assemble provider, built-ins, label overrides, and bridge wiring.
- Modify: `gitnexus/src/core/ingestion/tree-sitter-queries.ts` - add `OBJECTIVE_C_QUERIES`.
- Create: `gitnexus/src/core/ingestion/import-resolvers/objective-c.ts` - resolve `#import "Foo.h"`, `#import <Framework/Foo.h>`, generated `*-Swift.h`, and project headers.
- Create: `gitnexus/src/core/ingestion/type-extractors/objective-c.ts` - infer receiver types from declarations, casts, alloc/init, factory calls, and parameters.
- Create: `gitnexus/src/core/ingestion/field-extractors/configs/objective-c.ts` - extract `@property` declarations and ivars.
- Create: `gitnexus/src/core/ingestion/method-extractors/configs/objective-c.ts` - extract `-` / `+` selectors, parameters, return type, and static flag.
- Modify: `gitnexus/src/core/ingestion/export-detection.ts` - add `objectiveCExportChecker`.
- Modify: `gitnexus/src/core/ingestion/utils/call-analysis.ts` or add `gitnexus/src/core/ingestion/call-sites/objective-c.ts` - extract Objective-C message-send receiver, selector, and argument count.
- Modify: `gitnexus/src/core/ingestion/call-sites/extract-language-call-site.ts` - dispatch Objective-C call-site extraction.
- Modify: `gitnexus/src/core/ingestion/filesystem-walker.ts` or parsing pre-group step in `pipeline.ts` / `parse-worker.ts` - support content-aware `.h` classification.
- Add fixtures: `gitnexus/test/fixtures/sample-code/simple.m`, `gitnexus/test/fixtures/sample-code/simple-objc.h`.
- Add fixtures under `gitnexus/test/fixtures/lang-resolution/objc-*` for receiver, imports, protocols, categories, blocks, and Swift bridge.
- Modify tests: `gitnexus/test/unit/parser-loader.test.ts`, `gitnexus/test/unit/tree-sitter-queries.test.ts`, `gitnexus/test/integration/query-compilation.test.ts`, `gitnexus/test/integration/tree-sitter-languages.test.ts`, `gitnexus/test/integration/resolvers/objective-c.test.ts`.
- Modify: `gitnexus/package.json` and `gitnexus/package-lock.json` - add `tree-sitter-objc`.
- Update docs: `/Users/miaotianyu/Desktop/mty/MTObsidian/beike-personal-docs/tech-share/GitNexus适配OC及使用总结.md`.

---

### Task 1: Create the Rebase Branch and Pin the Upstream Baseline

- [ ] **Step 1: Confirm clean worktree**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git status --short
```

Expected: either clean output or only known local documentation changes. If source files are dirty, record them before rebasing.

- [ ] **Step 2: Fetch upstream tags and branches**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git fetch upstream --tags
```

Expected: upstream tags include `v1.6.5`. Do not use `v1.6.6-rc.*` as the default implementation baseline.

- [ ] **Step 3: Create the working branch**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git switch -c objc-v2-adapt-v1.6.5
```

Expected: current branch is `objc-v2-adapt-v1.6.5`.

- [ ] **Step 4: Merge stable upstream**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git merge v1.6.5
```

Expected: merge succeeds or reports conflicts. Resolve conflicts by preserving upstream ingestion architecture first, then reapply Objective-C support through the new provider model.

- [ ] **Step 5: Build after merge before adding OC**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
npm run build -w gitnexus-shared
npm run build -w gitnexus
```

Expected: both builds pass before Objective-C work starts.

---

### Task 2: Add Objective-C to the Language Registry

- [ ] **Step 1: Add a failing language-detection test**

In `gitnexus/test/integration/tree-sitter-languages.test.ts`, add assertions near the existing unknown-extension tests:

```typescript
expect(getLanguageFromFilename('ViewController.m')).toBe(SupportedLanguages.ObjectiveC);
expect(getLanguageFromFilename('Widget.mm')).toBe(SupportedLanguages.ObjectiveC);
expect(getSyntaxLanguageFromFilename('ViewController.m')).toBe('objectivec');
```

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npx vitest run test/integration/tree-sitter-languages.test.ts
```

Expected: fail because `ObjectiveC` does not exist.

- [ ] **Step 2: Add enum and extension detection**

In `gitnexus-shared/src/languages.ts`, add:

```typescript
  ObjectiveC = 'objective-c',
```

In `gitnexus-shared/src/language-detection.ts`, add:

```typescript
  [SupportedLanguages.ObjectiveC]: ['.m', '.mm'],
```

In `SYNTAX_MAP`, add:

```typescript
  [SupportedLanguages.ObjectiveC]: 'objectivec',
```

Keep `.h` mapped to `CPlusPlus` for now. Header disambiguation is implemented in Task 6 so existing C/C++ header tests do not regress.

- [ ] **Step 3: Run shared build**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
npm run build -w gitnexus-shared
```

Expected: build fails until every exhaustive `Record<SupportedLanguages, ...>` is updated; after Task 3 registration it passes.

---

### Task 3: Load `tree-sitter-objc` in Main and Worker Parsers

- [ ] **Step 1: Add dependency**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npm install tree-sitter-objc --save
```

Expected: `gitnexus/package.json` and `gitnexus/package-lock.json` update.

- [ ] **Step 2: Add parser-loader test**

In `gitnexus/test/unit/parser-loader.test.ts`, add:

```typescript
  describe('Objective-C dependency', () => {
    it('loads Objective-C language', async () => {
      await expect(loadLanguage(SupportedLanguages.ObjectiveC, 'ViewController.m')).resolves.not.toThrow();
    });
  });
```

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npx vitest run test/unit/parser-loader.test.ts
```

Expected: fail with `Unsupported language: objective-c`.

- [ ] **Step 3: Wire grammar in main parser-loader**

In `gitnexus/src/core/tree-sitter/parser-loader.ts`, import or require the grammar:

```typescript
let ObjectiveC: any = null;
try {
  ObjectiveC = _require('tree-sitter-objc');
} catch {}
```

Add to `languageMap`:

```typescript
  ...(ObjectiveC ? { [SupportedLanguages.ObjectiveC]: ObjectiveC } : {}),
```

- [ ] **Step 4: Wire grammar in parse-worker**

In `gitnexus/src/core/ingestion/workers/parse-worker.ts`, add the same optional require block and `languageMap` entry:

```typescript
let ObjectiveC: TreeSitterLanguage | null = null;
try {
  ObjectiveC = _require('tree-sitter-objc');
} catch {}
```

```typescript
  ...(ObjectiveC ? { [SupportedLanguages.ObjectiveC]: ObjectiveC } : {}),
```

- [ ] **Step 5: Verify parser loading**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npx vitest run test/unit/parser-loader.test.ts
```

Expected: Objective-C parser loading test passes.

---

### Task 4: Add Objective-C Provider and Query Compilation

- [ ] **Step 1: Add query compilation test entry**

In `gitnexus/test/integration/query-compilation.test.ts`, add:

```typescript
[SupportedLanguages.ObjectiveC]: 'ViewController.m',
```

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npx vitest run test/integration/query-compilation.test.ts
```

Expected: fail because provider is missing or query string is missing.

- [ ] **Step 2: Create `OBJECTIVE_C_QUERIES`**

In `gitnexus/src/core/ingestion/tree-sitter-queries.ts`, add an exported query constant that captures:

```scheme
; Class / protocol / category declarations
((class_interface name: (_) @name) @definition.class)
((class_implementation name: (_) @name) @definition.class)
((protocol_declaration name: (_) @name) @definition.interface)
((category_interface name: (_) @name) @definition.class)
((category_implementation name: (_) @name) @definition.class)

; Methods
((method_declaration selector: (_) @name) @definition.method)
((method_definition selector: (_) @name) @definition.method)

; Properties and ivars
((property_declaration) @definition.property)
((field_declaration declarator: (_) @name) @definition.property)

; Imports
((preproc_import path: (_) @import.source) @import)
((preproc_include path: (_) @import.source) @import)

; Message sends and C calls
((message_expression selector: (_) @call.name) @call)
((call_expression function: (_) @call.name) @call)

; Heritage
((class_interface name: (_) @heritage.class superclass: (_) @heritage.extends) @heritage)
((protocol_qualifiers (protocol_identifier) @heritage.implements) @heritage.impl)
```

If the grammar rejects a node name, inspect the tree with `node -e` and adjust the query to the exact emitted node type. Keep this task open until `query-compilation.test.ts` passes.

- [ ] **Step 3: Create `objective-c.ts` provider**

Create `gitnexus/src/core/ingestion/languages/objective-c.ts`:

```typescript
import { SupportedLanguages } from 'gitnexus-shared';
import { defineLanguage } from '../language-provider.js';
import { OBJECTIVE_C_QUERIES } from '../tree-sitter-queries.js';
import { objectiveCExportChecker } from '../export-detection.js';
import { resolveObjectiveCImport } from '../import-resolvers/objective-c.js';
import { typeConfig as objectiveCTypeConfig } from '../type-extractors/objective-c.js';

const BUILT_INS: ReadonlySet<string> = new Set([
  'NSLog',
  'NSStringFromClass',
  'NSStringFromSelector',
  'NSClassFromString',
  'dispatch_async',
  'dispatch_sync',
  'dispatch_after',
  'objc_getClass',
  'objc_msgSend',
]);

export const objectiveCProvider = defineLanguage({
  id: SupportedLanguages.ObjectiveC,
  extensions: ['.m', '.mm'],
  treeSitterQueries: OBJECTIVE_C_QUERIES,
  typeConfig: objectiveCTypeConfig,
  exportChecker: objectiveCExportChecker,
  importResolver: resolveObjectiveCImport,
  importSemantics: 'wildcard',
  heritageDefaultEdge: 'EXTENDS',
  builtInNames: BUILT_INS,
});
```

- [ ] **Step 4: Register provider**

In `gitnexus/src/core/ingestion/languages/index.ts`, import and register:

```typescript
import { objectiveCProvider } from './objective-c.js';
```

```typescript
  [SupportedLanguages.ObjectiveC]: objectiveCProvider,
```

- [ ] **Step 5: Add minimal stubs for required provider hooks**

Create `gitnexus/src/core/ingestion/import-resolvers/objective-c.ts`:

```typescript
import { SupportedLanguages } from 'gitnexus-shared';
import type { ImportResolverFn } from './types.js';
import { resolveStandard } from './standard.js';

export const resolveObjectiveCImport: ImportResolverFn = (raw, fp, ctx) => {
  const cleaned = raw.replace(/[<>"']/g, '').trim();
  return resolveStandard(cleaned, fp, ctx, SupportedLanguages.ObjectiveC);
};
```

Create `gitnexus/src/core/ingestion/type-extractors/objective-c.ts`:

```typescript
import type { LanguageTypeConfig } from './types.js';

export const typeConfig: LanguageTypeConfig = {
  declarationNodeTypes: new Set(['declaration', 'parameter_declaration']),
  extractDeclaration: () => undefined,
  extractInitializer: () => undefined,
  extractParameter: () => undefined,
};
```

Add `objectiveCExportChecker` to `gitnexus/src/core/ingestion/export-detection.ts`:

```typescript
export const objectiveCExportChecker: ExportChecker = () => true;
```

- [ ] **Step 6: Run provider build and query compile**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
npm run build -w gitnexus-shared
npm run build -w gitnexus
cd gitnexus && npx vitest run test/integration/query-compilation.test.ts
```

Expected: build passes and Objective-C query compiles.

---

### Task 5: Implement Objective-C Definitions, Methods, Properties, and Selectors

- [ ] **Step 1: Add sample fixtures**

Create `gitnexus/test/fixtures/sample-code/simple-objc.h`:

```objective-c
#import <Foundation/Foundation.h>

@protocol MTLoadable <NSObject>
- (void)loadData;
@end

@interface MTUserService : NSObject <MTLoadable>
@property (nonatomic, copy) NSString *name;
- (instancetype)initWithName:(NSString *)name;
- (void)fetchUserWithID:(NSString *)userID completion:(void (^)(NSString *value))completion;
+ (NSString *)serviceName;
@end
```

Create `gitnexus/test/fixtures/sample-code/simple.m`:

```objective-c
#import "simple-objc.h"

@implementation MTUserService
- (instancetype)initWithName:(NSString *)name {
  self = [super init];
  if (self) {
    _name = [name copy];
  }
  return self;
}

- (void)loadData {
  [self fetchUserWithID:@"1" completion:^(NSString *value) {
    NSLog(@"%@", value);
  }];
}

- (void)fetchUserWithID:(NSString *)userID completion:(void (^)(NSString *value))completion {
  completion(userID);
}

+ (NSString *)serviceName {
  return @"MTUserService";
}
@end
```

- [ ] **Step 2: Add extraction assertions**

In `gitnexus/test/integration/tree-sitter-languages.test.ts`, add a test that loads `simple.m`, runs `OBJECTIVE_C_QUERIES`, and asserts captured names include:

```typescript
expect(capturedNames).toContain('MTUserService');
expect(capturedNames).toContain('initWithName:');
expect(capturedNames).toContain('loadData');
expect(capturedNames).toContain('fetchUserWithID:completion:');
expect(capturedNames).toContain('serviceName');
```

Run the test and confirm it fails until selector extraction is implemented.

- [ ] **Step 3: Add selector extraction hook**

Extend the Objective-C provider with a `methodExtractor` config that normalizes selectors:

```typescript
function normalizeSelector(text: string): string {
  return text.replace(/\s+/g, '').replace(/;+$/, '');
}
```

Expected selector IDs:

- `loadData`
- `initWithName:`
- `fetchUserWithID:completion:`
- `serviceName`

- [ ] **Step 4: Add field extractor for `@property`**

Extract these fields from the fixture:

```typescript
{
  name: 'name',
  type: 'NSString',
  visibility: 'public',
  isReadonly: false,
  isStatic: false
}
```

Also extract ivars such as `_name` when they appear in interface blocks.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npx vitest run test/unit/tree-sitter-queries.test.ts test/integration/tree-sitter-languages.test.ts
```

Expected: Objective-C definition, method, property, and query tests pass.

---

### Task 6: Add Content-Aware `.h` Header Classification

- [ ] **Step 1: Add failing classification tests**

Create `gitnexus/test/unit/objective-c-header-detection.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { classifyHeaderLanguageFromContent } from '../../src/core/ingestion/objective-c-header-detection.js';
import { SupportedLanguages } from 'gitnexus-shared';

describe('Objective-C header detection', () => {
  it('classifies @interface header as Objective-C', () => {
    expect(classifyHeaderLanguageFromContent('@interface Foo : NSObject\n@end')).toBe(
      SupportedLanguages.ObjectiveC,
    );
  });

  it('classifies @protocol header as Objective-C', () => {
    expect(classifyHeaderLanguageFromContent('@protocol Foo\n@end')).toBe(
      SupportedLanguages.ObjectiveC,
    );
  });

  it('leaves C++ class header as CPlusPlus', () => {
    expect(classifyHeaderLanguageFromContent('class Foo { public: void bar(); };')).toBe(
      SupportedLanguages.CPlusPlus,
    );
  });
});
```

- [ ] **Step 2: Implement detector**

Create `gitnexus/src/core/ingestion/objective-c-header-detection.ts`:

```typescript
import { SupportedLanguages } from 'gitnexus-shared';

const OBJC_HEADER_RE = /(^|\n)\s*@(interface|protocol|class|compatibility_alias)\b|(^|\n)\s*#import\s+[<"][^>"]+(Foundation|UIKit|AppKit|CoreData)[^>"]+[>"]/;

export function classifyHeaderLanguageFromContent(content: string): SupportedLanguages {
  return OBJC_HEADER_RE.test(content) ? SupportedLanguages.ObjectiveC : SupportedLanguages.CPlusPlus;
}
```

- [ ] **Step 3: Use detector before worker grouping**

In `parse-worker.ts`, before adding a file to `byLanguage`, replace direct language lookup for `.h`:

```typescript
let lang = getLanguageFromFilename(file.path);
if (file.path.toLowerCase().endsWith('.h')) {
  lang = classifyHeaderLanguageFromContent(file.content);
}
```

Import the helper in `parse-worker.ts`. Mirror the same classification in any sequential fallback path that parses `FileEntry` content.

- [ ] **Step 4: Verify C++ `.h` does not regress**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npx vitest run test/unit/objective-c-header-detection.test.ts test/integration/resolvers/cpp.test.ts
```

Expected: Objective-C headers classify correctly and C++ resolver tests still pass.

---

### Task 7: Implement Objective-C Import and Swift Bridge Resolution

- [ ] **Step 1: Add resolver fixture**

Create `gitnexus/test/fixtures/lang-resolution/objc-imports/App.m`, `UserService.h`, `UserService.m`, and `Demo-Swift.h`.

`App.m`:

```objective-c
#import "UserService.h"
#import "Demo-Swift.h"

void runApp(void) {
  UserService *service = [[UserService alloc] init];
  [service loadData];
  SwiftGeneratedThing *thing = [[SwiftGeneratedThing alloc] init];
  [thing run];
}
```

`UserService.h`:

```objective-c
@interface UserService : NSObject
- (void)loadData;
@end
```

`UserService.m`:

```objective-c
#import "UserService.h"
@implementation UserService
- (void)loadData {}
@end
```

`Demo-Swift.h`:

```objective-c
@interface SwiftGeneratedThing : NSObject
- (void)run;
@end
```

- [ ] **Step 2: Add integration assertions**

Create `gitnexus/test/integration/resolvers/objective-c.test.ts` following the pattern in `resolvers/swift.test.ts`. Assert graph edges:

- `App.m` IMPORTS `UserService.h`.
- `App.m` IMPORTS `Demo-Swift.h`.
- `runApp` CALLS `UserService.loadData`.
- `runApp` CALLS `SwiftGeneratedThing.run`.

- [ ] **Step 3: Improve import resolver**

In `resolveObjectiveCImport`, resolve in this order:

1. Exact relative or suffix path for quoted imports.
2. Framework-style `Framework/Header.h` by suffix `Header.h`.
3. Generated `*-Swift.h` by exact basename.
4. Fallback to standard resolver.

- [ ] **Step 4: Run resolver test**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npx vitest run test/integration/resolvers/objective-c.test.ts
```

Expected: import and bridge assertions pass.

---

### Task 8: Implement Message-Send Receiver Type Resolution

- [ ] **Step 1: Add receiver fixture**

Create `gitnexus/test/fixtures/lang-resolution/objc-receiver/App.m`:

```objective-c
#import "Repo.h"
#import "User.h"

void run(void) {
  Repo *repo = [[Repo alloc] init];
  User *user = [repo currentUser];
  [user save];
  [repo save:user];
}
```

`Repo.h`:

```objective-c
@interface Repo : NSObject
- (User *)currentUser;
- (void)save:(User *)user;
@end
```

`User.h`:

```objective-c
@interface User : NSObject
- (void)save;
@end
```

- [ ] **Step 2: Add assertions**

In `objective-c.test.ts`, assert:

- `[repo currentUser]` resolves to `Repo.currentUser`.
- `[user save]` resolves to `User.save`.
- `[repo save:user]` resolves to `Repo.save:`.

- [ ] **Step 3: Implement type extractor**

Update `type-extractors/objective-c.ts` to bind:

- `Repo *repo` -> `Repo`
- `User *user` -> `User`
- `id<UserProtocol> delegate` -> `UserProtocol`
- `UIViewController *vc = [[UIViewController alloc] init]` -> `UIViewController`
- Casts like `(User *)value` -> `User`

- [ ] **Step 4: Implement call-site extraction**

For `message_expression`, extract:

```typescript
{
  callForm: 'member',
  receiverName: 'repo',
  calledName: 'save:',
  argCount: 1
}
```

Class messages such as `[UserService serviceName]` use:

```typescript
{
  callForm: 'member',
  receiverTypeName: 'UserService',
  calledName: 'serviceName',
  argCount: 0
}
```

- [ ] **Step 5: Run receiver tests**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npx vitest run test/integration/resolvers/objective-c.test.ts test/unit/receiver-extraction.test.ts
```

Expected: Objective-C receiver and existing receiver extraction tests pass.

---

### Task 9: Add Protocol, Category, Block, and Inheritance Coverage

- [ ] **Step 1: Add protocol/category fixture**

Create `gitnexus/test/fixtures/lang-resolution/objc-protocol-category/App.m` with:

```objective-c
@protocol MTLoadable
- (void)loadData;
@end

@interface MTBase : NSObject
- (void)prepare;
@end

@interface MTService : MTBase <MTLoadable>
@end

@implementation MTService
- (void)loadData {
  [self prepare];
}
@end

@interface MTService (Debug)
- (void)debugDump;
@end

@implementation MTService (Debug)
- (void)debugDump {}
@end
```

- [ ] **Step 2: Add block fixture**

Create `gitnexus/test/fixtures/lang-resolution/objc-blocks/App.m`:

```objective-c
typedef void (^MTCompletion)(NSString *value);

void runBlock(MTCompletion completion) {
  completion(@"done");
}

void caller(void) {
  runBlock(^(NSString *value) {
    NSLog(@"%@", value);
  });
}
```

- [ ] **Step 3: Add assertions**

Assert:

- `MTService` EXTENDS `MTBase`.
- `MTService` IMPLEMENTS `MTLoadable`.
- Category method `MTService.debugDump` is represented as method on `MTService`.
- `caller` CALLS `runBlock`.
- Block invocation is recorded as an unresolved call only if no target symbol exists, and does not crash ingestion.

- [ ] **Step 4: Run tests**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npx vitest run test/integration/resolvers/objective-c.test.ts test/unit/heritage-map.test.ts
```

Expected: Objective-C protocol/category/block tests pass and existing heritage tests pass.

---

### Task 10: Full Verification and Real Project Acceptance

- [ ] **Step 1: Run focused test suite**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npx vitest run test/unit/parser-loader.test.ts test/unit/tree-sitter-queries.test.ts test/unit/objective-c-header-detection.test.ts test/integration/query-compilation.test.ts test/integration/tree-sitter-languages.test.ts test/integration/resolvers/objective-c.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run resolver regression suite**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus
npx vitest run test/integration/resolvers
```

Expected: all pass. Pay specific attention to C++, Swift, and TypeScript receiver-resolution tests.

- [ ] **Step 3: Build packages**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
npm run build -w gitnexus-shared
npm run build -w gitnexus
```

Expected: both builds pass.

- [ ] **Step 4: Analyze the known Objective-C demo**

Run:

```bash
cd "/Users/miaotianyu/Desktop/mty/demo/父子页面联动/MTNestedListDemo"
node "/Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js" analyze --force -v
node "/Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js" query "MOSubScrollExecutor" --repo MTNestedListDemo
```

Expected:

- `.m`, `.mm`, and Objective-C `.h` files are counted as parsed, not skipped.
- `MOSubScrollExecutor` appears as a class node.
- Its methods appear with selectors.
- `[self ...]`, typed receiver message sends, imports, and superclass/protocol edges are visible in query/context output.

- [ ] **Step 5: Cypher acceptance checks**

Run:

```bash
cd "/Users/miaotianyu/Desktop/mty/demo/父子页面联动/MTNestedListDemo"
node "/Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js" cypher 'MATCH (n) WHERE n.name CONTAINS "MOSubScrollExecutor" RETURN n LIMIT 20' --repo MTNestedListDemo
node "/Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js" cypher 'MATCH (a)-[r:CALLS]->(b) WHERE a.filePath CONTAINS ".m" RETURN a.name, b.name LIMIT 50' --repo MTNestedListDemo
node "/Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js" cypher 'MATCH (a)-[r:IMPORTS]->(b) WHERE a.filePath ENDS WITH ".m" OR a.filePath ENDS WITH ".h" RETURN a.filePath, b.filePath LIMIT 50' --repo MTNestedListDemo
```

Expected: class, call, and import rows are returned.

- [ ] **Step 6: Update documentation**

Update `/Users/miaotianyu/Desktop/mty/MTObsidian/beike-personal-docs/tech-share/GitNexus适配OC及使用总结.md`:

- Replace old paths `src/languages/index.ts`, `src/languages/objc/queries.ts`, `src/parser/Resolver.ts`, `src/parser/SwiftBridge.ts` with the new provider-based paths listed in this plan.
- Add note that `.h` classification is content-aware to avoid C/C++ header regressions.
- Add validation commands from Task 10.
- Update limitation section: blocks are indexed conservatively; typed receiver message sends are supported; arbitrary dynamic `objc_msgSend` remains best-effort.

- [ ] **Step 7: Commit**

Run:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git add gitnexus-shared gitnexus docs/superpowers/plans/2026-06-03-objective-c-v2-adaptation.md
git commit -m "feat: adapt Objective-C support to new ingestion provider"
```

Expected: commit created on `objc-v2-adapt-v1.6.5`.

---

## Risk Notes

- `tree-sitter-objc` node names must be validated against the installed package. Query compilation is mandatory before any graph-level debugging.
- `.h` cannot be globally assigned to Objective-C because GitNexus already uses `.h` for C++ fixtures and real C/C++ projects.
- Worker parser wiring is mandatory. Main parser support alone is insufficient because normal analysis uses worker threads.
- Swift bridge support should prefer `*-Swift.h` import edges first; deep Swift-to-ObjC semantic bridging can be a follow-up if generated headers are insufficient.
- Objective-C dynamic dispatch is inherently less precise than Swift/Kotlin/Java static dispatch. The V2 acceptance target is typed receiver calls, selectors, imports, protocols, categories, and safe block handling.

## Self-Review

- Spec coverage: covers upstream rebase, OC language registration, parser loading, provider registration, query compilation, definitions, calls, imports, `.h` handling, Swift bridge, tests, real project verification, and documentation.
- Placeholder scan: no task is left as "TBD"; grammar query names are explicitly validated by query-compilation tests because they are package-version dependent.
- Type consistency: all new language references use `SupportedLanguages.ObjectiveC` and provider registration follows the current `LanguageProvider` architecture.
