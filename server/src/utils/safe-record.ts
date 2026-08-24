const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function assertSafeRecordKey(key: string, label = 'record key'): string {
  if (!key || FORBIDDEN_RECORD_KEYS.has(key)) {
    throw new Error(`${label} is not allowed`);
  }
  return key;
}

export function createSafeRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function safeRecordFrom<T>(input: unknown, label = 'record'): Record<string, T> {
  const output = createSafeRecord<T>();
  if (input === undefined || input === null) return output;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }

  for (const [key, value] of Object.entries(input)) {
    setSafeRecordValue(output, key, value as T, label);
  }
  return output;
}

export function getSafeRecordValue<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  label = 'record key'
): T | undefined {
  assertSafeRecordKey(key, label);
  return Object.getOwnPropertyDescriptor(record, key)?.value as T | undefined;
}

export function setSafeRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
  label = 'record key'
): void {
  assertSafeRecordKey(key, label);
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

export function deleteSafeRecordValue<T>(
  record: Record<string, T>,
  key: string,
  label = 'record key'
): boolean {
  assertSafeRecordKey(key, label);
  return Reflect.deleteProperty(record, key);
}
