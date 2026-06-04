import { describe, expect, it } from 'vitest';
import Parser from 'tree-sitter';
import ObjectiveC from 'tree-sitter-objc';
import { SupportedLanguages } from 'gitnexus-shared';
import {
  FUNCTION_NODE_TYPES,
  type SyntaxNode,
} from '../../src/core/ingestion/utils/ast-helpers.js';
import { getProvider } from '../../src/core/ingestion/languages/index.js';
import { OBJECTIVE_C_QUERIES } from '../../src/core/ingestion/tree-sitter-queries.js';
import { createImportResolver } from '../../src/core/ingestion/import-resolvers/resolver-factory.js';
import { objectiveCImportConfig } from '../../src/core/ingestion/import-resolvers/configs/objective-c.js';
import {
  extractBlockArguments,
  isPotentialBlockInvocation,
  resolveEnclosingMethodOwner,
} from '../../src/core/ingestion/call-extractors/configs/objective-c.js';

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

  it('extracts full block signature as declaredType for block properties', () => {
    const tree = parseObjectiveC(`
      @interface Widget : NSObject
      @property (nonatomic, copy) void(^onTap)(BOOL selected);
      @property (nonatomic, copy) NSString *(^transform)(id input);
      @property (nonatomic, strong) NSArray *items;
      @end
    `);
    const provider = getProvider(SupportedLanguages.ObjectiveC);
    const classInterface = tree.rootNode.namedChildren.find(
      (node) => node.type === 'class_interface',
    )!;

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

    const onTap = extracted?.fields.find((field) => field.name === 'onTap');
    const transform = extracted?.fields.find((field) => field.name === 'transform');
    const items = extracted?.fields.find((field) => field.name === 'items');

    // Block properties should have full signature
    expect(onTap?.type).toBe('void(^)(BOOL)');
    expect(transform?.type).toBe('NSString*(^)(id)');
    // Non-block property should be unchanged
    expect(items?.type).toBe('NSArray');
  });

  it('extracts block typedef return type and parameter metadata', () => {
    const captures = queryCaptures(
      'typedef void(^CompletionHandler)(BOOL success, NSError *error);',
    );

    const typedefCapture = captures.find((c) => c['definition.typedef']);
    expect(typedefCapture).toBeDefined();
    expect(typedefCapture?.name?.text).toBe('CompletionHandler');

    // Verify the new captures exist
    const returnCapture = captures.find((c) => c['typedef.block_return']);
    expect(returnCapture).toBeDefined();
    expect(returnCapture?.['typedef.block_return']?.text).toBe('void');

    const paramsCapture = captures.find((c) => c['typedef.block_params']);
    expect(paramsCapture).toBeDefined();

    // Parameter list should contain two parameter_declaration nodes
    const paramNodes = paramsCapture?.['typedef.block_params']?.namedChildren ?? [];
    const paramDecls = paramNodes.filter((n) => n.type === 'parameter_declaration');
    expect(paramDecls).toHaveLength(2);

    // First param: BOOL success → type is BOOL
    const p1Types =
      paramDecls[0].namedChildren?.filter(
        (n) =>
          n.type === 'typedefed_specifier' ||
          n.type === 'type_identifier' ||
          n.type === 'primitive_type',
      ) ?? [];
    const p1Type = p1Types.map((n) => n.text).join(' ');
    expect(p1Type).toBe('BOOL');

    // Second param: NSError *error → type is NSError (pointer)
    const p2Types =
      paramDecls[1].namedChildren?.filter(
        (n) =>
          n.type === 'typedefed_specifier' ||
          n.type === 'type_identifier' ||
          n.type === 'primitive_type',
      ) ?? [];
    const p2Type = p2Types.map((n) => n.text).join(' ');
    expect(p2Type).toBe('NSError');
  });

  it('resolves self receiver through block literal to enclosing class', () => {
    const captures = queryCaptures(`
      @implementation Widget
      - (void)loadData {
          [self fetchWithCompletion:^(BOOL success) {
              [self refresh];
          }];
      }
      - (void)refresh {}
      - (void)fetchWithCompletion:(void(^)(BOOL))completion {}
      @end
    `);

    // Find the [self refresh] call inside the block
    const refreshCall = captures.find((capture) => capture['call.name']?.text === 'refresh');
    expect(refreshCall).toBeDefined();

    const parsed = getProvider(SupportedLanguages.ObjectiveC).callExtractor?.extract(
      refreshCall!['call']!,
      refreshCall!['call.name'],
    );

    // The receiver should be 'self'
    expect(parsed?.receiverName).toBe('self');
    expect(parsed?.calledName).toBe('refresh');
    expect(parsed?.callForm).toBe('member');
  });

  it('resolveEnclosingMethodOwner finds class through block literal', () => {
    const tree = parseObjectiveC(`
      @implementation Widget
      - (void)loadData {
          [self fetchWithCompletion:^(BOOL success) {
              [self refresh];
          }];
      }
      @end
    `);

    // Find the [self refresh] message_expression inside the block
    const messageExprs = tree.rootNode.descendantsOfType('message_expression');
    // The second message_expression is [self refresh] inside the block
    const refreshCall = messageExprs.find((n) => n.text.includes('refresh'));
    expect(refreshCall).toBeDefined();

    const owner = resolveEnclosingMethodOwner(refreshCall!);
    expect(owner).toBe('Widget');
  });

  it('detects block literal arguments in message expressions', () => {
    const captures = queryCaptures(`
      @implementation Widget
      - (void)animate {
          [UIView animateWithDuration:0.3 animations:^{
              [self refresh];
          } completion:^{
              NSLog(@"done");
          }];
      }
      @end
    `);

    // Should capture both block arguments
    const blockArgs = captures.filter((c) => c['call.block_arg']);
    expect(blockArgs.length).toBeGreaterThanOrEqual(2);

    // The enclosing message expression should be captured
    const withBlock = captures.filter((c) => c['call.with_block']);
    expect(withBlock.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts message sends inside block literal arguments', () => {
    const captures = queryCaptures(`
      @implementation Widget
      - (void)load {
          [self fetchData:^(NSArray *items) {
              [self reloadWith:items];
          }];
      }
      @end
    `);

    // The [self reloadWith:items] inside the block should still be captured
    const reloadCall = captures.find((capture) => capture['call.name']?.text === 'reloadWith');
    expect(reloadCall).toBeDefined();
  });

  it('captures block literals for Closure node extraction', () => {
    const tree = parseObjectiveC(`
      @implementation Widget
      - (void)loadData {
          [self fetchWithCompletion:^(BOOL success) {
              [self refresh];
          }];
      }
      @end
    `);

    // Verify block_literal nodes exist in the AST
    const blockNodes = tree.rootNode.descendantsOfType('block_literal');
    expect(blockNodes.length).toBeGreaterThan(0);

    // Verify FUNCTION_NODE_TYPES includes block_literal
    expect(FUNCTION_NODE_TYPES.has('block_literal')).toBe(true);

    // Verify the query captures @definition.closure for block literals
    const captures = queryCaptures(`
      @implementation Widget
      - (void)loadData {
          [self fetchWithCompletion:^(BOOL success) {
              [self refresh];
          }];
      }
      @end
    `);
    const closureCaptures = captures.filter((c) => c['definition.closure']);
    expect(closureCaptures.length).toBeGreaterThan(0);
    expect(closureCaptures[0]['definition.closure'].type).toBe('block_literal');
  });

  it('extracts block arguments from message expressions for PASSES_CALLBACK', () => {
    const tree = parseObjectiveC(`
      @implementation Widget
      - (void)animate {
          [UIView animateWithDuration:0.3 animations:^{
              [self refresh];
          } completion:^{
              NSLog(@"done");
          }];
      }
      @end
    `);

    const messageExpr = tree.rootNode.descendantsOfType('message_expression')[0];
    expect(messageExpr).toBeDefined();

    const blockArgs = extractBlockArguments(messageExpr!);
    expect(blockArgs).toHaveLength(2);
    expect(blockArgs[0].keyword).toBe('animations');
    expect(blockArgs[1].keyword).toBe('completion');
  });

  it('detects block invocations for INVOKES_CALLBACK edges', () => {
    const captures = queryCaptures(`
      @implementation Widget
      - (void)fetchWithCompletion:(void(^)(BOOL success))completion {
          completion(YES);
      }
      @end
    `);

    const callExprs = captures.filter((c) => c['call.name']?.text === 'completion');
    expect(callExprs.length).toBeGreaterThan(0);

    expect(isPotentialBlockInvocation(callExprs[0]['call']!, callExprs[0]['call.name']!)).toBe(
      true,
    );
  });

  it('does not flag regular C functions as block invocations', () => {
    const captures = queryCaptures(`
      @implementation Widget
      - (void)log {
          NSLog(@"hello");
      }
      @end
    `);

    const nslogCall = captures.find((c) => c['call.name']?.text === 'NSLog');
    expect(nslogCall).toBeDefined();

    // NSLog starts with uppercase 'N' -> not a block invocation
    expect(isPotentialBlockInvocation(nslogCall!['call']!, nslogCall!['call.name']!)).toBe(false);
  });
});
