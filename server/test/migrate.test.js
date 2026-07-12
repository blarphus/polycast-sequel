import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMigrationManifest } from '../migrate.js';

const checksum = 'a'.repeat(64);

test('migration manifest accepts one contiguous immutable version sequence', () => {
  assert.doesNotThrow(() => validateMigrationManifest([
    { version: 1, file: '001-baseline.js', checksum },
    { version: 2, file: '002-next.js', checksum },
  ]));
});

test('migration manifest rejects gaps and duplicate versions', () => {
  assert.throws(() => validateMigrationManifest([
    { version: 1, file: '001-baseline.js', checksum },
    { version: 3, file: '003-gap.js', checksum },
  ]), /sequence gap/i);
  assert.throws(() => validateMigrationManifest([
    { version: 1, file: '001-a.js', checksum },
    { version: 1, file: '001-b.js', checksum },
  ]), /duplicate/i);
});
