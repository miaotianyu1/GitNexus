import { SupportedLanguages } from 'gitnexus-shared';
import type { CallExtractionConfig, ExtractedCallSite } from '../../call-types.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';

const selectorFromMessageExpression = (node: SyntaxNode): ExtractedCallSite | null => {
  if (node.type !== 'message_expression') return null;

  const receiver = node.childForFieldName?.('receiver');
  const methodNodes = node.childrenForFieldName?.('method') ?? [];
  if (methodNodes.length === 0) return null;

  const receiverName = resolveObjectiveCReceiverName(receiver);
  const selectorParts = methodNodes.map((part) => part.text);
  const isKeywordSelector = node.text.includes(':');
  const calledName = isKeywordSelector
    ? selectorParts.map((part) => `${part}:`).join('')
    : selectorParts[0];

  return {
    calledName,
    callForm: 'member',
    ...(receiverName !== undefined ? { receiverName } : {}),
    argCount: isKeywordSelector ? selectorParts.length : 0,
  };
};

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
 * Walk up from a call node to find the enclosing method's owner class,
 * skipping over block_literal scope boundaries.
 *
 * This ensures [self doThing] inside a block literal is attributed to
 * the enclosing method's class, not the anonymous block scope.
 */
export const resolveEnclosingMethodOwner = (callNode: SyntaxNode): string | undefined => {
  let current: SyntaxNode | null = callNode.parent;
  while (current) {
    if (current.type === 'method_definition' || current.type === 'method_declaration') {
      // Walk up further to find the enclosing class
      let classNode: SyntaxNode | null = current.parent;
      while (classNode) {
        if (classNode.type === 'class_implementation' || classNode.type === 'class_interface') {
          const identifiers = classNode.namedChildren?.filter(
            (c) => c.type === 'identifier' || c.type === 'type_identifier',
          );
          const category = classNode.childForFieldName?.('category');
          const superclass = classNode.childForFieldName?.('superclass');
          for (const id of identifiers ?? []) {
            if (category && id === category) continue;
            if (superclass && id === superclass) continue;
            return id.text;
          }
          return undefined;
        }
        classNode = classNode.parent;
      }
      return undefined;
    }
    // Skip block literals — they are scope boundaries but not method owners
    if (current.type === 'block_literal') {
      current = current.parent;
      continue;
    }
    current = current.parent;
  }
  return undefined;
};

/**
 * Extract block literals from message expressions for PASSES_CALLBACK edge emission.
 * Returns an array of { blockNode, keyword } pairs.
 *
 * Example: [UIView animateWithDuration:0.3 animations:^{ ... } completion:^{ ... }]
 * -> [{blockNode: animations block, keyword: 'animations'}, {blockNode: completion block, keyword: 'completion'}]
 */
export const extractBlockArguments = (
  messageNode: SyntaxNode,
): Array<{ blockNode: SyntaxNode; keyword: string }> => {
  const results: Array<{ blockNode: SyntaxNode; keyword: string }> = [];
  const children = messageNode.namedChildren ?? [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'block_literal') {
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

/**
 * Detect block invocations for INVOKES_CALLBACK edge emission.
 * Returns true when a call_expression's function identifier matches a
 * likely block-typed parameter or local variable name.
 *
 * Heuristic: the identifier being called starts with a lowercase letter,
 * distinguishing block variables from C functions (which start uppercase)
 * and class methods (called via message_expression).
 */
export const isPotentialBlockInvocation = (
  callNode: SyntaxNode,
  callNameNode: SyntaxNode,
): boolean => {
  if (callNode.type !== 'call_expression') return false;
  const name = callNameNode.text;
  if (!name || name.length === 0) return false;
  const firstChar = name.charCodeAt(0);
  // Block variable names typically start with lowercase
  return firstChar >= 97 && firstChar <= 122;
};

export const objectiveCCallConfig: CallExtractionConfig = {
  language: SupportedLanguages.ObjectiveC,
  extractLanguageCallSite: selectorFromMessageExpression,
  typeAsReceiverHeuristic: true,
};
