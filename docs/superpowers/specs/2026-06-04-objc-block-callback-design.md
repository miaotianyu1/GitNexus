# GitNexus Objective-C Block/Callback Enhancement Design

**Date:** 2026-06-04
**Status:** Approved
**Base:** GitNexus v1.6.5, branch `objc-v2-adapt-v1.6.5`

## Overview

Enhance GitNexus's Objective-C code intelligence with block/callback awareness, delivered in two phases:

- **Phase 1 (Practical):** Improve block-related precision within the existing graph schema — block property types, block typedef metadata, block-literal message send attribution, and `completion:^{}` pattern coverage.
- **Phase 2 (Semantic):** Extend the graph schema with `Closure` nodes, `PASSES_CALLBACK` / `INVOKES_CALLBACK` edges, and integrate callback chains into process detection.

## Architecture Context

Objective-C currently runs on the **legacy call-resolution DAG** path (`call-processor.ts`), not the registry-primary scope-resolution pipeline. Key implications:

- Calls are attributed via `findEnclosingFunction()` which walks the AST parent chain.
- `FUNCTION_NODE_TYPES` in `ast-helpers.ts` does NOT include `block_literal_expression`.
- There is no scope-extractor or scope-resolver for Objective-C.
- Phase 1 operates entirely within this legacy path. Phase 2 adds schema-level constructs.

## Phase 1: Practical Enhancements

### 1A: Block Property `declaredType` Precision

**Current:** `extractPropertyType()` in `field-extractors/objective-c.ts:78-89` picks the first non-`struct_declarator` child of `struct_declaration` as the type. For `void(^onTap)(BOOL)`, it returns only `void`.

**Target:** Extract the full block signature: `void(^)(BOOL)`.

**AST path:**
```
property_declaration → struct_declaration → struct_declarator
  → function_declarator
    → declarator: parenthesized_declarator → block_pointer_declarator → identifier ("onTap")
    → parameters: parameter_list → ...
```

**Implementation:**
- In `extractPropertyType`, detect `block_pointer_declarator` inside `struct_declarator`.
- Walk up to `function_declarator`, extract return type + parameter list → synthesize `"returnType(^)(paramTypes)"`.

**Files:** `gitnexus/src/core/ingestion/field-extractors/objective-c.ts`

### 1B: Block Typedef Return Value & Parameter Metadata

**Current:** Tree-sitter query captures block typedef names as `@definition.typedef` but discards return type and parameter metadata.

**AST path:**
```
type_definition
  type: primitive_type ("void")
  declarator: function_declarator
    declarator: parenthesized_declarator → block_pointer_declarator → type_identifier ("Handler")
    parameters: parameter_list → parameter_declaration* → (type, declarator)
```

**Implementation:**
- Add tree-sitter query captures for block typedef components: `@typedef.block_return`, `@typedef.block_param.*`
- OR: Add a JS-level helper that walks `type_definition` AST nodes matching `block_pointer_declarator` and extracts structured metadata.
- Store extracted metadata as node properties on the Typedef node.

**Files:**
- `gitnexus/src/core/ingestion/tree-sitter-queries.ts`
- `gitnexus/src/core/ingestion/languages/objective-c.ts` (or new helper in `method-extractors/`)

### 1C: Block Literal Message Send Attribution

**Current:** `findEnclosingFunction` skips `block_literal_expression` (not in `FUNCTION_NODE_TYPES`) and finds the outer method. Call attribution to method works, but `self` receiver resolution inside blocks may be fragile.

**AST path for message send inside block:**
```
message_expression → ... → compound_statement → block_literal
  → ... → message_expression (outer) → compound_statement → method_definition
```

**Implementation:**
- Add `block_literal_expression` to `FUNCTION_NODE_TYPES` in `ast-helpers.ts` so it's recognized as a scope boundary.
- In call extraction, when receiver is `self` and the immediate enclosing scope is a `block_literal_expression`, continue walking up to find the enclosing class/method for receiver resolution.
- Mark `receiverSource` appropriately to distinguish block-captured `self` from direct `self`.

**Files:**
- `gitnexus/src/core/ingestion/utils/ast-helpers.ts`
- `gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts`

### 1D: `completion:^{}` Pattern Coverage

**Current:** Message expressions with block literal arguments are parsed but the block argument semantics are not leveraged.

**AST:**
```
message_expression
  receiver: identifier ("UIView")
  method: identifier ("animateWithDuration:")
  number_literal
  method: identifier ("animations:")
  block_literal → compound_statement → ...
  method: identifier ("completion:")
  block_literal → compound_statement → ...
```

**Implementation:**
- Add tree-sitter query to capture `block_literal` nodes that are direct children of `message_expression`.
- In call extraction, detect block literal parameters and ensure message sends inside them are extracted and attributed.
- Track: "this method passes N blocks to M distinct message sends."

**Files:**
- `gitnexus/src/core/ingestion/tree-sitter-queries.ts`
- `gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts`

## Phase 2: Complete Callback Semantics

### 2A: Closure Nodes

**New NodeLabel:** `'Closure'`

- Each `block_literal` AST node → one `Closure` graph node.
- Naming: `block_<fileName>_L<lineNumber>` (synthetic, no user-defined name).
- `DEFINES` edge: enclosing Method/Function/File → Closure.
- `CONTAINS` edge: Closure → internal message send call nodes.
- `CALLS` edge: Closure → methods called inside the block body.

### 2B: PASSES_CALLBACK Edges

**New RelationshipType:** `'PASSES_CALLBACK'`

Semantics: "Caller passes a block/callback to a callee."

Detection: When a `message_expression` has `block_literal` children:
- `[obj animateWithDuration:0.3 animations:^{ ... }]`
- → `PASSES_CALLBACK` from enclosing method → Closure node for the `animations:` block
- → `CALLS` from enclosing method → `animateWithDuration:animations:` (existing)

### 2C: INVOKES_CALLBACK Edges

**New RelationshipType:** `'INVOKES_CALLBACK'`

Semantics: "Caller invokes a stored block/callback."

Detection: When a `call_expression` calls an identifier that resolves to a block-typed parameter or local variable:
- `completion(YES)` where `completion` is a block-typed parameter
- → `INVOKES_CALLBACK` from current method → the Closure or block variable

### 2D: Process Detection Integration

**Files:** `gitnexus/src/core/ingestion/process-processor.ts`

Modify `buildCallsGraph()` (line 234) and `buildReverseCallsGraph()` (line 249) to include:
```typescript
const TRACE_EDGE_TYPES = new Set(['CALLS', 'PASSES_CALLBACK', 'INVOKES_CALLBACK']);
// ...
if (TRACE_EDGE_TYPES.has(rel.type) && rel.confidence >= MIN_TRACE_CONFIDENCE) {
```

This allows BFS trace to follow callback chains, connecting asynchronous execution flows.

## Schema Change Checklist (Phase 2)

| File | Change |
|------|--------|
| `gitnexus-shared/src/graph/types.ts` | `NodeLabel` +`'Closure'`; `RelationshipType` +`'PASSES_CALLBACK'` +`'INVOKES_CALLBACK'` |
| `gitnexus-shared/src/lbug/schema-constants.ts` | `NODE_TABLES` +`'Closure'`; `REL_TYPES` +2 |
| `gitnexus/src/core/lbug/schema.ts` | DDL: `CREATE NODE TABLE Closure(...)`; Relation pairs for new edge types |
| `gitnexus/src/core/lbug/csv-generator.ts` | `tableMap` entry for Closure |
| `gitnexus/src/mcp/local/local-backend.ts` | `VALID_NODE_LABELS` +`'Closure'`; `VALID_RELATION_TYPES` +2; optionally `IMPACT_RELATION_CONFIDENCE` |
| `gitnexus-web/src/lib/constants.ts` | `NODE_COLORS`, `NODE_SIZES` for Closure; `EDGE_INFO` for new edges |
| `gitnexus/test/unit/schema.test.ts` | Update counts (31→32 node tables, 33→35 schema queries) |

## Files to Modify (Phase 1)

| File | Task |
|------|------|
| `gitnexus/src/core/ingestion/field-extractors/objective-c.ts` | 1A: Block property declaredType |
| `gitnexus/src/core/ingestion/tree-sitter-queries.ts` | 1B: Block typedef captures; 1D: block_literal captures |
| `gitnexus/src/core/ingestion/languages/objective-c.ts` | 1B: Block typedef metadata extraction hook |
| `gitnexus/src/core/ingestion/utils/ast-helpers.ts` | 1C: Add `block_literal_expression` to `FUNCTION_NODE_TYPES` |
| `gitnexus/src/core/ingestion/call-extractors/configs/objective-c.ts` | 1C: Block-aware receiver resolution; 1D: completion pattern |
| `gitnexus/test/unit/objective-c-parsing.test.ts` | Tests for 1A-1D |

## Testing Strategy

- **Unit tests:** Add block-specific test cases to `objective-c-parsing.test.ts` for each sub-task.
- **Integration:** Run `npx vitest run` on the full OC test suite after each sub-task.
- **Real project validation:** After Phase 1, re-index `Lianjia_Beike_RentPlat` and verify:
  - Property `declaredType` for block-typed properties shows full signature
  - Block typedefs carry parameter metadata
  - `CALLS` edge count may increase (more stable attribution)
- After Phase 2: Verify `Closure` nodes appear, `PASSES_CALLBACK` edges are created, and `processes` count > 0.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Schema change breaks existing DB | Bump parse cache schema; users re-index with `--force` |
| Block literal scope boundary breaks existing call attribution | Test both with and without `block_literal_expression` in `FUNCTION_NODE_TYPES`; ensure backward compat |
| `PASSES_CALLBACK` over-generation | Start with high-confidence patterns only (block literal directly in message expression); add heuristics later |
| Process detection explosion with callback edges | Apply same `maxBranching` and `maxTraceDepth` constraints to callback edges |
