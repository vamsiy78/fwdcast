import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { scanDirectory, calculateScanResult, DirectoryEntry } from './scanner';

// Helper to create a temporary directory for testing
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'fwdcast-test-'));
}

// Helper to clean up temporary directory
async function cleanupTempDir(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}

// Arbitrary for generating valid file/directory names
const validNameArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
  { minLength: 1, maxLength: 10 }
);

// Structure representing a directory tree for generation
interface DirTree {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  children?: DirTree[];
}

// Arbitrary for generating directory trees with unique names at each level
const dirTreeArb: fc.Arbitrary<DirTree> = fc.letrec((tie) => ({
  file: fc.record({
    name: validNameArb,
    type: fc.constant('file' as const),
    size: fc.integer({ min: 0, max: 1000 }),
  }),
  dir: fc.record({
    name: validNameArb,
    type: fc.constant('dir' as const),
    children: fc.array(fc.oneof(tie('file'), tie('dir')), { maxLength: 3, depthIdentifier: 'tree' })
      .map((children) => {
        // Ensure unique names within children
        const seen = new Set<string>();
        return children.filter((c) => {
          if (seen.has(c.name)) return false;
          seen.add(c.name);
          return true;
        });
      }),
  }),
  tree: fc.oneof(tie('file'), tie('dir')),
})).tree;

// Generate a list of unique trees (no duplicate names at same level)
const uniqueTreesArb = fc.array(dirTreeArb, { minLength: 0, maxLength: 5 })
  .map((trees) => {
    const seen = new Set<string>();
    return trees.filter((t) => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });
  });

// Helper to create directory structure on disk
async function createDirTree(basePath: string, trees: DirTree[]): Promise<void> {
  for (const tree of trees) {
    const fullPath = path.join(basePath, tree.name);
    if (tree.type === 'file') {
      const content = Buffer.alloc(tree.size || 0, 'x');
      await fs.writeFile(fullPath, content);
    } else {
      await fs.mkdir(fullPath, { recursive: true });
      if (tree.children) {
        await createDirTree(fullPath, tree.children);
      }
    }
  }
}

// Helper to count expected entries from tree structure
function countExpectedEntries(trees: DirTree[]): { files: number; dirs: number; total: number } {
  let files = 0;
  let dirs = 0;
  
  function count(tree: DirTree): void {
    if (tree.type === 'file') {
      files++;
    } else {
      dirs++;
      if (tree.children) {
        tree.children.forEach(count);
      }
    }
  }
  
  trees.forEach(count);
  return { files, dirs, total: files + dirs };
}

// Helper to collect all expected names from tree
function collectExpectedNames(trees: DirTree[], prefix = ''): Set<string> {
  const names = new Set<string>();
  
  function collect(tree: DirTree, currentPrefix: string): void {
    const relativePath = currentPrefix ? path.join(currentPrefix, tree.name) : tree.name;
    names.add(relativePath);
    if (tree.type === 'dir' && tree.children) {
      tree.children.forEach((child) => collect(child, relativePath));
    }
  }
  
  trees.forEach((tree) => collect(tree, prefix));
  return names;
}

describe('Scanner', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Feature: fwdcast, Property 1: Directory Scan Completeness
   * For any directory structure, scanning it should return all files and 
   * subdirectories, with no entries missing and no duplicates.
   * Validates: Requirements 1.1
   */
  it('Property 1: Directory Scan Completeness - all entries found with no duplicates', async () => {
    await fc.assert(
      fc.asyncProperty(uniqueTreesArb, async (trees) => {
        // Create a fresh temp directory for each iteration
        const iterTempDir = await createTempDir();
        
        try {
          // Create the directory structure
          await createDirTree(iterTempDir, trees);
          
          // Scan the directory
          const entries = await scanDirectory(iterTempDir);
          
          // Get expected counts and names
          const expected = countExpectedEntries(trees);
          const expectedNames = collectExpectedNames(trees);
          
          // Verify count matches
          expect(entries.length).toBe(expected.total);
          
          // Verify no duplicates
          const foundPaths = entries.map((e) => e.relativePath);
          const uniquePaths = new Set(foundPaths);
          expect(uniquePaths.size).toBe(entries.length);
          
          // Verify all expected entries are found
          for (const entry of entries) {
            expect(expectedNames.has(entry.relativePath)).toBe(true);
          }
          
          // Verify all expected names are in results
          for (const name of expectedNames) {
            expect(foundPaths).toContain(name);
          }
        } finally {
          // Clean up the temp directory
          await cleanupTempDir(iterTempDir);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Feature: fwdcast, Property 2: Size Calculation Accuracy
   * For any set of directory entries with known file sizes, the calculated 
   * total size should equal the sum of all individual file sizes.
   * Validates: Requirements 1.2
   */
  it('Property 2: Size Calculation Accuracy - sum equals total', () => {
    // Generate random DirectoryEntry arrays with known sizes
    const entryArb = fc.record({
      name: validNameArb,
      relativePath: validNameArb,
      absolutePath: fc.constant('/tmp/test'),
      isDirectory: fc.boolean(),
      size: fc.integer({ min: 0, max: 10000000 }), // Up to 10MB
      modifiedAt: fc.date(),
    });

    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 0, maxLength: 50 }), (entries) => {
        // Calculate expected values
        let expectedTotalSize = 0;
        let expectedFileCount = 0;
        let expectedDirCount = 0;

        for (const entry of entries) {
          if (entry.isDirectory) {
            expectedDirCount++;
          } else {
            expectedFileCount++;
            expectedTotalSize += entry.size;
          }
        }

        // Run the function
        const result = calculateScanResult(entries as DirectoryEntry[]);

        // Verify all calculations are accurate
        expect(result.totalSize).toBe(expectedTotalSize);
        expect(result.fileCount).toBe(expectedFileCount);
        expect(result.directoryCount).toBe(expectedDirCount);
        expect(result.entries).toBe(entries);
      }),
      { numRuns: 100 }
    );
  });
});
