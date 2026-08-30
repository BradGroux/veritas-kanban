import { describe, expect, it, vi } from 'vitest';
import { FileAdmissionReservationRepository } from '../storage/admission-reservation-repository.js';

type CompleteAppend = (
  handle: {
    write: (
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number | null
    ) => Promise<{ bytesWritten: number }>;
  },
  content: Uint8Array
) => Promise<void>;

function completeAppend(repository: FileAdmissionReservationRepository): CompleteAppend {
  return (
    repository as unknown as {
      writeCompleteAppend: CompleteAppend;
    }
  ).writeCompleteAppend.bind(repository);
}

describe('FileAdmissionReservationRepository append durability', () => {
  it('continues partial writes until the complete JSONL record is persisted', async () => {
    const writes: string[] = [];
    const write = vi.fn(
      async (buffer: Uint8Array, offset: number, length: number, position: number | null) => {
        expect(position).toBeNull();
        const bytesWritten = Math.min(3, length);
        writes.push(Buffer.from(buffer.subarray(offset, offset + bytesWritten)).toString('utf8'));
        return { bytesWritten };
      }
    );

    await completeAppend(new FileAdmissionReservationRepository('/tmp/admission.jsonl'))(
      { write },
      Buffer.from('{"durable":true}\n')
    );

    expect(writes.join('')).toBe('{"durable":true}\n');
    expect(write).toHaveBeenCalledTimes(6);
  });

  it('fails closed when an append makes no forward progress', async () => {
    const write = vi.fn().mockResolvedValue({ bytesWritten: 0 });

    await expect(
      completeAppend(new FileAdmissionReservationRepository('/tmp/admission.jsonl'))(
        { write },
        Buffer.from('{"durable":true}\n')
      )
    ).rejects.toThrow(/no forward progress/i);
  });
});
