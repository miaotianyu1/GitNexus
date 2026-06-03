import { SupportedLanguages } from 'gitnexus-shared';
import type { ClassExtractionConfig } from '../../class-types.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';

const extractObjectiveCTypeName = (node: SyntaxNode): string | undefined => {
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

export const objectiveCClassConfig: ClassExtractionConfig = {
  language: SupportedLanguages.ObjectiveC,
  typeDeclarationNodes: ['class_interface', 'class_implementation', 'protocol_declaration'],
  ancestorScopeNodeTypes: ['class_interface', 'class_implementation', 'protocol_declaration'],
  extractName: extractObjectiveCTypeName,
  extractType(node) {
    if (node.type === 'protocol_declaration') return 'Interface';
    if (node.type === 'class_interface' || node.type === 'class_implementation') return 'Class';
    return undefined;
  },
};
