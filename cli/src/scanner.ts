import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Represents a single entry (file or directory) in a scanned directory
 */
export interface DirectoryEntry {
  name: string;
  relativePath: string;
  absolutePath: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: Date;
}

/**
 * Result of scanning a directory
 */
export interface ScanResult {
  entries: DirectoryEntry[];
  totalSize: number;
  fileCount: number;
  directoryCount: number;
}

/**
 * Check if a name matches any exclude pattern
 */
function matchesExcludePattern(name: string, excludePatterns: string[]): boolean {
  for (const pattern of excludePatterns) {
    // Simple glob matching: support * wildcard
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(name)) return true;
    } else {
      // Exact match
      if (name === pattern) return true;
    }
  }
  return false;
}

/**
 * Recursively scans a directory and returns all entries.
 * Symlinks are skipped.
 * 
 * @param dirPath - The directory path to scan
 * @param basePath - The base path for calculating relative paths (defaults to dirPath)
 * @param excludePatterns - Array of patterns to exclude (e.g., ['.git', 'node_modules'])
 * @returns Array of DirectoryEntry objects
 */
export async function scanDirectory(
  dirPath: string,
  basePath?: string,
  excludePatterns: string[] = []
): Promise<DirectoryEntry[]> {
  const resolvedPath = path.resolve(dirPath);
  const resolvedBase = basePath ? path.resolve(basePath) : resolvedPath;
  const entries: DirectoryEntry[] = [];

  const items = await fs.readdir(resolvedPath, { withFileTypes: true });

  for (const item of items) {
    // Skip excluded items
    if (matchesExcludePattern(item.name, excludePatterns)) {
      continue;
    }
    
    const absolutePath = path.join(resolvedPath, item.name);
    
    // Skip symlinks as per requirements
    if (item.isSymbolicLink()) {
      continue;
    }

    const stat = await fs.stat(absolutePath);
    const relativePath = path.relative(resolvedBase, absolutePath);

    const entry: DirectoryEntry = {
      name: item.name,
      relativePath,
      absolutePath,
      isDirectory: item.isDirectory(),
      size: item.isDirectory() ? 0 : stat.size,
      modifiedAt: stat.mtime,
    };

    entries.push(entry);

    // Recursively scan subdirectories
    if (item.isDirectory()) {
      const subEntries = await scanDirectory(absolutePath, resolvedBase, excludePatterns);
      entries.push(...subEntries);
    }
  }

  return entries;
}

/**
 * Calculates the total size and counts from directory entries.
 * 
 * @param entries - Array of DirectoryEntry objects
 * @returns ScanResult with entries, totalSize, fileCount, and directoryCount
 */
export function calculateScanResult(entries: DirectoryEntry[]): ScanResult {
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

  return {
    entries,
    totalSize,
    fileCount,
    directoryCount,
  };
}

/**
 * Scans only the immediate children of a directory (non-recursive).
 * Used for dynamic directory listings.
 * 
 * @param dirPath - The directory path to scan
 * @param basePath - The base path for calculating relative paths
 * @param excludePatterns - Array of patterns to exclude
 * @returns Array of DirectoryEntry objects for immediate children only
 */
export async function scanDirectoryShallow(
  dirPath: string,
  basePath: string,
  excludePatterns: string[] = []
): Promise<DirectoryEntry[]> {
  const resolvedPath = path.resolve(dirPath);
  const resolvedBase = path.resolve(basePath);
  const entries: DirectoryEntry[] = [];

  const items = await fs.readdir(resolvedPath, { withFileTypes: true });

  for (const item of items) {
    // Skip excluded items
    if (matchesExcludePattern(item.name, excludePatterns)) {
      continue;
    }
    
    const absolutePath = path.join(resolvedPath, item.name);
    
    // Skip symlinks as per requirements
    if (item.isSymbolicLink()) {
      continue;
    }

    const stat = await fs.stat(absolutePath);
    const relativePath = path.relative(resolvedBase, absolutePath);

    const entry: DirectoryEntry = {
      name: item.name,
      relativePath,
      absolutePath,
      isDirectory: item.isDirectory(),
      size: item.isDirectory() ? 0 : stat.size,
      modifiedAt: stat.mtime,
    };

    entries.push(entry);
  }

  return entries;
}

// Export for testing
export { matchesExcludePattern };
