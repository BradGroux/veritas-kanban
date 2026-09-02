import type { Task } from '../types/task.types.js';

// Legacy tasks can have no explicit position. Give each one a stable numeric
// boundary so a moved task can be persisted between two legacy cards without
// rewriting either card's revision.
const LEGACY_BOARD_POSITION_BASE = 10_000_000_000;
const LEGACY_BOARD_TIME_CEILING_MS = 4_000_000_000_000;
const BOARD_RANK_PREFIX = 'v1:';
const MAX_BOARD_RANK_DIGITS = 2048;

type BoardOrderTask = Pick<Task, 'id' | 'created' | 'updated' | 'position' | 'boardRank'>;

interface Rational {
  numerator: bigint;
  denominator: bigint;
}

interface BoardOrderKey {
  position: Rational;
  tie: Rational;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function normalizeRational(value: Rational): Rational {
  const sign = value.denominator < 0n ? -1n : 1n;
  const numerator = value.numerator * sign;
  const denominator = value.denominator * sign;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function decimalToRational(value: number): Rational {
  const [coefficient, exponentText = '0'] = value.toString().toLowerCase().split('e');
  const exponent = Number(exponentText);
  const negative = coefficient.startsWith('-');
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [whole, fraction = ''] = unsigned.split('.');
  const digits = `${whole}${fraction}` || '0';
  let numerator = BigInt(digits) * (negative ? -1n : 1n);
  let denominator = 10n ** BigInt(fraction.length);
  if (exponent > 0) numerator *= 10n ** BigInt(exponent);
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent);
  return normalizeRational({ numerator, denominator });
}

function parseRational(value: string): Rational | null {
  const match = value.match(
    new RegExp(`^(-?\\d{1,${MAX_BOARD_RANK_DIGITS}})/(\\d{1,${MAX_BOARD_RANK_DIGITS}})$`)
  );
  if (!match) return null;
  const denominator = BigInt(match[2]);
  if (denominator <= 0n) return null;
  return normalizeRational({ numerator: BigInt(match[1]), denominator });
}

function parseBoardRank(value: string | undefined): BoardOrderKey | null {
  if (!value?.startsWith(BOARD_RANK_PREFIX)) return null;
  const [positionText, tieText] = value.slice(BOARD_RANK_PREFIX.length).split(';');
  const position = parseRational(positionText);
  const tie = tieText ? parseRational(tieText) : { numerator: 0n, denominator: 1n };
  return position && tie ? { position, tie } : null;
}

function serializeRational(value: Rational): string {
  const normalized = normalizeRational(value);
  const numerator = normalized.numerator.toString();
  const denominator = normalized.denominator.toString();
  if (
    numerator.replace('-', '').length > MAX_BOARD_RANK_DIGITS ||
    denominator.length > MAX_BOARD_RANK_DIGITS
  ) {
    throw new Error('Board rank precision exhausted');
  }
  return `${numerator}/${denominator}`;
}

function serializeBoardRank(value: BoardOrderKey): string {
  const position = serializeRational(value.position);
  const tie = normalizeRational(value.tie);
  return tie.numerator === 0n
    ? `${BOARD_RANK_PREFIX}${position}`
    : `${BOARD_RANK_PREFIX}${position};${serializeRational(tie)}`;
}

function stableIdOffset(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 499;
  return hash * 0.000002;
}

function legacyPosition(task: BoardOrderTask): number {
  const createdAt = Date.parse(task.created);
  const fallback = Date.parse(task.updated);
  const timestamp = Number.isFinite(createdAt)
    ? createdAt
    : Number.isFinite(fallback)
      ? fallback
      : 0;
  return (
    LEGACY_BOARD_POSITION_BASE +
    (LEGACY_BOARD_TIME_CEILING_MS - timestamp) / 1000 +
    stableIdOffset(task.id)
  );
}

function taskIdTie(id: string): Rational {
  const base = 65_537n;
  let numerator = 0n;
  let denominator = 1n;
  for (let index = 0; index < id.length; index++) {
    numerator = numerator * base + BigInt(id.charCodeAt(index) + 1);
    denominator *= base;
  }
  return normalizeRational({ numerator, denominator });
}

function taskBoardKey(task: BoardOrderTask): BoardOrderKey {
  const durableRank = parseBoardRank(task.boardRank);
  if (durableRank) return durableRank;
  const position =
    typeof task.position === 'number' && Number.isFinite(task.position)
      ? task.position
      : legacyPosition(task);
  return { position: decimalToRational(position), tie: taskIdTie(task.id) };
}

function compareRational(left: Rational, right: Rational): number {
  const delta = left.numerator * right.denominator - right.numerator * left.denominator;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

function rationalToCompatibilityPosition(value: Rational): number {
  const scaled = (value.numerator * 1_000_000_000_000n) / value.denominator;
  return Number(scaled) / 1_000_000_000_000;
}

export function effectiveTaskBoardPosition(task: BoardOrderTask): number {
  return rationalToCompatibilityPosition(taskBoardKey(task).position);
}

export function sortTasksByBoardPosition<T extends BoardOrderTask>(tasks: T[]): T[] {
  return [...tasks].sort((left, right) => {
    const leftKey = taskBoardKey(left);
    const rightKey = taskBoardKey(right);
    const positionDelta = compareRational(leftKey.position, rightKey.position);
    if (positionDelta !== 0) return positionDelta;
    const tieDelta = compareRational(leftKey.tie, rightKey.tie);
    if (tieDelta !== 0) return tieDelta;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export function taskBoardRankAtIndex(
  orderedTasks: BoardOrderTask[],
  destinationIndex: number
): string {
  const previous = destinationIndex > 0 ? taskBoardKey(orderedTasks[destinationIndex - 1]) : null;
  const next =
    destinationIndex < orderedTasks.length ? taskBoardKey(orderedTasks[destinationIndex]) : null;

  const zero = { numerator: 0n, denominator: 1n };

  if (!previous && !next) return serializeBoardRank({ position: zero, tie: zero });
  if (!previous && next) {
    return serializeBoardRank({
      position: {
        numerator: next.position.numerator - next.position.denominator,
        denominator: next.position.denominator,
      },
      tie: zero,
    });
  }
  if (previous && !next) {
    return serializeBoardRank({
      position: {
        numerator: previous.position.numerator + previous.position.denominator,
        denominator: previous.position.denominator,
      },
      tie: zero,
    });
  }

  const left = previous as BoardOrderKey;
  const right = next as BoardOrderKey;
  if (compareRational(left.position, right.position) === 0) {
    if (compareRational(left.tie, right.tie) >= 0) {
      throw new Error('Cannot allocate a board rank between duplicate ordering keys');
    }
    return serializeBoardRank({
      position: left.position,
      tie: {
        numerator: left.tie.numerator + right.tie.numerator,
        denominator: left.tie.denominator + right.tie.denominator,
      },
    });
  }
  return serializeBoardRank({
    position: {
      numerator: left.position.numerator + right.position.numerator,
      denominator: left.position.denominator + right.position.denominator,
    },
    tie: zero,
  });
}

export function taskBoardPositionAtIndex(
  orderedTasks: BoardOrderTask[],
  destinationIndex: number
): number {
  const rank = parseBoardRank(taskBoardRankAtIndex(orderedTasks, destinationIndex));
  return rationalToCompatibilityPosition((rank as BoardOrderKey).position);
}
