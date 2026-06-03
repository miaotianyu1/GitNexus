import { SupportedLanguages } from 'gitnexus-shared';
import type {
  MethodExtractor,
  MethodExtractorContext,
  MethodInfo,
  ParameterInfo,
} from '../method-types.js';
import type { SyntaxNode } from '../utils/ast-helpers.js';

const TYPE_DECLARATION_NODES = new Set([
  'class_interface',
  'class_implementation',
  'protocol_declaration',
]);

const METHOD_DECLARATION_NODES = new Set(['method_declaration', 'method_definition']);

const extractOwnerName = (node: SyntaxNode): string | undefined => {
  const category = node.childForFieldName?.('category');
  const superclass = node.childForFieldName?.('superclass');

  for (const child of node.namedChildren ?? []) {
    if (child.type !== 'identifier' && child.type !== 'type_identifier') continue;
    if (category && child === category) continue;
    if (superclass && child === superclass) continue;
    return child.text;
  }

  return undefined;
};

const collectMethodNodes = (ownerNode: SyntaxNode): SyntaxNode[] => {
  const methods: SyntaxNode[] = [];

  if (ownerNode.type === 'class_implementation') {
    for (const child of ownerNode.namedChildren ?? []) {
      if (child.type === 'implementation_definition') {
        for (const implChild of child.namedChildren ?? []) {
          if (METHOD_DECLARATION_NODES.has(implChild.type)) methods.push(implChild);
        }
      } else if (METHOD_DECLARATION_NODES.has(child.type)) {
        methods.push(child);
      }
    }
    return methods;
  }

  for (const child of ownerNode.namedChildren ?? []) {
    if (METHOD_DECLARATION_NODES.has(child.type)) methods.push(child);
  }

  return methods;
};

const unwrapMethodTypeText = (methodTypeNode: SyntaxNode | null | undefined): string | null => {
  if (!methodTypeNode) return null;
  const raw = methodTypeNode.text.trim();
  if (raw.startsWith('(') && raw.endsWith(')')) {
    const inner = raw.slice(1, -1).trim();
    return inner.length > 0 ? inner : null;
  }
  return raw.length > 0 ? raw : null;
};

const extractReturnType = (methodNode: SyntaxNode): string | null => {
  const methodType = methodNode.namedChildren?.find((child) => child.type === 'method_type');
  return unwrapMethodTypeText(methodType);
};

const extractParameters = (methodNode: SyntaxNode): ParameterInfo[] => {
  const params: ParameterInfo[] = [];
  for (const child of methodNode.namedChildren ?? []) {
    if (child.type !== 'method_parameter') continue;
    const methodType = child.namedChildren?.find((part) => part.type === 'method_type');
    const nameNode = child.namedChildren?.find((part) => part.type === 'identifier');
    const typeText = unwrapMethodTypeText(methodType);
    params.push({
      name: nameNode?.text ?? '',
      type: typeText,
      rawType: typeText,
      isOptional: false,
      isVariadic: false,
    });
  }
  return params;
};

export const resolveObjectiveCSelectorName = (methodNode: SyntaxNode): string | null => {
  let firstName: string | null = null;
  let paramCount = 0;
  const children = methodNode.namedChildren ?? [];

  for (const child of children) {
    if (child.type === 'method_parameter') paramCount++;
  }

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

  let selector = `${firstName}:`;
  let remainingParams = paramCount - 1;
  if (remainingParams <= 0) return selector;

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

const buildMethodInfo = (
  methodNode: SyntaxNode,
  ownerNode: SyntaxNode,
  context: MethodExtractorContext,
): MethodInfo | null => {
  const name = resolveObjectiveCSelectorName(methodNode);
  if (!name) return null;

  return {
    name,
    receiverType: null,
    returnType: extractReturnType(methodNode),
    parameters: extractParameters(methodNode),
    visibility: 'public',
    isStatic: methodNode.text.trim().startsWith('+'),
    isAbstract:
      ownerNode.type === 'protocol_declaration' || methodNode.type === 'method_declaration',
    isFinal: false,
    annotations: [],
    sourceFile: context.filePath,
    line: methodNode.startPosition.row + 1,
  };
};

export const createObjectiveCMethodExtractor = (): MethodExtractor => ({
  language: SupportedLanguages.ObjectiveC,

  isTypeDeclaration(node: SyntaxNode): boolean {
    return TYPE_DECLARATION_NODES.has(node.type);
  },

  extract(node: SyntaxNode, context: MethodExtractorContext) {
    if (!TYPE_DECLARATION_NODES.has(node.type)) return null;
    const ownerName = extractOwnerName(node);
    if (!ownerName) return null;

    const methods: MethodInfo[] = [];
    for (const methodNode of collectMethodNodes(node)) {
      const info = buildMethodInfo(methodNode, node, context);
      if (info) methods.push(info);
    }

    return { ownerName, methods };
  },

  extractFromNode(node: SyntaxNode, context: MethodExtractorContext): MethodInfo | null {
    if (!METHOD_DECLARATION_NODES.has(node.type)) return null;
    let ownerNode = node.parent ?? node;
    if (ownerNode.type === 'implementation_definition' && ownerNode.parent) {
      ownerNode = ownerNode.parent;
    }
    return buildMethodInfo(node, ownerNode, context);
  },

  extractFunctionName(node: SyntaxNode) {
    if (!METHOD_DECLARATION_NODES.has(node.type)) return null;
    return { funcName: resolveObjectiveCSelectorName(node), label: 'Method' };
  },
});
