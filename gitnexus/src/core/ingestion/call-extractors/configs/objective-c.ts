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

export const objectiveCCallConfig: CallExtractionConfig = {
  language: SupportedLanguages.ObjectiveC,
  extractLanguageCallSite: selectorFromMessageExpression,
  typeAsReceiverHeuristic: true,
};
