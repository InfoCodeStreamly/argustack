/**
 * S-expression queries reserved for future use (tree-sitter `Query` API).
 * Currently the parser uses manual AST walking — these patterns document
 * which node kinds we care about, in canonical S-expression form.
 */
export const SYMBOL_QUERIES = {
  function: '(function_declaration name: (identifier) @name)',
  classDecl: '(class_declaration name: (type_identifier) @name)',
  method: '(method_definition name: (property_identifier) @name)',
  interfaceDecl: '(interface_declaration name: (type_identifier) @name)',
  typeAlias: '(type_alias_declaration name: (type_identifier) @name)',
  enumDecl: '(enum_declaration name: (identifier) @name)',
} as const;
