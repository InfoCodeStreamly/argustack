export type Severity = 'error' | 'warning';

export interface HardcodePattern {
  pattern: RegExp;
  suggestion: string;
  severity: Severity;
  category: string;
}

export interface LocalConstantPattern {
  pattern: RegExp;
  suggestion: string;
  severity: Severity;
}

export interface SSOTImportRequirement {
  usagePattern: RegExp;
  requiredImport: RegExp;
  suggestion: string;
}

export interface Violation {
  file: string;
  line: number;
  content: string;
  match: string;
  suggestion: string;
  severity: Severity;
  category: string;
}

export interface LocalConstantViolation {
  file: string;
  line: number;
  content: string;
  suggestion: string;
}

export interface ImportViolation {
  file: string;
  usage: string;
  suggestion: string;
}
