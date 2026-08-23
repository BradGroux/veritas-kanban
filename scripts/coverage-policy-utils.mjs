import path from 'node:path';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const TRACKING_ISSUE_PATTERN = /^#\d+$/;
const GLOB_PATTERN = /[*?[\]{}!]/;

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function coverageExceptionErrors(exception, label, today) {
  const errors = [];
  const normalized = path.posix.normalize(exception.path ?? '');
  if (
    !exception.path ||
    normalized !== exception.path ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized) ||
    GLOB_PATTERN.test(normalized)
  ) {
    errors.push(`${label} exception path must be one exact repository-relative file`);
  }
  if (typeof exception.reason !== 'string' || exception.reason.trim().length < 20) {
    errors.push(`${label} exception reason must contain at least 20 characters`);
  }
  if (!GITHUB_LOGIN_PATTERN.test(exception.owner ?? '')) {
    errors.push(`${label} exception owner must be a GitHub login`);
  }
  if (!TRACKING_ISSUE_PATTERN.test(exception.trackingIssue ?? '')) {
    errors.push(`${label} exception must reference a tracking issue such as #123`);
  }
  if (!isValidIsoDate(exception.reviewBy)) {
    errors.push(`${label} exception reviewBy must be a real YYYY-MM-DD date`);
    return errors;
  }
  const maximum = new Date(`${today}T00:00:00.000Z`);
  maximum.setUTCDate(maximum.getUTCDate() + 90);
  if (exception.reviewBy < today || exception.reviewBy > maximum.toISOString().slice(0, 10)) {
    errors.push(`${label} exception reviewBy must be today or within the next 90 days`);
  }
  return errors;
}
