#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ALLOWED_CATEGORIES = new Set([
  'authoritative-persistence',
  'packaged-readonly-content',
  'transient-process-io',
  'compatibility-debt',
]);
const FILESYSTEM_MODULE = /^(?:node:)?fs(?:\/promises)?$/;

export function findDirectFilesystemImports(source) {
  const sourceFile = ts.createSourceFile(
    'service.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const imports = [];
  const addImport = (moduleSpecifier) => {
    if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)) {
      const module = moduleSpecifier.text;
      if (FILESYSTEM_MODULE.test(module)) {
        const line = sourceFile.getLineAndCharacterOfPosition(moduleSpecifier.getStart()).line + 1;
        imports.push({ module, line });
      }
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addImport(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        addImport(node.moduleReference.expression);
      }
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) addImport(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return imports;
}

function collectTypeScriptFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(absolutePath));
    else if (entry.name.endsWith('.ts')) files.push(absolutePath);
  }
  return files.sort();
}

export function validateServiceFilesystemBoundary({ root, inventory }) {
  const violations = [];
  if (inventory.schemaVersion !== 1) violations.push('inventory schemaVersion must equal 1');
  if (!Array.isArray(inventory.entries)) violations.push('inventory entries must be an array');
  if (violations.length > 0) return violations;

  if (inventory.maximumEntries !== inventory.entries.length) {
    violations.push('maximumEntries must equal the classified entry count');
  }

  const classified = new Map();
  for (const entry of inventory.entries) {
    if (!entry || typeof entry.path !== 'string') {
      violations.push('every inventory entry must have a path');
      continue;
    }
    if (classified.has(entry.path)) violations.push(`${entry.path}: duplicate inventory entry`);
    classified.set(entry.path, entry);
    if (!ALLOWED_CATEGORIES.has(entry.category)) {
      violations.push(`${entry.path}: invalid category ${JSON.stringify(entry.category)}`);
    }
    if (!/^#\d+$/.test(entry.owner ?? '')) {
      violations.push(`${entry.path}: owner must be a GitHub issue reference`);
    }
    if (typeof entry.rationale !== 'string' || entry.rationale.trim().length < 20) {
      violations.push(`${entry.path}: rationale must explain the temporary exception`);
    }
  }

  const detected = new Set();
  const serviceDirectory = path.join(root, 'server/src/services');
  for (const absolutePath of collectTypeScriptFiles(serviceDirectory)) {
    const relativePath = path.relative(root, absolutePath).replaceAll('\\', '/');
    const imports = findDirectFilesystemImports(readFileSync(absolutePath, 'utf8'));
    if (imports.length === 0) continue;
    detected.add(relativePath);
    if (!classified.has(relativePath)) {
      violations.push(
        `${relativePath}:${imports[0].line}: unclassified direct filesystem import (${imports.map((item) => item.module).join(', ')})`
      );
    }
  }

  for (const classifiedPath of classified.keys()) {
    if (!detected.has(classifiedPath)) {
      violations.push(`${classifiedPath}: stale inventory entry has no direct filesystem import`);
    }
  }
  return violations.sort();
}

function parseArguments(argv) {
  const options = {
    root: process.cwd(),
    inventory: 'docs/architecture/service-filesystem-boundary.json',
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') options.root = path.resolve(argv[++index]);
    else if (argv[index] === '--inventory') options.inventory = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

export function runServiceFilesystemBoundaryCheck(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(argv);
    const inventoryPath = path.resolve(options.root, options.inventory);
    const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    const violations = validateServiceFilesystemBoundary({ root: options.root, inventory });
    if (violations.length > 0) {
      console.error('Service filesystem boundary check failed.');
      for (const violation of violations) console.error(`- ${violation}`);
      process.exitCode = 1;
      return false;
    }
    console.log(
      `Service filesystem boundary check passed (${inventory.entries.length} classified exceptions).`
    );
    return true;
  } catch (error) {
    console.error(`Service filesystem boundary check failed: ${error.message}`);
    process.exitCode = 1;
    return false;
  }
}

function isDirectExecution() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) runServiceFilesystemBoundaryCheck();
