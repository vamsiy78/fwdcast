import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DirectoryEntry, ScanResult } from './scanner';
import {
  validateScanResult,
  DEFAULT_MAX_TOTAL_SIZE,
  DEFAULT_MAX_FILE_SIZE,
} from './validator';

// Arbitrary for generating valid file/directory names
const validNameArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
  { minLength: 1, maxLength: 10 }
);

// Arbitrary for generating a DirectoryEntry
const directoryEntryArb = (maxSize: number) =>
  fc.record({
    name: validNameArb,
    relativePath: validNameArb,
    absolutePath: fc.constant('/tmp/test'),
    isDirectory: fc.boolean(),
    size: fc.integer({ min: 0, max: maxSize }),
    modifiedAt: fc.date(),
  }) as fc.Arbitrary<DirectoryEntry>;

// Helper to create a ScanResult from entries
function createScanResult(entries: DirectoryEntry[]): ScanResult {
  let totalSize = 0;
  let fileCount = 0;
  let directoryCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory) {
      directoryCount++;
    } else {
      fileCount++;
      totalSize += entry.size;
    }
  }

  return { entries, totalSize, fileCount, directoryCount };
}

describe('Validator', () => {
  /**
   * Feature: fwdcast, Property 3: Size Limit Validation
   * For any directory where total size exceeds 100 MB OR any single file exceeds 50 MB,
   * the validation should reject the share. For any directory within limits, validation should pass.
   * Validates: Requirements 1.3, 1.4
   */
  it('Property 3: Size Limit Validation - directories within limits pass validation', () => {
    // Generate entries where all files are under the file limit
    // and total size is under the total limit
    const smallFileArb = fc.record({
      name: validNameArb,
      relativePath: validNameArb,
      absolutePath: fc.constant('/tmp/test'),
      isDirectory: fc.constant(false),
      size: fc.integer({ min: 0, max: DEFAULT_MAX_FILE_SIZE }),
      modifiedAt: fc.date(),
    }) as fc.Arbitrary<DirectoryEntry>;

    const dirArb = fc.record({
      name: validNameArb,
      relativePath: validNameArb,
      absolutePath: fc.constant('/tmp/test'),
      isDirectory: fc.constant(true),
      size: fc.constant(0),
      modifiedAt: fc.date(),
    }) as fc.Arbitrary<DirectoryEntry>;

    // Generate a mix of files and directories, ensuring total stays under limit
    const entriesArb = fc.array(fc.oneof(smallFileArb, dirArb), { minLength: 0, maxLength: 10 })
      .filter((entries) => {
        const totalSize = entries.reduce((sum, e) => sum + (e.isDirectory ? 0 : e.size), 0);
        return totalSize <= DEFAULT_MAX_TOTAL_SIZE;
      });

    fc.assert(
      fc.property(entriesArb, (entries) => {
        const scanResult = createScanResult(entries);
        const result = validateScanResult(scanResult);

        // All entries are within limits, so validation should pass
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  it('Property 3: Size Limit Validation - files exceeding individual limit are rejected', () => {
    // Generate at least one file that exceeds the file size limit
    const oversizedFileArb = fc.record({
      name: validNameArb,
      relativePath: validNameArb,
      absolutePath: fc.constant('/tmp/test'),
      isDirectory: fc.constant(false),
      size: fc.integer({ min: DEFAULT_MAX_FILE_SIZE + 1, max: DEFAULT_MAX_FILE_SIZE * 2 }),
      modifiedAt: fc.date(),
    }) as fc.Arbitrary<DirectoryEntry>;

    const normalEntryArb = directoryEntryArb(DEFAULT_MAX_FILE_SIZE);

    fc.assert(
      fc.property(
        oversizedFileArb,
        fc.array(normalEntryArb, { minLength: 0, maxLength: 5 }),
        (oversizedFile, normalEntries) => {
          const entries = [oversizedFile, ...normalEntries];
          const scanResult = createScanResult(entries);
          const result = validateScanResult(scanResult);

          // Should be invalid due to oversized file
          expect(result.valid).toBe(false);
          
          // Should have at least one file_size_exceeded error
          const fileSizeErrors = result.errors.filter(e => e.type === 'file_size_exceeded');
          expect(fileSizeErrors.length).toBeGreaterThanOrEqual(1);
          
          // The oversized file should be in the errors
          const oversizedError = fileSizeErrors.find(e => e.file?.relativePath === oversizedFile.relativePath);
          expect(oversizedError).toBeDefined();
          expect(oversizedError!.actualSize).toBe(oversizedFile.size);
          expect(oversizedError!.limit).toBe(DEFAULT_MAX_FILE_SIZE);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 3: Size Limit Validation - total size exceeding limit is rejected', () => {
    // Generate files that together exceed the total size limit
    // Each file is under the individual limit but sum exceeds total limit
    const fileArb = fc.record({
      name: validNameArb,
      relativePath: validNameArb,
      absolutePath: fc.constant('/tmp/test'),
      isDirectory: fc.constant(false),
      // Each file is under 50MB but we'll generate enough to exceed 100MB total
      size: fc.integer({ min: 20 * 1024 * 1024, max: DEFAULT_MAX_FILE_SIZE }),
      modifiedAt: fc.date(),
    }) as fc.Arbitrary<DirectoryEntry>;

    // Generate 3-5 files of 20-50MB each, which will exceed 100MB total
    const entriesArb = fc.array(fileArb, { minLength: 3, maxLength: 5 })
      .filter((entries) => {
        const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
        return totalSize > DEFAULT_MAX_TOTAL_SIZE;
      });

    fc.assert(
      fc.property(entriesArb, (entries) => {
        const scanResult = createScanResult(entries);
        const result = validateScanResult(scanResult);

        // Should be invalid due to total size
        expect(result.valid).toBe(false);
        
        // Should have a total_size_exceeded error
        const totalSizeErrors = result.errors.filter(e => e.type === 'total_size_exceeded');
        expect(totalSizeErrors.length).toBe(1);
        expect(totalSizeErrors[0].actualSize).toBe(scanResult.totalSize);
        expect(totalSizeErrors[0].limit).toBe(DEFAULT_MAX_TOTAL_SIZE);
      }),
      { numRuns: 100 }
    );
  });

  it('Property 3: Size Limit Validation - boundary cases at exact limits', () => {
    // Test at exact boundaries
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }), // number of small files
        (numSmallFiles) => {
          // Create entries that sum to exactly the limit
          const entries: DirectoryEntry[] = [];
          
          // Add one file at exactly the file size limit
          entries.push({
            name: 'exact-limit-file',
            relativePath: 'exact-limit-file',
            absolutePath: '/tmp/test/exact-limit-file',
            isDirectory: false,
            size: DEFAULT_MAX_FILE_SIZE,
            modifiedAt: new Date(),
          });

          // Add small files to stay under total limit
          const remainingSize = DEFAULT_MAX_TOTAL_SIZE - DEFAULT_MAX_FILE_SIZE;
          const smallFileSize = Math.floor(remainingSize / Math.max(numSmallFiles, 1));
          
          for (let i = 0; i < numSmallFiles && (entries.length - 1) * smallFileSize < remainingSize; i++) {
            entries.push({
              name: `small-file-${i}`,
              relativePath: `small-file-${i}`,
              absolutePath: `/tmp/test/small-file-${i}`,
              isDirectory: false,
              size: Math.min(smallFileSize, remainingSize - (i * smallFileSize)),
              modifiedAt: new Date(),
            });
          }

          const scanResult = createScanResult(entries);
          
          // If total is at or under limit and no file exceeds limit, should pass
          if (scanResult.totalSize <= DEFAULT_MAX_TOTAL_SIZE) {
            const result = validateScanResult(scanResult);
            expect(result.valid).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
