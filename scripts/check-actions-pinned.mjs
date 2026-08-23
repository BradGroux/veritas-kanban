#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;
const FULL_DOCKER_DIGEST = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;
const RELEASE_COMMENT = /^v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/;

function parseUsesLine(line) {
  const match = line.match(/^\s*(?:-\s*)?uses:\s*(.+?)\s*$/);
  if (!match) return null;

  const declaration = match[1].trim();
  let reference;
  let comment = '';

  if (declaration.startsWith("'") || declaration.startsWith('"')) {
    const quote = declaration[0];
    const closingQuote = declaration.indexOf(quote, 1);
    if (closingQuote < 0) return { reference: declaration, comment };
    reference = declaration.slice(1, closingQuote);
    const remainder = declaration.slice(closingQuote + 1).trim();
    if (remainder.startsWith('#')) comment = remainder.slice(1).trim();
  } else {
    const commentIndex = declaration.search(/\s+#/);
    reference = (commentIndex >= 0 ? declaration.slice(0, commentIndex) : declaration).trim();
    if (commentIndex >= 0)
      comment = declaration
        .slice(commentIndex)
        .replace(/^\s+#\s*/, '')
        .trim();
  }

  return { reference, comment };
}

function releaseCommentViolation(file, line, reference, comment) {
  if (RELEASE_COMMENT.test(comment)) return null;
  return {
    file,
    line,
    reference,
    message: 'immutable external action pin must include a trailing release comment',
  };
}

export function findActionPinningViolations(files) {
  const violations = [];

  for (const [file, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [index, sourceLine] of content.split(/\r?\n/).entries()) {
      const parsed = parseUsesLine(sourceLine);
      if (!parsed) continue;

      const { reference, comment } = parsed;
      const line = index + 1;

      if (reference.startsWith('./')) continue;

      if (reference.startsWith('docker://')) {
        if (!FULL_DOCKER_DIGEST.test(reference)) {
          violations.push({
            file,
            line,
            reference,
            message: 'Docker action must use a full sha256 digest',
          });
          continue;
        }
        const commentViolation = releaseCommentViolation(file, line, reference, comment);
        if (commentViolation) violations.push(commentViolation);
        continue;
      }

      const separator = reference.lastIndexOf('@');
      const action = separator >= 0 ? reference.slice(0, separator) : reference;
      const revision = separator >= 0 ? reference.slice(separator + 1) : '';
      if (!action.includes('/') || !FULL_COMMIT_SHA.test(revision)) {
        violations.push({
          file,
          line,
          reference,
          message: 'external action must use a full 40-character commit SHA',
        });
        continue;
      }

      const commentViolation = releaseCommentViolation(file, line, reference, comment);
      if (commentViolation) violations.push(commentViolation);
    }
  }

  return violations;
}

export function findDependabotConfigurationViolations(content) {
  return /package-ecosystem:\s*['"]?github-actions['"]?(?:\s|$)/.test(content)
    ? []
    : ['Dependabot must retain a github-actions ecosystem entry'];
}

function collectYamlFiles(directory) {
  if (!existsSync(directory)) return {};
  const files = {};

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, collectYamlFiles(absolutePath));
    } else if (/\.ya?ml$/i.test(entry.name)) {
      const relativePath = path.relative(process.cwd(), absolutePath).replaceAll('\\', '/');
      files[relativePath] = readFileSync(absolutePath, 'utf8');
    }
  }

  return files;
}

export function runActionPinningCheck() {
  const workflowFiles = {
    ...collectYamlFiles(path.resolve('.github/workflows')),
    ...collectYamlFiles(path.resolve('.github/actions')),
  };
  const violations = findActionPinningViolations(workflowFiles);
  const dependabotPath = path.resolve('.github/dependabot.yml');
  const dependabotViolations = existsSync(dependabotPath)
    ? findDependabotConfigurationViolations(readFileSync(dependabotPath, 'utf8'))
    : ['Dependabot configuration is missing'];

  if (violations.length > 0 || dependabotViolations.length > 0) {
    console.error('Immutable GitHub Actions check failed.');
    for (const violation of violations) {
      console.error(
        `- ${violation.file}:${violation.line} ${violation.reference}: ${violation.message}`
      );
    }
    for (const message of dependabotViolations)
      console.error(`- .github/dependabot.yml: ${message}`);
    process.exitCode = 1;
    return false;
  }

  console.log(
    `Immutable GitHub Actions check passed (${Object.keys(workflowFiles).length} YAML files scanned).`
  );
  return true;
}

function isDirectExecution() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) runActionPinningCheck();
