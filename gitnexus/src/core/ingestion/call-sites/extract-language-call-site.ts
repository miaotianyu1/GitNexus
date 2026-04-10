/** Non-generic @call shapes → { calledName, callForm, receiverName? } (used from call-processor / parse-worker). */

import { SupportedLanguages } from '../../../config/supported-languages.js';
import type { SyntaxNode } from '../utils/ast-helpers.js';
import { parseJavaMethodReference } from './java.js';

export type ParsedCallSite = {
  calledName: string;
  callForm: 'free' | 'member' | 'constructor';
  receiverName?: string;
};

/** Non-null → seed replaces @call.name; null → use @call.name + inferCallForm / extractReceiverName. */
export function extractParsedCallSite(
  language: SupportedLanguages,
  callNode: SyntaxNode,
): ParsedCallSite | null {
  switch (language) {
    case SupportedLanguages.Java:
      if (callNode.type === 'method_reference') {
        const parsed = parseJavaMethodReference(callNode);
        if (!parsed) return null;
        return {
          calledName: parsed.calledName,
          callForm: parsed.callForm,
          ...(parsed.receiverName !== undefined ? { receiverName: parsed.receiverName } : {}),
        };
      }
      return null;
    case SupportedLanguages.ObjectiveC: {
      // Objective-C message send: [receiver selector:arg]
      if (callNode.type !== 'message_expression') return null;
      const receiver = callNode.childForFieldName?.('receiver');
      const receiverName = receiver?.type === 'identifier' ? receiver.text : undefined;

      const methodNodes = callNode.childrenForFieldName?.('method') ?? [];
      if (methodNodes.length === 0) return null;

      // Multi-keyword selector: method nodes appear as keywords without colons,
      // so we reinsert ':' between them (and at the end).
      if (methodNodes.length > 1) {
        return {
          calledName: `${methodNodes.map((n) => n.text).join(':')}:`,
          callForm: 'member',
          ...(receiverName !== undefined ? { receiverName } : {}),
        };
      }

      const only = methodNodes[0].text;
      const isKeyword = callNode.text.includes(`${only}:`);
      return {
        calledName: isKeyword ? `${only}:` : only,
        callForm: 'member',
        ...(receiverName !== undefined ? { receiverName } : {}),
      };
    }
    default:
      return null;
  }
}
