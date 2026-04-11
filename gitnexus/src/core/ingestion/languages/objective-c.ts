/**
 * Objective-C language provider (tree-sitter-objc).
 *
 * Focus: core indexing fidelity for ObjC projects:
 * - Class/Protocol symbols
 * - Method declarations/definitions (selector-aware naming)
 * - #import / @import edges
 * - Message-send call sites
 *
 * Notes:
 * - We still register `.h` here so symbols are discoverable in headers, but
 *   extraction is conservative (we do not attempt full header vs. C/C++ overlap).
 * - Selector names are synthesized to preserve colons (e.g., `setFoo:bar:`),
 *   which makes call resolution and impact analysis much more accurate.
 */

import { SupportedLanguages } from 'gitnexus-shared';
import { defineLanguage } from '../language-provider.js';
import { createClassExtractor } from '../class-extractors/generic.js';
import type { ClassExtractionConfig } from '../class-types.js';
import type { SyntaxNode } from '../utils/ast-helpers.js';
import { typeConfig as cCppTypeConfig } from '../type-extractors/c-cpp.js';
import { cCppExportChecker } from '../export-detection.js';
import { resolveObjectiveCImport } from '../import-resolvers/standard.js';
import { OBJC_QUERIES } from '../tree-sitter-queries.js';
import type { NodeLabel } from 'gitnexus-shared';
import { createObjectiveCMethodExtractor } from '../method-extractors/objective-c.js';

const objcClassConfig: ClassExtractionConfig = {
  language: SupportedLanguages.ObjectiveC,
  typeDeclarationNodes: ['class_interface', 'class_implementation', 'protocol_declaration'],
  extractName: (node: SyntaxNode): string | undefined => {
    // tree-sitter-objc does not expose a direct `name` field for class/protocol
    // declarations. We scan named children and ignore category/superclass nodes
    // so the primary identifier remains the class/protocol name.
    const category = node.childForFieldName?.('category');
    const superclass = node.childForFieldName?.('superclass');

    for (const child of node.namedChildren ?? []) {
      if (child.type !== 'identifier' && child.type !== 'type_identifier') continue;
      if (category && child === category) continue;
      if (superclass && child === superclass) continue;
      return child.text;
    }

    return undefined;
  },
  extractType: (node: SyntaxNode) => {
    if (node.type === 'protocol_declaration') return 'Interface';
    return 'Class';
  },
};

/**
 * Build an Objective-C selector string from a method node.
 *
 * tree-sitter-objc encodes selector keywords as direct children:
 * (method_* (method_type ...) (identifier) (method_parameter ...) (identifier)? ...)
 *
 * Examples:
 *   - `foo` → "foo"
 *   - `setFoo:(id)x` → "setFoo:"
 *   - `setFoo:(id)x bar:(id)y` → "setFoo:bar:"
 */
const objcResolveSelectorName = (methodNode: SyntaxNode): string | null => {
  let firstName: string | null = null;
  let paramCount = 0;
  const children = methodNode.namedChildren ?? [];

  // Count parameters to decide if we need keyword selector syntax.
  for (const child of children) {
    if (child.type === 'method_parameter') paramCount++;
  }

  // Find the first identifier after the method_type token.
  let sawMethodType = false;
  for (const child of children) {
    if (child.type === 'method_type') {
      sawMethodType = true;
      continue;
    }
    if (!sawMethodType) continue;
    if (child.type === 'identifier') {
      firstName = child.text;
      break;
    }
  }

  if (!firstName) return null;
  if (paramCount === 0) return firstName;

  // Build keyword selector: firstName: + (nextKeyword:)* for remaining params.
  let selector = `${firstName}:`;
  let remainingParams = paramCount - 1;
  if (remainingParams <= 0) return selector;

  // Look for identifier nodes appearing between parameters.
  let seenFirstParam = false;
  for (const child of children) {
    if (!seenFirstParam) {
      if (child.type === 'method_parameter') seenFirstParam = true;
      continue;
    }
    if (remainingParams <= 0) break;
    if (child.type === 'identifier') {
      selector += `${child.text}:`;
      remainingParams--;
    }
  }

  return selector;
};

export const objectiveCProvider = defineLanguage({
  id: SupportedLanguages.ObjectiveC,
  extensions: ['.h', '.m', '.mm'],
  treeSitterQueries: OBJC_QUERIES,

  // Objective-C is a C-family language: start with C/C++ type binding heuristics.
  typeConfig: cCppTypeConfig,
  // Use the C/C++ export heuristic (for plain C in .m/.mm files).
  exportChecker: cCppExportChecker,
  // Treat #import like #include (suffix resolution + relative resolution).
  importResolver: resolveObjectiveCImport,
  importSemantics: 'wildcard',

  classExtractor: createClassExtractor(objcClassConfig),
  methodExtractor: createObjectiveCMethodExtractor(),

  definitionNameResolver: (
    nodeLabel: NodeLabel,
    defaultName: string,
    definitionNode: SyntaxNode,
  ) => {
    // Only override method names; other symbols keep default behavior.
    if (nodeLabel !== 'Method') return null;
    if (definitionNode.type !== 'method_declaration' && definitionNode.type !== 'method_definition')
      return null;
    // Preserve full selector (colons) when available.
    return objcResolveSelectorName(definitionNode) ?? defaultName;
  },
});
