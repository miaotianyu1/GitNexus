import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import ObjectiveC from 'tree-sitter-objc';
import type { SyntaxNode } from '../../src/core/ingestion/utils/ast-helpers.js';
import { OBJC_QUERIES } from '../../src/core/ingestion/tree-sitter-queries.js';
import { extractParsedCallSite } from '../../src/core/ingestion/call-sites/extract-language-call-site.js';
import { SupportedLanguages } from '../../src/config/supported-languages.js';

type CallCapture = {
  callNode: SyntaxNode;
  nameNode: SyntaxNode;
  calledName: string;
};

type HeritageCapture = {
  child: string;
  parent: string;
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
    if (!childNode || !parentNode) continue;
    results.push({ child: childNode.text, parent: parentNode.text });
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
});
