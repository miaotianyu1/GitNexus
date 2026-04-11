import { SupportedLanguages } from 'gitnexus-shared';
import type { SyntaxNode } from '../utils/ast-helpers.js';
import { BaseFieldExtractor } from '../field-extractor.js';
import type {
  ExtractedFields,
  FieldExtractorContext,
  FieldInfo,
  FieldVisibility,
} from '../field-types.js';

const OBJC_TYPE_DECLARATIONS = new Set([
  'class_interface',
  'class_implementation',
  'protocol_declaration',
  'category_interface',
  'category_implementation',
]);

const PROPERTY_ATTRIBUTE_VALUES = new Set(['readonly', 'class']);

const findFirstIdentifier = (node: SyntaxNode | null | undefined): SyntaxNode | null => {
  if (!node) return null;
  for (const child of node.namedChildren ?? []) {
    if (child.type === 'identifier' || child.type === 'type_identifier') return child;
  }
  return null;
};

const resolveOwnerName = (node: SyntaxNode): string | null => {
  if (!OBJC_TYPE_DECLARATIONS.has(node.type)) return null;

  if (node.type === 'protocol_declaration') {
    const nameNode = findFirstIdentifier(node);
    return nameNode?.text ?? null;
  }

  const category = node.childForFieldName?.('category');
  const superclass = node.childForFieldName?.('superclass');
  for (const child of node.namedChildren ?? []) {
    if (child.type !== 'identifier' && child.type !== 'type_identifier') continue;
    if (category && child === category) continue;
    if (superclass && child === superclass) continue;
    return child.text;
  }

  const fallback = node.childForFieldName?.('name');
  return fallback?.text ?? null;
};

const getPropertyAttributes = (node: SyntaxNode): Set<string> => {
  const attrs = new Set<string>();
  const attrDecl = node.namedChildren?.find((c) => c.type === 'property_attributes_declaration');
  if (!attrDecl) return attrs;
  for (const attr of attrDecl.namedChildren ?? []) {
    if (attr.type !== 'property_attribute') continue;
    const id = findFirstIdentifier(attr);
    if (id && PROPERTY_ATTRIBUTE_VALUES.has(id.text)) {
      attrs.add(id.text);
    }
  }
  return attrs;
};

const extractPropertyName = (node: SyntaxNode): string | undefined => {
  const structDecl =
    node.namedChildren?.find((c) => c.type === 'struct_declaration') ??
    node.descendantsOfType?.('struct_declaration')?.[0];
  if (!structDecl) return undefined;
  const structDeclarator =
    structDecl.namedChildren?.find((c) => c.type === 'struct_declarator') ??
    structDecl.descendantsOfType?.('struct_declarator')?.[0];
  if (!structDeclarator) return undefined;
  const nameNode =
    structDeclarator.descendantsOfType?.('identifier')?.slice(-1)[0] ??
    structDeclarator.namedChildren?.find((c) => c.type === 'identifier');
  return nameNode?.text;
};

const extractPropertyType = (node: SyntaxNode): string | undefined => {
  const structDecl =
    node.namedChildren?.find((c) => c.type === 'struct_declaration') ??
    node.descendantsOfType?.('struct_declaration')?.[0];
  if (!structDecl) return undefined;
  const typeNode =
    structDecl.namedChildren?.find((c) => c.type !== 'struct_declarator') ??
    structDecl.namedChildren?.find((c) => c.type === 'type_identifier') ??
    structDecl.namedChildren?.find((c) => c.type === 'identifier');
  return typeNode?.text;
};

export class ObjectiveCFieldExtractor extends BaseFieldExtractor {
  language = SupportedLanguages.ObjectiveC;

  isTypeDeclaration(node: SyntaxNode): boolean {
    return OBJC_TYPE_DECLARATIONS.has(node.type);
  }

  protected extractVisibility(_node: SyntaxNode): FieldVisibility {
    return 'public';
  }

  extract(node: SyntaxNode, context: FieldExtractorContext): ExtractedFields | null {
    if (!this.isTypeDeclaration(node)) return null;
    const ownerFqn = resolveOwnerName(node);
    if (!ownerFqn) return null;

    const fields: FieldInfo[] = [];
    const propertyNodes = node.descendantsOfType?.('property_declaration') ?? [];
    for (const prop of propertyNodes) {
      const name = extractPropertyName(prop);
      if (!name) continue;
      let type = extractPropertyType(prop) ?? null;
      if (type) {
        type = this.normalizeType(type);
        const resolved = this.resolveType(type, context);
        if (resolved) type = resolved;
      }
      const attrs = getPropertyAttributes(prop);
      fields.push({
        name,
        type,
        visibility: this.extractVisibility(prop),
        isStatic: attrs.has('class'),
        isReadonly: attrs.has('readonly'),
        sourceFile: context.filePath,
        line: prop.startPosition.row + 1,
      });
    }

    return { ownerFqn, fields, nestedTypes: [] };
  }
}

export const objectiveCFieldExtractor = new ObjectiveCFieldExtractor();
