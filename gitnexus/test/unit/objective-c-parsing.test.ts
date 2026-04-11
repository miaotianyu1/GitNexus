import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import ObjectiveC from 'tree-sitter-objc';
import type { SyntaxNode } from '../../src/core/ingestion/utils/ast-helpers.js';
import { OBJC_QUERIES } from '../../src/core/ingestion/tree-sitter-queries.js';
import { extractParsedCallSite } from '../../src/core/ingestion/call-sites/extract-language-call-site.js';
import { SupportedLanguages } from '../../src/config/supported-languages.js';
import { getProvider } from '../../src/core/ingestion/languages/index.js';

type CallCapture = {
  callNode: SyntaxNode;
  nameNode: SyntaxNode;
  calledName: string;
};

type HeritageCapture = {
  child: string;
  parent: string;
};

type DefinitionCapture = {
  label: string;
  name: string;
};

function extractCallCaptures(code: string): CallCapture[] {
  const parser = new Parser();
  parser.setLanguage(ObjectiveC);
  const tree = parser.parse(code);
  const query = new Parser.Query(ObjectiveC, OBJC_QUERIES);
  const matches = query.matches(tree.rootNode);

  const results: CallCapture[] = [];
  for (const match of matches) {
    const captureMap: Record<string, SyntaxNode> = {};
    for (const capture of match.captures) {
      captureMap[capture.name] = capture.node;
    }
    const callNode = captureMap['call'];
    const nameNode = captureMap['call.name'];
    if (!callNode || !nameNode) continue;
    results.push({ callNode, nameNode, calledName: nameNode.text });
  }

  return results;
}

function extractHeritageCaptures(code: string): HeritageCapture[] {
  const parser = new Parser();
  parser.setLanguage(ObjectiveC);
  const tree = parser.parse(code);
  const query = new Parser.Query(ObjectiveC, OBJC_QUERIES);
  const matches = query.matches(tree.rootNode);

  const results: HeritageCapture[] = [];
  for (const match of matches) {
    const captureMap: Record<string, SyntaxNode> = {};
    for (const capture of match.captures) {
      captureMap[capture.name] = capture.node;
    }
    const childNode = captureMap['heritage.class'];
    const parentNode = captureMap['heritage.extends'];
    if (childNode && parentNode) {
      results.push({ child: childNode.text, parent: parentNode.text });
    }
    const implementsNode = captureMap['heritage.implements'];
    if (childNode && implementsNode) {
      results.push({ child: childNode.text, parent: implementsNode.text });
    }
  }

  return results;
}

function extractDefinitionCaptures(code: string): DefinitionCapture[] {
  const parser = new Parser();
  parser.setLanguage(ObjectiveC);
  const tree = parser.parse(code);
  const query = new Parser.Query(ObjectiveC, OBJC_QUERIES);
  const matches = query.matches(tree.rootNode);

  const results: DefinitionCapture[] = [];
  for (const match of matches) {
    const captureMap: Record<string, SyntaxNode> = {};
    for (const capture of match.captures) {
      captureMap[capture.name] = capture.node;
    }
    const nameNode = captureMap['name'];
    if (!nameNode) continue;
    if (captureMap['definition.interface']) {
      results.push({ label: 'Interface', name: nameNode.text });
    }
    if (captureMap['definition.typedef']) {
      results.push({ label: 'Typedef', name: nameNode.text });
    }
    if (captureMap['definition.property']) {
      results.push({ label: 'Property', name: nameNode.text });
    }
  }

  return results;
}

describe('Objective-C parsing', () => {
  it('resolves nested receiver for alloc/init', () => {
    const code = `
      @interface Widget : NSObject
      @end
      @implementation Widget
      - (void)run {
        [[Widget alloc] init];
      }
      @end
    `;
    const captures = extractCallCaptures(code);
    const match = captures.find((c) => c.calledName === 'init');
    expect(match).toBeDefined();
    const parsed = extractParsedCallSite(SupportedLanguages.ObjectiveC, match!.callNode);
    expect(parsed?.receiverName).toBe('Widget');
    expect(parsed?.calledName).toBe('init');
  });

  it('captures inheritance in class interfaces', () => {
    const code = `
      @interface Child : Parent
      @end
    `;
    const captures = extractHeritageCaptures(code);
    expect(captures).toEqual([{ child: 'Child', parent: 'Parent' }]);
  });

  it('captures protocol implementations on class interfaces', () => {
    const code = `
      @interface Foo : NSObject <MOSubScrollViewProtocol, UIScrollViewDelegate>
      @end
    `;
    const captures = extractHeritageCaptures(code);
    expect(captures).toContainEqual({
      child: 'Foo',
      parent: 'MOSubScrollViewProtocol',
    });
    expect(captures).toContainEqual({
      child: 'Foo',
      parent: 'UIScrollViewDelegate',
    });
  });

  it('captures protocol declarations as Interface definitions', () => {
    const code = `
      @protocol MOSubScrollViewProtocol <NSObject>
      @end
    `;
    const captures = extractDefinitionCaptures(code);
    expect(captures).toContainEqual({
      label: 'Interface',
      name: 'MOSubScrollViewProtocol',
    });
  });

  it('captures block typedef names', () => {
    const code = `
      typedef void(^MOSubScrollWillBeginDragging)(int value);
    `;
    const captures = extractDefinitionCaptures(code);
    expect(captures).toContainEqual({
      label: 'Typedef',
      name: 'MOSubScrollWillBeginDragging',
    });
  });

  it('captures Objective-C property declarations', () => {
    const code = `
      @protocol MOSubScrollViewProtocol <NSObject>
      @property (nonatomic, copy, nullable) MOSubScrollWillBeginDragging willBeginDragging;
      @end
    `;
    const captures = extractDefinitionCaptures(code);
    expect(captures).toContainEqual({
      label: 'Property',
      name: 'willBeginDragging',
    });
  });

  it('extracts parameter counts for selector methods', () => {
    const code = `
      @interface Widget : NSObject
      - (void)doThing:(int)a bar:(id)b;
      @end
      @implementation Widget
      - (void)doThing:(int)a bar:(id)b {}
      @end
    `;
    const parser = new Parser();
    parser.setLanguage(ObjectiveC);
    const tree = parser.parse(code);
    const provider = getProvider(SupportedLanguages.ObjectiveC);
    const classInterface = tree.rootNode.namedChildren.find((n) => n.type === 'class_interface');
    expect(classInterface).toBeDefined();
    const extracted = provider.methodExtractor?.extract(classInterface!, {
      filePath: 'widget.m',
      language: SupportedLanguages.ObjectiveC,
    });
    const method = extracted?.methods.find((m) => m.name === 'doThing:bar:');
    expect(method?.parameters.length).toBe(2);
  });
});
