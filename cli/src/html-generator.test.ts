import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { 
  generateDirectoryHtml, 
  sortEntries, 
  generateHref, 
  escapeHtml 
} from './html-generator';
import { DirectoryEntry } from './scanner';

// Arbitrary for generating valid file/directory names
const validNameArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
  { minLength: 1, maxLength: 20 }
);

// Arbitrary for generating a DirectoryEntry
const directoryEntryArb = (isDir: boolean): fc.Arbitrary<DirectoryEntry> =>
  fc.record({
    name: validNameArb,
    relativePath: validNameArb,
    absolutePath: fc.constant('/tmp/test'),
    isDirectory: fc.constant(isDir),
    size: isDir ? fc.constant(0) : fc.integer({ min: 0, max: 100 * 1024 * 1024 }),
    modifiedAt: fc.date(),
  });

// Arbitrary for generating a list of unique DirectoryEntry items
const uniqueEntriesArb = fc.tuple(
  fc.array(directoryEntryArb(true), { minLength: 0, maxLength: 5 }),
  fc.array(directoryEntryArb(false), { minLength: 0, maxLength: 5 })
).map(([dirs, files]) => {
  // Ensure unique names
  const seen = new Set<string>();
  const unique: DirectoryEntry[] = [];
  for (const entry of [...dirs, ...files]) {
    if (!seen.has(entry.name)) {
      seen.add(entry.name);
      unique.push(entry);
    }
  }
  return unique;
});

describe('HTML Generator', () => {
  /**
   * Feature: fwdcast, Property 7: Directory Listing HTML Correctness
   * For any directory with files and subdirectories, the generated HTML listing should:
   * - Be valid HTML
   * - Show all directories sorted before all files
   * - Display file sizes in human-readable format (B, KB, MB)
   * - Contain correct navigation links for all entries
   * Validates: Requirements 3.5, 6.1, 6.2, 6.3, 6.5
   */
  it('Property 7: Directory Listing HTML Correctness - structure and ordering', () => {
    fc.assert(
      fc.property(uniqueEntriesArb, fc.constantFrom('', '/', '/docs', '/path/to/dir'), (entries, currentPath) => {
        const html = generateDirectoryHtml(entries, currentPath);
        
        // 1. Verify it's valid HTML structure
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<html');
        expect(html).toContain('</html>');
        expect(html).toContain('<head>');
        expect(html).toContain('</head>');
        expect(html).toContain('<body>');
        expect(html).toContain('</body>');
        
        // 2. Verify VS Code-style UI elements are present
        expect(html).toContain('<style>');
        expect(html).toContain('</style>');
        expect(html).toContain('class="sidebar"');
        expect(html).toContain('class="file-tree"');
        expect(html).toContain('class="editor-area"');
        
        // 3. Verify all entries are present in the HTML
        for (const entry of entries) {
          expect(html).toContain(escapeHtml(entry.name));
        }
        
        // 4. Verify directories appear before files in the sidebar
        const sortedEntries = sortEntries(entries);
        if (sortedEntries.length >= 2) {
          const fileTreeMatch = html.match(/<div class="file-tree"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div class="editor-area"/);
          if (fileTreeMatch) {
            const fileTree = fileTreeMatch[1];
            const positions = sortedEntries.map(e => {
              const href = generateHref(e, currentPath);
              return fileTree.indexOf(`href="${escapeHtml(href)}"`);
            });
            
            // Verify positions are in ascending order (directories first)
            for (let i = 1; i < positions.length; i++) {
              if (positions[i] >= 0 && positions[i - 1] >= 0) {
                expect(positions[i]).toBeGreaterThan(positions[i - 1]);
              }
            }
          }
        }
        
        // 5. Verify file sizes are displayed in human-readable format
        if (entries.some(e => !e.isDirectory)) {
          const sizePatterns = [/\d+(\.\d+)?\s*B/, /\d+(\.\d+)?\s*KB/, /\d+(\.\d+)?\s*MB/];
          const hasSize = sizePatterns.some(pattern => pattern.test(html));
          expect(hasSize).toBe(true);
        }
        
        // 6. Verify correct href links for all entries
        for (const entry of entries) {
          const expectedHref = generateHref(entry, currentPath);
          expect(html).toContain(`href="${escapeHtml(expectedHref)}"`);
        }
        
        // 7. Verify directories have trailing slash in display name
        for (const entry of entries) {
          if (entry.isDirectory) {
            expect(html).toContain(`${escapeHtml(entry.name)}/</span>`);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  describe('sortEntries', () => {
    it('should sort directories before files', () => {
      fc.assert(
        fc.property(uniqueEntriesArb, (entries) => {
          const sorted = sortEntries(entries);
          
          // Find the index where files start
          let lastDirIndex = -1;
          let firstFileIndex = sorted.length;
          
          for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].isDirectory) {
              lastDirIndex = i;
            } else if (firstFileIndex === sorted.length) {
              firstFileIndex = i;
            }
          }
          
          // All directories should come before all files
          if (lastDirIndex >= 0 && firstFileIndex < sorted.length) {
            expect(lastDirIndex).toBeLessThan(firstFileIndex);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should sort alphabetically within directories and files', () => {
      fc.assert(
        fc.property(uniqueEntriesArb, (entries) => {
          const sorted = sortEntries(entries);
          
          // Check directories are sorted alphabetically
          const dirs = sorted.filter(e => e.isDirectory);
          for (let i = 1; i < dirs.length; i++) {
            expect(dirs[i].name.toLowerCase().localeCompare(dirs[i-1].name.toLowerCase())).toBeGreaterThanOrEqual(0);
          }
          
          // Check files are sorted alphabetically
          const files = sorted.filter(e => !e.isDirectory);
          for (let i = 1; i < files.length; i++) {
            expect(files[i].name.toLowerCase().localeCompare(files[i-1].name.toLowerCase())).toBeGreaterThanOrEqual(0);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('generateHref', () => {
    it('should generate correct href for root path', () => {
      const entry: DirectoryEntry = {
        name: 'test',
        relativePath: 'test',
        absolutePath: '/tmp/test',
        isDirectory: false,
        size: 100,
        modifiedAt: new Date(),
      };
      
      expect(generateHref(entry, '')).toBe('/test');
      expect(generateHref(entry, '/')).toBe('/test');
    });

    it('should add trailing slash for directories', () => {
      const entry: DirectoryEntry = {
        name: 'docs',
        relativePath: 'docs',
        absolutePath: '/tmp/docs',
        isDirectory: true,
        size: 0,
        modifiedAt: new Date(),
      };
      
      expect(generateHref(entry, '')).toBe('/docs/');
      expect(generateHref(entry, '/path')).toBe('/path/docs/');
    });

    it('should include session ID prefix when provided', () => {
      const entry: DirectoryEntry = {
        name: 'test.txt',
        relativePath: 'test.txt',
        absolutePath: '/tmp/test.txt',
        isDirectory: false,
        size: 100,
        modifiedAt: new Date(),
      };
      
      expect(generateHref(entry, '', 'abc123')).toBe('/abc123/test.txt');
      expect(generateHref(entry, '/docs', 'abc123')).toBe('/abc123/docs/test.txt');
    });

    it('should include session ID prefix for directories', () => {
      const entry: DirectoryEntry = {
        name: 'images',
        relativePath: 'images',
        absolutePath: '/tmp/images',
        isDirectory: true,
        size: 0,
        modifiedAt: new Date(),
      };
      
      expect(generateHref(entry, '', 'session456')).toBe('/session456/images/');
      expect(generateHref(entry, '/path', 'session456')).toBe('/session456/path/images/');
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(escapeHtml('"test"')).toBe('&quot;test&quot;');
      expect(escapeHtml("'test'")).toBe('&#039;test&#039;');
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });
  });
});
