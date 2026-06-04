import { SupportedLanguages } from 'gitnexus-shared';
import { BaseFieldExtractor } from '../field-extractor.js';
import type {
  ExtractedFields,
  FieldExtractorContext,
  FieldInfo,
  FieldVisibility,
} from '../field-types.js';
import type { SyntaxNode } from '../utils/ast-helpers.js';

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

  return node.childForFieldName?.('name')?.text ?? null;
};

const getPropertyAttributes = (node: SyntaxNode): Set<string> => {
  const attrs = new Set<string>();
  const attrDecl = node.namedChildren?.find(
    (child) => child.type === 'property_attributes_declaration',
  );
  if (!attrDecl) return attrs;

  for (const attr of attrDecl.namedChildren ?? []) {
    if (attr.type !== 'property_attribute') continue;
    const id = findFirstIdentifier(attr);
    if (id && PROPERTY_ATTRIBUTE_VALUES.has(id.text)) attrs.add(id.text);
  }
  return attrs;
};

const extractPropertyName = (node: SyntaxNode): string | undefined => {
  const structDecl =
    node.namedChildren?.find((child) => child.type === 'struct_declaration') ??
    node.descendantsOfType?.('struct_declaration')?.[0];
  const structDeclarator =
    structDecl?.namedChildren?.find((child) => child.type === 'struct_declarator') ??
    structDecl?.descendantsOfType?.('struct_declarator')?.[0];

  // For block properties, the name is the identifier inside block_pointer_declarator
  const blockPointer = structDeclarator?.descendantsOfType?.('block_pointer_declarator')?.[0];
  if (blockPointer) {
    const blockName = blockPointer.namedChildren?.find((c) => c.type === 'identifier');
    if (blockName) return blockName.text;
  }

  // Non-block: last identifier in the struct_declarator
  const identifiers = structDeclarator?.descendantsOfType?.('identifier') ?? [];
  return (
    identifiers.at(-1)?.text ??
    structDeclarator?.namedChildren?.find((c) => c.type === 'identifier')?.text
  );
};

const extractPropertyType = (node: SyntaxNode): string | undefined => {
  const structDecl =
    node.namedChildren?.find((child) => child.type === 'struct_declaration') ??
    node.descendantsOfType?.('struct_declaration')?.[0];
  if (!structDecl) return undefined;

  const structDeclarator =
    structDecl.namedChildren?.find((child) => child.type === 'struct_declarator') ??
    structDecl.descendantsOfType?.('struct_declarator')?.[0];

  if (structDeclarator) {
    // Detect block pointer declarator: void(^name)(params) or Type*(^name)(params)
    const hasBlockPointer =
      (structDeclarator.descendantsOfType?.('block_pointer_declarator')?.length ?? 0) > 0;

    if (hasBlockPointer) {
      // Build full block signature: returnType(^)(paramTypes)
      const returnTypeParts: string[] = [];
      for (const child of structDecl.namedChildren ?? []) {
        if (child.type === 'struct_declarator') continue;
        returnTypeParts.push(child.text);
      }
      let returnType = returnTypeParts.join(' ') || 'void';

      // Handle pointer prefix: struct_declarator may wrap pointer_declarator -> function_declarator
      // e.g., NSString *(^transform)(id) has * inside the struct_declarator
      const firstChild = structDeclarator.namedChildren?.[0];
      if (firstChild?.type === 'pointer_declarator') {
        returnType += '*';
      }

      // Extract parameter types from function_declarator's parameter_list
      const funcDecl = structDeclarator.descendantsOfType?.('function_declarator')?.[0];
      const paramList = funcDecl?.namedChildren?.find((c) => c.type === 'parameter_list');
      const paramTypes: string[] = [];
      if (paramList) {
        for (const param of paramList.namedChildren ?? []) {
          if (param.type !== 'parameter_declaration') continue;
          // Collect all non-identifier, non-pointer_declarator children as the type
          const typeParts: string[] = [];
          for (const pc of param.namedChildren ?? []) {
            if (pc.type === 'identifier') continue;
            if (pc.type === 'pointer_declarator') {
              typeParts.push('*');
              continue;
            }
            typeParts.push(pc.text);
          }
          paramTypes.push(typeParts.join(''));
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
