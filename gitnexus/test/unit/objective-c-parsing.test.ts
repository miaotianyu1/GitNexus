import { describe, expect, it } from 'vitest';
import Parser from 'tree-sitter';
import ObjectiveC from 'tree-sitter-objc';
import { SupportedLanguages } from 'gitnexus-shared';
import type { SyntaxNode } from '../../src/core/ingestion/utils/ast-helpers.js';
import { getProvider } from '../../src/core/ingestion/languages/index.js';
import { OBJECTIVE_C_QUERIES } from '../../src/core/ingestion/tree-sitter-queries.js';
import { createImportResolver } from '../../src/core/ingestion/import-resolvers/resolver-factory.js';
import { objectiveCImportConfig } from '../../src/core/ingestion/import-resolvers/configs/objective-c.js';

type CaptureMap = Record<string, SyntaxNode>;

const parseObjectiveC = (code: string) => {
  const parser = new Parser();
  parser.setLanguage(ObjectiveC);
  return parser.parse(code);
};

const queryCaptures = (code: string): CaptureMap[] => {
  const tree = parseObjectiveC(code);
  const query = new Parser.Query(ObjectiveC, OBJECTIVE_C_QUERIES);
  return query.matches(tree.rootNode).map((match) => {
    const captures: CaptureMap = {};
    for (const capture of match.captures) {
      captures[capture.name] = capture.node;
    }
    return captures;
  });
};

describe('Objective-C parsing', () => {
  it('resolves nested receiver for alloc/init', () => {
    const captures = queryCaptures(`
      @interface Widget : NSObject
      @end
      @implementation Widget
      - (void)run {
        [[Widget alloc] init];
      }
      @end
    `);
    const initCall = captures.find((capture) => capture['call.name']?.text === 'init');
    expect(initCall).toBeDefined();

    const parsed = getProvider(SupportedLanguages.ObjectiveC).callExtractor?.extract(
      initCall!['call']!,
      initCall!['call.name'],
    );

    expect(parsed?.receiverName).toBe('Widget');
    expect(parsed?.calledName).toBe('init');
  });

  it('captures inheritance and protocol implementations', () => {
    const captures = queryCaptures(`
      @interface Foo : NSObject <MOSubScrollViewProtocol, UIScrollViewDelegate>
      @end
    `);

    const heritage = captures
      .filter((capture) => capture['heritage.class'])
      .map((capture) => ({
        child: capture['heritage.class']?.text,
        parent:
          capture['heritage.extends']?.text ??
          capture['heritage.implements']?.text ??
          capture['heritage.trait']?.text,
      }));

    expect(heritage).toContainEqual({ child: 'Foo', parent: 'NSObject' });
    expect(heritage).toContainEqual({ child: 'Foo', parent: 'MOSubScrollViewProtocol' });
    expect(heritage).toContainEqual({ child: 'Foo', parent: 'UIScrollViewDelegate' });
  });

  it('captures protocol declarations, block typedef names, and properties', () => {
    const captures = queryCaptures(`
      typedef void(^MOSubScrollWillBeginDragging)(int value);
      @protocol MOSubScrollViewProtocol <NSObject>
      @property (nonatomic, copy, nullable) MOSubScrollWillBeginDragging willBeginDragging;
      @end
    `);

    const definitions = captures
      .filter((capture) => capture.name)
      .map((capture) => ({
        label: capture['definition.interface']
          ? 'Interface'
          : capture['definition.typedef']
            ? 'Typedef'
            : capture['definition.property']
              ? 'Property'
              : 'Other',
        name: capture.name?.text,
      }));

    expect(definitions).toContainEqual({
      label: 'Interface',
      name: 'MOSubScrollViewProtocol',
    });
    expect(definitions).toContainEqual({
      label: 'Typedef',
      name: 'MOSubScrollWillBeginDragging',
    });
    expect(definitions).toContainEqual({
      label: 'Property',
      name: 'willBeginDragging',
    });
  });

  it('extracts selector method names, parameters, and static metadata', () => {
    const tree = parseObjectiveC(`
      @interface Widget : NSObject
      - (void)doThing:(int)a bar:(id)b;
      + (instancetype)sharedWidget;
      @end
    `);
    const provider = getProvider(SupportedLanguages.ObjectiveC);
    const classInterface = tree.rootNode.namedChildren.find(
      (node) => node.type === 'class_interface',
    );

    const extracted = provider.methodExtractor?.extract(classInterface!, {
      filePath: 'widget.h',
      language: SupportedLanguages.ObjectiveC,
    });

    const instanceMethod = extracted?.methods.find((method) => method.name === 'doThing:bar:');
    const staticMethod = extracted?.methods.find((method) => method.name === 'sharedWidget');

    expect(instanceMethod?.returnType).toBe('void');
    expect(instanceMethod?.parameters.map((param) => [param.name, param.type])).toEqual([
      ['a', 'int'],
      ['b', 'id'],
    ]);
    expect(staticMethod?.returnType).toBe('instancetype');
    expect(staticMethod?.isStatic).toBe(true);
  });

  it('uses full Objective-C selectors for graph definition names', () => {
    const captures = queryCaptures(`
      @interface Widget : NSObject
      - (void)doThing:(int)a bar:(id)b;
      @end
    `);
    const provider = getProvider(SupportedLanguages.ObjectiveC);
    const methodCaptures = captures.filter((capture) => capture['definition.method']);

    expect(methodCaptures).toHaveLength(1);
    expect(methodCaptures[0].name?.text).toBe('doThing');
    expect(
      provider.definitionNameResolver?.(
        'Method',
        methodCaptures[0].name!.text,
        methodCaptures[0]['definition.method']!,
      ),
    ).toBe('doThing:bar:');
  });

  it('extracts Objective-C property field metadata', () => {
    const tree = parseObjectiveC(`
      @interface Widget : NSObject
      @property (nonatomic, readonly) NSString *title;
      @property (class, nonatomic) NSInteger count;
      @end
    `);
    const provider = getProvider(SupportedLanguages.ObjectiveC);
    const classInterface = tree.rootNode.namedChildren.find(
      (node) => node.type === 'class_interface',
    );

    const extracted = provider.fieldExtractor?.extract(classInterface!, {
      filePath: 'widget.h',
      language: SupportedLanguages.ObjectiveC,
      typeEnv: {
        fileScope: () => new Map(),
        get: () => undefined,
      } as any,
      symbolTable: {
        lookupExactAll: () => [],
      } as any,
    });

    const title = extracted?.fields.find((field) => field.name === 'title');
    const count = extracted?.fields.find((field) => field.name === 'count');

    expect(title?.type).toBe('NSString');
    expect(title?.isReadonly).toBe(true);
    expect(count?.isStatic).toBe(true);
  });

  it('resolves generated Swift bridge headers to Swift source files', () => {
    const resolver = createImportResolver(objectiveCImportConfig);
    const result = resolver('Product-Swift.h', 'App/ViewController.m', {
      allFilePaths: new Set(['App/ViewController.m', 'App/User.swift']),
      allFileList: ['App/ViewController.m', 'App/User.swift'],
      normalizedFileList: ['App/ViewController.m', 'App/User.swift'],
      index: new Map() as any,
      resolveCache: new Map(),
      configs: {
        tsconfigPaths: null,
        goModule: null,
        composerConfig: null,
        swiftPackageConfig: null,
        csharpConfigs: [],
      },
    });

    expect(result).toEqual({ kind: 'files', files: ['App/User.swift'] });
  });
});
