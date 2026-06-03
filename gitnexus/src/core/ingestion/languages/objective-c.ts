import { SupportedLanguages } from 'gitnexus-shared';
import { createCallExtractor } from '../call-extractors/generic.js';
import { objectiveCCallConfig } from '../call-extractors/configs/objective-c.js';
import { createClassExtractor } from '../class-extractors/generic.js';
import { objectiveCClassConfig } from '../class-extractors/configs/objective-c.js';
import { cCppExportChecker } from '../export-detection.js';
import { objectiveCFieldExtractor } from '../field-extractors/objective-c.js';
import { createHeritageExtractor } from '../heritage-extractors/generic.js';
import { createImportResolver } from '../import-resolvers/resolver-factory.js';
import { objectiveCImportConfig } from '../import-resolvers/configs/objective-c.js';
import { defineLanguage } from '../language-provider.js';
import {
  createObjectiveCMethodExtractor,
  resolveObjectiveCSelectorName,
} from '../method-extractors/objective-c.js';
import { typeConfig as cCppTypeConfig } from '../type-extractors/c-cpp.js';
import { OBJECTIVE_C_QUERIES } from '../tree-sitter-queries.js';

const BUILT_INS: ReadonlySet<string> = new Set([
  'NSLog',
  'NSAssert',
  'NSParameterAssert',
  'alloc',
  'init',
  'new',
  'copy',
  'mutableCopy',
  'retain',
  'release',
  'autorelease',
  'dealloc',
  'description',
  'respondsToSelector',
  'performSelector',
  'isKindOfClass',
  'isMemberOfClass',
]);

export const objectiveCProvider = defineLanguage({
  id: SupportedLanguages.ObjectiveC,
  extensions: ['.m', '.mm'],
  entryPointPatterns: [/^main$/, /^application.*didFinishLaunching/, /^viewDidLoad$/],
  treeSitterQueries: OBJECTIVE_C_QUERIES,
  typeConfig: cCppTypeConfig,
  exportChecker: cCppExportChecker,
  importResolver: createImportResolver(objectiveCImportConfig),
  importSemantics: 'wildcard-transitive',
  heritageDefaultEdge: 'EXTENDS',
  mroStrategy: 'first-wins',
  callExtractor: createCallExtractor(objectiveCCallConfig),
  methodExtractor: createObjectiveCMethodExtractor(),
  definitionNameResolver(nodeLabel, _defaultName, definitionNode) {
    if (nodeLabel !== 'Method') return null;
    return resolveObjectiveCSelectorName(definitionNode);
  },
  fieldExtractor: objectiveCFieldExtractor,
  classExtractor: createClassExtractor(objectiveCClassConfig),
  heritageExtractor: createHeritageExtractor(SupportedLanguages.ObjectiveC),
  builtInNames: BUILT_INS,
});
