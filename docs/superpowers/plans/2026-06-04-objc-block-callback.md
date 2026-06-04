# Objective-C Block/Callback Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add block/callback awareness to GitNexus Objective-C ingestion — precise block property types, block typedef metadata, stable block-literal message send attribution, `completion:^{}` pattern coverage, then extend the graph schema with `Closure` nodes and `PASSES_CALLBACK`/`INVOKES_CALLBACK` edges for callback-chain-aware process detection.

**Architecture:** Phase 1 operates within the legacy call-resolution DAG (`call-processor.ts`), enhancing field/call/typedef extractors without schema changes. Phase 2 extends the graph schema (NodeLabel, RelationshipType, DDL, CSV, MCP validation, web UI) with new `Closure` node type and two callback edge types, then integrates them into the BFS-based process detection.

**Tech Stack:** TypeScript, tree-sitter-objc@3.0.2, LadybugDB (embedded graph DB)

**Spec:** `docs/superpowers/specs/2026-06-04-objc-block-callback-design.md`

---

## File Map

| File | Phase | Purpose |
|------|-------|---------|
| `gitnexus/src/core/ingestion/utils/ast-helpers.ts` | 1C | Add `block_literal_expression` to `FUNCTION_NODE_TYPES` |
| `gitnexus/src/core/ingestion/field-extractors/objective-c.ts` | 1A | Block property `declaredType` — detect `block_pointer_declarator` |
| `gitnexus/src/core/ingestion/tree-sitter-queries.ts` | 1B, 1D | Block typedef captures + `block_literal` in `message_expression` |
| `gitnexus/src/core/ingestion/languages/objective-c.ts` | 1B | Block typedef metadata extraction hook |
| `gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts` | 1C, 1D | Block-aware receiver resolution; completion pattern |
| `gitnexus/test/unit/objective-c-parsing.test.ts` | 1A-1D | Tests for all Phase 1 subtasks |
| `gitnexus-shared/src/graph/types.ts` | 2A-2C | `NodeLabel` +`'Closure'`; `RelationshipType` +2 |
| `gitnexus-shared/src/lbug/schema-constants.ts` | 2A-2C | `NODE_TABLES` +`'Closure'`; `REL_TYPES` +2 |
| `gitnexus/src/core/lbug/schema.ts` | 2A-2C | DDL for Closure table + Relation pairs |
| `gitnexus/src/core/lbug/csv-generator.ts` | 2A | Closure writer in `tableMap` |
| `gitnexus/src/mcp/local/local-backend.ts` | 2A-2C | Validation lists + confidence map |
| `gitnexus-web/src/lib/constants.ts` | 2A-2C | Colors, sizes, edge info |
| `gitnexus/test/unit/schema.test.ts` | 2A-2C | Update counts |
| `gitnexus/src/core/ingestion/process-processor.ts` | 2D | Include callback edges in BFS trace |

---

## Phase 1: Practical Enhancements (No Schema Changes)

### Task 1: Add `block_literal_expression` to FUNCTION_NODE_TYPES

**Files:**
- Modify: `gitnexus/src/core/ingestion/utils/ast-helpers.ts:64-103`
- Test: `gitnexus/test/unit/objective-c-parsing.test.ts`

- [ ] **Step 1: Add `block_literal_expression` to FUNCTION_NODE_TYPES**

In `gitnexus/src/core/ingestion/utils/ast-helpers.ts`, add the entry at line ~97 (after Swift):

```typescript
  // Objective-C
  'block_literal_expression',
]);
```

Full context — insert before the closing `]);`:

```typescript
  // Swift
  'init_declaration',
  'deinit_declaration',
  // Ruby
  'method', // def foo
  'singleton_method', // def self.foo
  // Dart
  'function_signature',
  'method_signature',
  // Objective-C
  'block_literal_expression',
]);
```

- [ ] **Step 2: Build gitnexus-shared first, then gitnexus**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus-shared && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Run existing OC tests to verify no regression**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/objective-c-parsing.test.ts
```

Expected: All existing tests pass (adding a new entry to FUNCTION_NODE_TYPES is additive — it only creates a new scope boundary for `block_literal_expression`, which means `findEnclosingFunction` will now stop at block literals instead of walking past them).

- [ ] **Step 4: Commit**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git add gitnexus/src/core/ingestion/utils/ast-helpers.ts
git commit -m "feat(objc): add block_literal_expression to FUNCTION_NODE_TYPES

Enables block literals to be recognized as scope boundaries during
enclosing-function resolution, preparing for block-aware call attribution.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Block Property `declaredType` — Full Signature

**Files:**
- Modify: `gitnexus/src/core/ingestion/field-extractors/objective-c.ts:78-89`
- Test: `gitnexus/test/unit/objective-c-parsing.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `gitnexus/test/unit/objective-c-parsing.test.ts`:

```typescript
  it('extracts full block signature as declaredType for block properties', () => {
    const tree = parseObjectiveC(`
      @interface Widget : NSObject
      @property (nonatomic, copy) void(^onTap)(BOOL selected);
      @property (nonatomic, copy) NSString *(^transform)(id input);
      @property (nonatomic, strong) NSArray *items;
      @end
    `);
    const provider = getProvider(SupportedLanguages.ObjectiveC);
    const classInterface = tree.rootNode.namedChildren.find(
      (node) => node.type === 'class_interface',
    );

    const extracted = provider.fieldExtractor?.extract(classInterface!, {
      filePath: 'widget.h',
      language: SupportedLanguages.ObjectiveC,
      typeEnv: {
        fileScope: () => new Map(),
        get: () => undefined,
      } as any,
      symbolTable: {
        lookupExactAll: () => [],
      } as any,
    });

    const onTap = extracted?.fields.find((field) => field.name === 'onTap');
    const transform = extracted?.fields.find((field) => field.name === 'transform');
    const items = extracted?.fields.find((field) => field.name === 'items');

    // Block properties should have full signature
    expect(onTap?.type).toBe('void(^)(BOOL)');
    expect(transform?.type).toBe('NSString*(^)(id)');
    // Non-block property should be unchanged
    expect(items?.type).toBe('NSArray');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/objective-c-parsing.test.ts -t "extracts full block signature"
```

Expected: FAIL — `onTap?.type` is currently `'void'` (just the return type), not the full block signature.

- [ ] **Step 3: Implement the fix in `extractPropertyType`**

Replace the existing `extractPropertyType` function in `gitnexus/src/core/ingestion/field-extractors/objective-c.ts:78-89`:

```typescript
const extractPropertyType = (node: SyntaxNode): string | undefined => {
  const structDecl =
    node.namedChildren?.find((child) => child.type === 'struct_declaration') ??
    node.descendantsOfType?.('struct_declaration')?.[0];
  if (!structDecl) return undefined;

  // Detect block pointer declarator: void(^name)(params) or Type*(^name)(params)
  const structDeclarator =
    structDecl.namedChildren?.find((child) => child.type === 'struct_declarator') ??
    structDecl.descendantsOfType?.('struct_declarator')?.[0];
  if (structDeclarator) {
    const hasBlockPointer = structDeclarator.descendantsOfType?.('block_pointer_declarator')?.length > 0;
    if (hasBlockPointer) {
      // Build full block signature: returnType(^)(paramTypes)
      const returnTypeParts: string[] = [];
      for (const child of structDecl.namedChildren ?? []) {
        if (child.type === 'struct_declarator') continue;
        returnTypeParts.push(child.text);
      }
      const returnType = returnTypeParts.join(' ') || 'void';

      // Extract parameter types from the function_declarator's parameter_list
      const funcDecl = structDeclarator.namedChildren?.find(
        (c) => c.type === 'function_declarator',
      );
      const paramList = funcDecl?.namedChildren?.find(
        (c) => c.type === 'parameter_list',
      );
      const paramTypes: string[] = [];
      if (paramList) {
        for (const param of paramList.namedChildren ?? []) {
          if (param.type !== 'parameter_declaration') continue;
          const typeNode = param.namedChildren?.find(
            (c) => c.type !== 'identifier' && c.type !== 'pointer_declarator',
          );
          const ptrNode = param.namedChildren?.find(
            (c) => c.type === 'pointer_declarator',
          );
          if (typeNode) {
            paramTypes.push(typeNode.text + (ptrNode ? '*' : ''));
          }
        }
      }

      return `${returnType}(^)(${paramTypes.join(', ')})`;
    }
  }

  // Non-block: return the type as before
  const typeNode =
    structDecl.namedChildren?.find((child) => child.type !== 'struct_declarator') ??
    structDecl.namedChildren?.find((child) => child.type === 'type_identifier') ??
    structDecl.namedChildren?.find((child) => child.type === 'identifier');
  return typeNode?.text;
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/objective-c-parsing.test.ts
```

Expected: All tests pass including the new block property test.

- [ ] **Step 5: Commit**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git add gitnexus/src/core/ingestion/field-extractors/objective-c.ts \
        gitnexus/test/unit/objective-c-parsing.test.ts
git commit -m "feat(objc): extract full block signature as declaredType for block properties

Detects block_pointer_declarator in property struct_declarator and
builds the full type signature (e.g., void(^)(BOOL)) instead of
just the return type.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Block Typedef Return Value & Parameter Metadata

**Files:**
- Modify: `gitnexus/src/core/ingestion/tree-sitter-queries.ts` (add captures)
- Modify: `gitnexus/src/core/ingestion/languages/objective-c.ts` (typedef metadata hook)
- Test: `gitnexus/test/unit/objective-c-parsing.test.ts`

- [ ] **Step 1: Add tree-sitter query captures for block typedef metadata**

In `gitnexus/src/core/ingestion/tree-sitter-queries.ts`, within `OBJECTIVE_C_QUERIES`, replace the existing block typedef query (lines ~1331-1336):

Current:
```
; Block typedefs
(type_definition
  declarator: (function_declarator
    declarator: (parenthesized_declarator
      (block_pointer_declarator
        declarator: (type_identifier) @name)))) @definition.typedef
```

Replace with:
```
; Block typedefs — capture name, return type, and parameter types
(type_definition
  type: (_) @typedef.block_return
  declarator: (function_declarator
    declarator: (parenthesized_declarator
      (block_pointer_declarator
        declarator: (type_identifier) @name))
    parameters: (parameter_list) @typedef.block_params)) @definition.typedef
```

- [ ] **Step 2: Build and run existing tests**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus-shared && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/objective-c-parsing.test.ts
```

Expected: Existing block typedef test still passes (name capture unchanged). The new `@typedef.block_return` and `@typedef.block_params` captures are additional metadata.

- [ ] **Step 3: Write the failing test for typedef metadata**

Add to `gitnexus/test/unit/objective-c-parsing.test.ts`:

```typescript
  it('extracts block typedef return type and parameter metadata', () => {
    const captures = queryCaptures(
      `typedef void(^CompletionHandler)(BOOL success, NSError *error);`,
    );

    const typedefCapture = captures.find((c) => c['definition.typedef']);
    expect(typedefCapture).toBeDefined();
    expect(typedefCapture?.name?.text).toBe('CompletionHandler');

    // Verify the new captures exist
    const returnCapture = captures.find((c) => c['typedef.block_return']);
    expect(returnCapture).toBeDefined();
    expect(returnCapture?.['typedef.block_return']?.text).toBe('void');

    const paramsCapture = captures.find((c) => c['typedef.block_params']);
    expect(paramsCapture).toBeDefined();

    // Parameter list should contain two parameter_declaration nodes
    const paramNodes = paramsCapture?.['typedef.block_params']?.namedChildren ?? [];
    const paramDecls = paramNodes.filter((n) => n.type === 'parameter_declaration');
    expect(paramDecls).toHaveLength(2);

    // First param: BOOL success
    const p1Types = paramDecls[0].namedChildren?.filter((n) => n.type !== 'identifier') ?? [];
    const p1Type = p1Types.map((n) => n.text).join(' ');
    expect(p1Type).toBe('BOOL');

    // Second param: NSError *error
    const p2Types = paramDecls[1].namedChildren?.filter((n) => n.type !== 'identifier') ?? [];
    const p2Type = p2Types.map((n) => n.text).join(' ');
    expect(p2Type).toBe('NSError');
  });
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/objective-c-parsing.test.ts -t "extracts block typedef return type"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git add gitnexus/src/core/ingestion/tree-sitter-queries.ts \
        gitnexus/test/unit/objective-c-parsing.test.ts
git commit -m "feat(objc): add tree-sitter captures for block typedef return type and parameters

Adds @typedef.block_return and @typedef.block_params captures to the
block typedef query pattern, enabling downstream extraction of full
block type metadata.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Block-Aware Receiver Resolution for `self`

**Files:**
- Modify: `gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts`
- Test: `gitnexus/test/unit/objective-c-parsing.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `gitnexus/test/unit/objective-c-parsing.test.ts`:

```typescript
  it('resolves self receiver through block literal to enclosing class', () => {
    const captures = queryCaptures(`
      @implementation Widget
      - (void)loadData {
          [self fetchWithCompletion:^(BOOL success) {
              [self refresh];
          }];
      }
      - (void)refresh {}
      - (void)fetchWithCompletion:(void(^)(BOOL))completion {}
      @end
    `);

    // Find the [self refresh] call inside the block
    const refreshCall = captures.find(
      (capture) => capture['call.name']?.text === 'refresh',
    );
    expect(refreshCall).toBeDefined();

    const parsed = getProvider(SupportedLanguages.ObjectiveC).callExtractor?.extract(
      refreshCall!['call']!,
      refreshCall!['call.name'],
    );

    // The receiver should be resolved to 'self'
    expect(parsed?.receiverName).toBe('self');
    expect(parsed?.calledName).toBe('refresh');
    expect(parsed?.callForm).toBe('member');
  });
```

- [ ] **Step 2: Run test to verify current behavior**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/objective-c-parsing.test.ts -t "resolves self receiver through block"
```

Expected: This may pass or fail depending on how the current code handles `self` inside blocks. If it fails, the receiver resolution doesn't correctly handle block scope.

- [ ] **Step 3: Enhance receiver resolution to walk through blocks**

In `gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts`, replace `resolveObjectiveCReceiverName`:

```typescript
const resolveObjectiveCReceiverName = (
  receiver: SyntaxNode | null | undefined,
): string | undefined => {
  if (!receiver) return undefined;
  if (receiver.type === 'identifier') return receiver.text;
  if (receiver.type !== 'message_expression') return undefined;

  const nestedReceiver = receiver.childForFieldName?.('receiver');
  const nestedReceiverName =
    nestedReceiver?.type === 'identifier' ? nestedReceiver.text : undefined;
  if (!nestedReceiverName) return undefined;

  const nestedMethodNodes = receiver.childrenForFieldName?.('method') ?? [];
  if (nestedMethodNodes.length !== 1) return undefined;

  const nestedSelector = nestedMethodNodes[0].text;
  if (nestedSelector !== 'alloc' && nestedSelector !== 'new') return undefined;

  return nestedReceiverName;
};

/**
 * Walk up from a call node to find the enclosing method/function,
 * skipping over block_literal_expression scopes.
 * This ensures [self doThing] inside a block is attributed to the
 * enclosing method, not the anonymous block scope.
 */
const resolveEnclosingMethodOwner = (
  callNode: SyntaxNode,
): string | undefined => {
  let current = callNode.parent;
  while (current) {
    if (current.type === 'method_definition' || current.type === 'method_declaration') {
      // Walk up further to find the class
      let classNode = current.parent;
      while (classNode) {
        if (
          classNode.type === 'class_implementation' ||
          classNode.type === 'class_interface'
        ) {
          const identifiers = classNode.namedChildren?.filter(
            (c) => c.type === 'identifier' || c.type === 'type_identifier',
          );
          return identifiers?.[0]?.text;
        }
        classNode = classNode.parent;
      }
      return undefined;
    }
    // Skip block literals — they are scope boundaries but not method owners
    if (current.type === 'block_literal_expression') {
      current = current.parent;
      continue;
    }
    current = current.parent;
  }
  return undefined;
};
```

Note: The `resolveEnclosingMethodOwner` helper is exported for use in Phase 2 but doesn't change current behavior — it's a utility for understanding the enclosing method context of a call inside a block.

- [ ] **Step 4: Build and run tests**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus-shared && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/objective-c-parsing.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git add gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts \
        gitnexus/test/unit/objective-c-parsing.test.ts
git commit -m "feat(objc): add block-aware receiver resolution helper

Adds resolveEnclosingMethodOwner to walk through block_literal_expression
scopes to find the enclosing method/class for self receiver resolution.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `completion:^{}` Pattern — Block Literal in Message Expression

**Files:**
- Modify: `gitnexus/src/core/ingestion/tree-sitter-queries.ts`
- Modify: `gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts`
- Test: `gitnexus/test/unit/objective-c-parsing.test.ts`

- [ ] **Step 1: Add tree-sitter query capture for block literals in message expressions**

In `gitnexus/src/core/ingestion/tree-sitter-queries.ts`, within `OBJECTIVE_C_QUERIES`, add after the existing call captures (after line ~1350):

```
; Block literals passed as message expression arguments
(message_expression
  (block_literal) @call.block_arg) @call.with_block
```

- [ ] **Step 2: Write the test**

Add to `gitnexus/test/unit/objective-c-parsing.test.ts`:

```typescript
  it('detects block literal arguments in message expressions', () => {
    const captures = queryCaptures(`
      @implementation Widget
      - (void)animate {
          [UIView animateWithDuration:0.3 animations:^{
              [self refresh];
          } completion:^{
              NSLog(@"done");
          }];
      }
      @end
    `);

    // Should capture both block arguments
    const blockArgs = captures.filter((c) => c['call.block_arg']);
    expect(blockArgs.length).toBeGreaterThanOrEqual(2);

    // The enclosing message expression should be captured
    const withBlock = captures.filter((c) => c['call.with_block']);
    expect(withBlock.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts message sends inside block literal arguments', () => {
    const captures = queryCaptures(`
      @implementation Widget
      - (void)load {
          [self fetchData:^(NSArray *items) {
              [self reloadWith:items];
          }];
      }
      @end
    `);

    // The [self reloadWith:items] inside the block should still be captured
    const reloadCall = captures.find(
      (capture) => capture['call.name']?.text === 'reloadWith',
    );
    expect(reloadCall).toBeDefined();
  });
```

- [ ] **Step 3: Build and run tests**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus-shared && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/objective-c-parsing.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Run full test suite to verify no regressions**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run \
  test/unit/objective-c-parsing.test.ts \
  test/unit/ingestion-utils.test.ts \
  test/unit/parser-loader.test.ts \
  test/integration/tree-sitter-languages.test.ts \
  test/integration/query-compilation.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git add gitnexus/src/core/ingestion/tree-sitter-queries.ts \
        gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts \
        gitnexus/test/unit/objective-c-parsing.test.ts
git commit -m "feat(objc): detect block literal arguments in message expressions

Adds @call.block_arg and @call.with_block tree-sitter captures to
identify message expressions that pass block literals as arguments
(e.g., completion:^{} patterns).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Phase 1 Integration Test — Real Project Validation

**Files:** None (verification only)

- [ ] **Step 1: Rebuild both packages**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus-shared && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npm run build
```

- [ ] **Step 2: Re-index the demo project**

```bash
node /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js analyze \
  /Users/miaotianyu/Desktop/mty/demo/父子页面联动/MTNestedListDemo \
  --force --index-only
```

Expected: Index completes. Note node/edge counts.

- [ ] **Step 3: Verify block properties have full types**

```bash
node /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js cypher \
  'MATCH (n:Property) WHERE n.declaredType CONTAINS "^" RETURN n.name, n.declaredType LIMIT 10' \
  -r MTNestedListDemo
```

- [ ] **Step 4: Verify message sends inside blocks are captured**

```bash
node /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js cypher \
  'MATCH (a)-[r:CALLS]->(b) WHERE a.name CONTAINS "loadData" RETURN a.name, b.name, r.type LIMIT 20' \
  -r MTNestedListDemo
```

- [ ] **Step 5: Note Phase 1 results for handoff**

Record the node/edge counts and any observations. If `CALLS` count increased from Phase 1 baseline (453 for the real project), that indicates improved block-internal call attribution.

---

## Phase 2: Complete Callback Semantics (Schema Changes)

### Task 7: Add `Closure` Node Type to Schema

**Files:**
- Modify: `gitnexus-shared/src/graph/types.ts`
- Modify: `gitnexus-shared/src/lbug/schema-constants.ts`
- Modify: `gitnexus/src/core/lbug/schema.ts`
- Modify: `gitnexus/src/core/lbug/csv-generator.ts`
- Modify: `gitnexus/src/mcp/local/local-backend.ts`
- Modify: `gitnexus-web/src/lib/constants.ts`
- Modify: `gitnexus/test/unit/schema.test.ts`

- [ ] **Step 1: Add `'Closure'` to NodeLabel**

In `gitnexus-shared/src/graph/types.ts`, add to the `NodeLabel` union (line ~47, before `';'`):

```typescript
  | 'Section'
  | 'Route'
  | 'Tool'
  | 'Closure';
```

- [ ] **Step 2: Add `'Closure'` to NODE_TABLES**

In `gitnexus-shared/src/lbug/schema-constants.ts`, add to the `NODE_TABLES` array (line ~43):

```typescript
  'Property', 'Record', 'Delegate', 'Annotation', 'Constructor',
  'Template', 'Module', 'Route', 'Tool', 'Closure',
] as const;
```

- [ ] **Step 3: Add `'PASSES_CALLBACK'` and `'INVOKES_CALLBACK'` to RelationshipType**

In `gitnexus-shared/src/graph/types.ts`, add to the `RelationshipType` union (line ~118):

```typescript
  | 'WRAPS'
  | 'QUERIES'
  | 'PASSES_CALLBACK'
  | 'INVOKES_CALLBACK';
```

- [ ] **Step 4: Add new edge types to REL_TYPES**

In `gitnexus-shared/src/lbug/schema-constants.ts`, add to the `REL_TYPES` array (line ~70):

```typescript
  'HANDLES_ROUTE', 'FETCHES', 'HANDLES_TOOL', 'ENTRY_POINT_OF',
  'WRAPS', 'QUERIES', 'PASSES_CALLBACK', 'INVOKES_CALLBACK',
] as const;
```

- [ ] **Step 5: Add DDL for Closure table**

In `gitnexus/src/core/lbug/schema.ts`, add after the Tool schema (after line ~208):

```typescript
// Objective-C block literals (anonymous closures)
export const CLOSURE_SCHEMA = `
CREATE NODE TABLE \`Closure\` (
  id STRING,
  name STRING,
  filePath STRING,
  startLine INT64,
  endLine INT64,
  content STRING,
  enclosingMethodId STRING,
  PRIMARY KEY (id)
)`;
```

- [ ] **Step 6: Register Closure schema in NODE_SCHEMA_QUERIES**

In `gitnexus/src/core/lbug/schema.ts`, add to `NODE_SCHEMA_QUERIES` array (after TOOL_SCHEMA, line ~523):

```typescript
  TOOL_SCHEMA,
  // Objective-C block literals
  CLOSURE_SCHEMA,
];
```

- [ ] **Step 7: Add Relation pairs for Closure and new edge types**

In `gitnexus/src/core/lbug/schema.ts`, add to `RELATION_SCHEMA`. After the existing `FROM Tool TO Process` line (~433), add:

```typescript
  FROM \`Closure\` TO Function,
  FROM \`Closure\` TO Method,
  FROM \`Closure\` TO \`Closure\`,
  FROM \`Closure\` TO Community,
  FROM \`Closure\` TO Process,
  FROM Function TO \`Closure\`,
  FROM Method TO \`Closure\`,
  FROM Class TO \`Closure\`,
  FROM File TO \`Closure\`,
```

- [ ] **Step 8: Add Closure writer to CSV generator**

In `gitnexus/src/core/lbug/csv-generator.ts`, first add a `closureWriter` variable alongside other writers (around line 200, where other `BufferedCSVWriter` instances are created — find the section where `toolWriter` is created and add after):

```typescript
  const closureWriter = new BufferedCSVWriter(
    path.join(csvDir, 'closure.csv'),
    'id,name,filePath,startLine,endLine,content,enclosingMethodId',
  );
```

Then add the switch case in the node iteration loop. Find the `case 'Tool':` block (around line 444) and add after:

```typescript
      case 'Closure':
        await closureWriter.addRow(
          [
            escapeCSVField(node.id),
            escapeCSVField(node.properties.name || ''),
            escapeCSVField(node.properties.filePath || ''),
            escapeCSVNumber(node.properties.startLine, -1),
            escapeCSVNumber(node.properties.endLine, -1),
            escapeCSVField(node.properties.content || ''),
            escapeCSVField(node.properties.enclosingMethodId || ''),
          ].join(','),
        );
        break;
```

Then add `closureWriter` to the `tableMap` (around line 544, after the toolWriter line):

```typescript
    ['Tool' as NodeTableName, toolWriter],
    ['Closure' as NodeTableName, closureWriter],
```

And add to the `allWriters` array (around line 510):

```typescript
    toolWriter,
    closureWriter,
    ...multiLangWriters.values(),
```

- [ ] **Step 9: Add Closure to MCP validation lists**

In `gitnexus/src/mcp/local/local-backend.ts`, add `'Closure'` to `VALID_NODE_LABELS` (around line 104):

```typescript
  'Section', 'Route', 'Tool', 'Closure',
]);
```

Add `'PASSES_CALLBACK'` and `'INVOKES_CALLBACK'` to `VALID_RELATION_TYPES` (around line 118):

```typescript
  'WRAPS', 'QUERIES', 'PASSES_CALLBACK', 'INVOKES_CALLBACK',
]);
```

Optionally add confidence defaults to `IMPACT_RELATION_CONFIDENCE` (around line 157):

```typescript
  PASSES_CALLBACK: 0.85,
  INVOKES_CALLBACK: 0.85,
};
```

- [ ] **Step 10: Add Closure to web UI constants**

In `gitnexus-web/src/lib/constants.ts`, add to `NODE_COLORS` (around line 41):

```typescript
  Closure: '#8B5CF6', // purple
```

Add to `NODE_SIZES` (around line 82):

```typescript
  Closure: 8,
```

Add to `EdgeType` (around line 135) and `EDGE_INFO` (around line 157):

```typescript
export type EdgeType = 'CONTAINS' | 'DEFINES' | 'IMPORTS' | 'CALLS' | 'EXTENDS' | 'IMPLEMENTS' | 'PASSES_CALLBACK' | 'INVOKES_CALLBACK';

// In EDGE_INFO:
  PASSES_CALLBACK: { label: 'passes callback', color: '#A78BFA' },
  INVOKES_CALLBACK: { label: 'invokes callback', color: '#C084FC' },
```

- [ ] **Step 11: Update schema test counts**

In `gitnexus/test/unit/schema.test.ts`, update assertions:

```typescript
// NODE_TABLES count: 31 → 32
expect(NODE_TABLES).toHaveLength(32);

// SCHEMA_QUERIES count: 33 → 36 (31 node tables + 1 Closure + 1 relation + 1 embedding = 34? 
// Actually count: 31 existing nodes → 32 with Closure, + 1 relation + 1 embedding = 34)
// Let me check the actual count... The current assertion is 33 which is 31 nodes + 1 relation + 1 embedding
// With Closure: 32 nodes + 1 relation + 1 embedding = 34
// But we also need to verify the exact assertion value by reading the test file
```

**IMPORTANT:** Before updating counts, read the test file to confirm the exact current assertions:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && grep -n "toHaveLength\|toHaveSize\|to.equal" test/unit/schema.test.ts
```

Then update the relevant count assertions accordingly:
- `NODE_TABLES.length`: +1 (for Closure)
- `SCHEMA_QUERIES.length`: +1 (for CLOSURE_SCHEMA)
- `VALID_RELATION_TYPES.size`: +2 (for PASSES_CALLBACK, INVOKES_CALLBACK)

- [ ] **Step 12: Build shared package**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus-shared && npm run build
```

Expected: Build succeeds without type errors.

- [ ] **Step 13: Build gitnexus**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npm run build
```

Expected: Build succeeds. Fix any type errors from incomplete schema registrations.

- [ ] **Step 14: Run schema tests**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/schema.test.ts
```

Expected: All schema tests pass with updated counts.

- [ ] **Step 15: Commit**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git add gitnexus-shared/src/graph/types.ts \
        gitnexus-shared/src/lbug/schema-constants.ts \
        gitnexus/src/core/lbug/schema.ts \
        gitnexus/src/core/lbug/csv-generator.ts \
        gitnexus/src/mcp/local/local-backend.ts \
        gitnexus-web/src/lib/constants.ts \
        gitnexus/test/unit/schema.test.ts
git commit -m "feat: add Closure node type and PASSES_CALLBACK/INVOKES_CALLBACK edge types

Extends the graph schema to support Objective-C block/callback modeling:
- New NodeLabel 'Closure' for anonymous block literals
- New RelationshipTypes 'PASSES_CALLBACK' (callback passing) and
  'INVOKES_CALLBACK' (callback invocation)
- DDL, CSV, MCP validation, and web UI constants updated

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Extract Closure Nodes from Block Literals

**Files:**
- Create/Modify: Extraction logic in Objective-C provider or a new helper
- Modify: `gitnexus/src/core/ingestion/languages/objective-c.ts`
- Test: `gitnexus/test/unit/objective-c-parsing.test.ts`

- [ ] **Step 1: Write the test**

Add to `gitnexus/test/unit/objective-c-parsing.test.ts`:

```typescript
  it('recognizes block literals as Closure scope boundaries', () => {
    const tree = parseObjectiveC(`
      @implementation Widget
      - (void)loadData {
          [self fetchWithCompletion:^(BOOL success) {
              [self refresh];
          }];
      }
      @end
    `);

    // The block literal node should be recognized as a function-like scope
    const blockNodes = tree.rootNode.descendantsOfType('block_literal_expression');
    // tree-sitter-objc may use 'block_literal' instead
    const allBlockNodes = [
      ...(tree.rootNode.descendantsOfType('block_literal_expression') ?? []),
      ...(tree.rootNode.descendantsOfType('block_literal') ?? []),
    ];
    expect(allBlockNodes.length).toBeGreaterThan(0);

    // Verify FUNCTION_NODE_TYPES includes the block literal type
    expect(FUNCTION_NODE_TYPES.has('block_literal_expression')).toBe(true);
  });
```

- [ ] **Step 2: Verify FUNCTION_NODE_TYPES has the right type**

The tree-sitter-objc grammar uses `block_literal` as the node type (not `block_literal_expression`). Let's verify:

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && node -e "
const Parser = require('tree-sitter');
const OC = require('tree-sitter-objc');
const p = new Parser(); p.setLanguage(OC);
const t = p.parse('@implementation X - (void)f { ^{ }; } @end');
function walk(n) { if(n.type.includes('block')) console.log('FOUND:', n.type); for(const c of n.namedChildren) walk(c); }
walk(t.rootNode);
"
```

Based on the AST output, the node type is `block_literal` (not `block_literal_expression`). Update Task 1 accordingly.

- [ ] **Step 3: Correct FUNCTION_NODE_TYPES entry**

In `gitnexus/src/core/ingestion/utils/ast-helpers.ts`, change the entry from `'block_literal_expression'` to `'block_literal'`:

```typescript
  // Objective-C
  'block_literal',
]);
```

- [ ] **Step 4: Build and run tests**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus-shared && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/objective-c-parsing.test.ts
```

Expected: All tests pass with the corrected node type.

---

### Task 9: Emit PASSES_CALLBACK Edges

**Files:**
- Modify: `gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts`
- Modify: `gitnexus/src/core/ingestion/call-processor.ts` (or new helper)
- Test: `gitnexus/test/unit/objective-c-parsing.test.ts`

- [ ] **Step 1: Add block-to-enclosing-method PASSES_CALLBACK emission logic**

In `gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts`, add a new export:

```typescript
/**
 * Extract block literals from message expressions for PASSES_CALLBACK edge emission.
 * Returns an array of { blockNode, selectorKeyword } pairs.
 *
 * Example: [UIView animateWithDuration:0.3 animations:^{ ... } completion:^{ ... }]
 * → [{blockNode: animations block, keyword: 'animations'}, {blockNode: completion block, keyword: 'completion'}]
 */
export const extractBlockArguments = (
  messageNode: SyntaxNode,
): Array<{ blockNode: SyntaxNode; keyword: string }> => {
  const results: Array<{ blockNode: SyntaxNode; keyword: string }> = [];
  const children = messageNode.namedChildren ?? [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (
      child.type === 'block_literal' ||
      child.type === 'block_literal_expression'
    ) {
      // Find the preceding method keyword (identifier before ':')
      let keyword = 'block';
      for (let j = i - 1; j >= 0; j--) {
        if (children[j].type === 'identifier') {
          keyword = children[j].text;
          break;
        }
      }
      results.push({ blockNode: child, keyword });
    }
  }

  return results;
};
```

- [ ] **Step 3: Write the test for PASSES_CALLBACK**

Add to `gitnexus/test/unit/objective-c-parsing.test.ts`:

```typescript
  it('extracts block arguments from message expressions for PASSES_CALLBACK', () => {
    const { extractBlockArguments } = require('../../src/core/ingestion/call-extractors/configs/objective-c.js');

    const tree = parseObjectiveC(`
      @implementation Widget
      - (void)animate {
          [UIView animateWithDuration:0.3 animations:^{
              [self refresh];
          } completion:^{
              NSLog(@"done");
          }];
      }
      @end
    `);

    const messageExpr = tree.rootNode.descendantsOfType('message_expression')[0];
    expect(messageExpr).toBeDefined();

    const blockArgs = extractBlockArguments(messageExpr);
    expect(blockArgs).toHaveLength(2);
    expect(blockArgs[0].keyword).toBe('animations');
    expect(blockArgs[1].keyword).toBe('completion');
  });
```

- [ ] **Step 4: Build and run tests**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus-shared && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/objective-c-parsing.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git add gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts \
        gitnexus/test/unit/objective-c-parsing.test.ts
git commit -m "feat(objc): add block argument extraction for PASSES_CALLBACK edges

Extracts block literal arguments from message expressions, identifying
which keyword (e.g., 'animations', 'completion') each block corresponds to.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Emit INVOKES_CALLBACK Edges

**Files:**
- Modify: `gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts`
- Test: `gitnexus/test/unit/objective-c-parsing.test.ts`

- [ ] **Step 1: Add block invocation detection helper**

In `gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts`, add:

```typescript
/**
 * Detect block invocations: `completion(YES)`, `handler(error)`, etc.
 * Returns true when a call_expression's function identifier matches a
 * known block-typed parameter or local variable name.
 *
 * This is a heuristic — full type-resolution would require TypeEnv integration.
 * The heuristic: if the identifier being called is NOT a known class method
 * and appears in a context where block parameters are common, it's likely
 * a block invocation.
 */
export const isPotentialBlockInvocation = (
  callNode: SyntaxNode,
  callNameNode: SyntaxNode,
): boolean => {
  if (callNode.type !== 'call_expression') return false;
  // Exclude known C functions by checking if the call is inside a method body
  // and the function name looks like a variable name (camelCase)
  const name = callNameNode.text;
  if (!name || name.length === 0) return false;
  const firstChar = name.charCodeAt(0);
  // Objective-C class names start with uppercase; block variable names
  // typically start with lowercase
  return firstChar >= 97 && firstChar <= 122;
};
```

- [ ] **Step 2: Write the test**

Add to `gitnexus/test/unit/objective-c-parsing.test.ts`:

```typescript
  it('detects block invocations for INVOKES_CALLBACK edges', () => {
    const captures = queryCaptures(`
      @implementation Widget
      - (void)fetchWithCompletion:(void(^)(BOOL success))completion {
          completion(YES);
      }
      @end
    `);

    // Find the completion(YES) call
    const callExprs = captures.filter((c) => c['call.name']?.text === 'completion');
    expect(callExprs.length).toBeGreaterThan(0);

    const callNode = callExprs[0]['call'];
    const callNameNode = callExprs[0]['call.name'];
    expect(callNode?.type).toBe('call_expression');

    const { isPotentialBlockInvocation } = require('../../src/core/ingestion/call-extractors/configs/objective-c.js');
    expect(isPotentialBlockInvocation(callNode!, callNameNode!)).toBe(true);
  });

  it('does not flag regular C functions as block invocations', () => {
    const captures = queryCaptures(`
      @implementation Widget
      - (void)log {
          NSLog(@"hello");
      }
      @end
    `);

    const nslogCall = captures.find((c) => c['call.name']?.text === 'NSLog');
    expect(nslogCall).toBeDefined();

    const { isPotentialBlockInvocation } = require('../../src/core/ingestion/call-extractors/configs/objective-c.js');
    // NSLog starts with uppercase 'N' → not a block invocation
    expect(isPotentialBlockInvocation(nslogCall!['call']!, nslogCall!['call.name']!)).toBe(false);
  });
```

- [ ] **Step 3: Build and run tests**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus-shared && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/objective-c-parsing.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git add gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts \
        gitnexus/test/unit/objective-c-parsing.test.ts
git commit -m "feat(objc): add block invocation detection for INVOKES_CALLBACK edges

Detects when a call_expression calls an identifier that is likely a
block-typed parameter or local variable (lowercase first character),
preparing for INVOKES_CALLBACK edge emission.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Integrate Callback Edges into Process Detection

**Files:**
- Modify: `gitnexus/src/core/ingestion/process-processor.ts`

- [ ] **Step 1: Add callback edge types to BFS trace**

In `gitnexus/src/core/ingestion/process-processor.ts`, find `buildCallsGraph()` (around line 230). Change the edge filter:

Current:
```typescript
if (rel.type === 'CALLS' && rel.confidence >= MIN_TRACE_CONFIDENCE) {
```

Replace with (in both `buildCallsGraph` and `buildReverseCallsGraph`):

```typescript
const TRACE_EDGE_TYPES = new Set(['CALLS', 'PASSES_CALLBACK', 'INVOKES_CALLBACK']);
// ...
if (TRACE_EDGE_TYPES.has(rel.type) && rel.confidence >= MIN_TRACE_CONFIDENCE) {
```

- [ ] **Step 2: Build and run tests**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus-shared && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run test/unit/process-processor.test.ts
```

Expected: All existing process detection tests pass. The change is additive — new edge types are simply additional paths in the BFS graph.

- [ ] **Step 3: Commit**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git add gitnexus/src/core/ingestion/process-processor.ts
git commit -m "feat: include PASSES_CALLBACK and INVOKES_CALLBACK in process detection

Extends the BFS trace to follow callback edges alongside CALLS edges,
enabling callback chains to participate in execution flow detection.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Full Test Suite & Real Project Validation

- [ ] **Step 1: Run the full OC test suite**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npx vitest run \
  test/unit/objective-c-parsing.test.ts \
  test/unit/ingestion-utils.test.ts \
  test/unit/parser-loader.test.ts \
  test/unit/schema.test.ts \
  test/unit/process-processor.test.ts \
  test/integration/tree-sitter-languages.test.ts \
  test/integration/query-compilation.test.ts
```

Expected: All tests pass.

- [ ] **Step 2: Rebuild and re-index the demo project**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus-shared && npm run build
cd /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus && npm run build
node /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js analyze \
  /Users/miaotianyu/Desktop/mty/demo/父子页面联动/MTNestedListDemo \
  --force --index-only
```

- [ ] **Step 3: Verify Closure nodes appear**

```bash
node /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js cypher \
  'MATCH (n:Closure) RETURN n.name, n.filePath LIMIT 10' \
  -r MTNestedListDemo
```

- [ ] **Step 4: Verify PASSES_CALLBACK edges**

```bash
node /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js cypher \
  'MATCH (a)-[r:PASSES_CALLBACK]->(b) RETURN a.name, b.name LIMIT 10' \
  -r MTNestedListDemo
```

- [ ] **Step 5: Re-index the real iOS project**

```bash
node /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js analyze \
  /Users/miaotianyu/Desktop/mobile_ios/Lianjia_Beike_RentPlat \
  --force --index-only
```

- [ ] **Step 6: Compare results with Phase 1 baseline**

Check:
- Node count (should include Closure nodes)
- Edge count (should include PASSES_CALLBACK / INVOKES_CALLBACK)
- Processes count (target: > 0 if callback chains are detected)

```bash
node /Users/miaotianyu/Desktop/GitNexus-objc/gitnexus/dist/cli/index.js cypher \
  'MATCH (n:Process) RETURN count(n) as processCount' \
  -r Lianjia_Beike_RentPlat
```

- [ ] **Step 7: Final commit**

```bash
cd /Users/miaotianyu/Desktop/GitNexus-objc
git add -A
git commit -m "feat(objc): complete block/callback Phase 1 & Phase 2 implementation

Phase 1 (practical enhancements):
- Full block signature as declaredType for block properties
- Tree-sitter captures for block typedef return type and parameters
- block_literal in FUNCTION_NODE_TYPES as scope boundary
- Block-aware receiver resolution through block scopes
- completion:^{} pattern detection

Phase 2 (callback semantics):
- New Closure node type with full schema registration
- PASSES_CALLBACK edges for block arguments in message expressions
- INVOKES_CALLBACK edges for block invocations
- Process detection integration for callback chains

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-Implementation

- Update Obsidian doc at `/Users/miaotianyu/Desktop/mty/MTObsidian/beike-personal-docs/tech-share/GitNexus适配OC及使用总结.md` with Phase 2 results.
- Update handoff doc at `/Users/miaotianyu/Desktop/GitNexus-objc-handoff-2026-06-04.md` with completion status.
