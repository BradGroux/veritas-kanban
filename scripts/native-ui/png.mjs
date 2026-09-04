import assert from 'node:assert/strict';
import { crc32, inflateSync } from 'node:zlib';

// Electron captures are non-interlaced, 8-bit RGB/RGBA PNGs. Validate the
// complete chunk stream and decoded scanlines, not merely the signature.
export function screenshotSize(bytes) {
  assert(
    bytes.length > 32 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    'Invalid PNG signature'
  );
  let offset = 8;
  let width;
  let height;
  let channels;
  let ended = false;
  const imageData = [];
  while (offset < bytes.length) {
    assert(offset + 12 <= bytes.length && !ended, 'Truncated PNG or data after IEND');
    const length = bytes.readUInt32BE(offset);
    assert(offset + 12 + length <= bytes.length, 'Truncated PNG chunk');
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(
      crc32(bytes.subarray(offset + 4, offset + 8 + length)),
      bytes.readUInt32BE(offset + 8 + length),
      'PNG checksum mismatch'
    );
    if (offset === 8) {
      assert(type === 'IHDR' && length === 13, 'Missing PNG header');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert(
        width > 0 && height > 0 && width * height <= 32_000_000,
        'Invalid screenshot dimensions'
      );
      assert(
        data[8] === 8 &&
          [2, 6].includes(data[9]) &&
          data[10] === 0 &&
          data[11] === 0 &&
          data[12] === 0,
        'Unsupported screenshot encoding'
      );
      channels = data[9] === 2 ? 3 : 4;
    } else if (type === 'IHDR') throw new Error('Duplicate PNG header');
    if (type === 'IDAT') imageData.push(data);
    if (type === 'IEND') {
      assert.equal(length, 0);
      ended = true;
    }
    offset += length + 12;
  }
  assert(ended && imageData.length > 0, 'Missing PNG image data or end');
  const stride = width * channels + 1;
  const decoded = inflateSync(Buffer.concat(imageData), { maxOutputLength: stride * height });
  assert.equal(decoded.length, stride * height, 'Incomplete decoded PNG');
  for (let row = 0; row < height; row++)
    assert(decoded[row * stride] <= 4, 'Invalid PNG scanline filter');
  return { width, height };
}
