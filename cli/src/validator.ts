import { DirectoryEntry, ScanResult } from './scanner';

/**
 * Default size limits for validation
 */
export const DEFAULT_MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100 MB
export const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024;   // 50 MB

/**
 * Validation error types
 */
export type ValidationErrorType = 'total_size_exceeded' | 'file_size_exceeded';

/**
 * Details about a validation error
 */
export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  /** The file that caused the error (for file_size_exceeded) */
  file?: DirectoryEntry;
  /** The actual size that exceeded the limit */
  actualSize: number;
  /** The limit that was exceeded */
  limit: number;
}

/**
 * Result of validating a scan result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Options for validation
 */
export interface ValidationOptions {
  maxTotalSize?: number;
  maxFileSize?: number;
}

/**
 * Validates a scan result against size limits.
 * 
 * @param scanResult - The scan result to validate
 * @param options - Optional size limits (defaults to 100MB total, 50MB per file)
 * @returns ValidationResult indicating if the scan is valid and any errors
 */
export function validateScanResult(
  scanResult: ScanResult,
  options: ValidationOptions = {}
): ValidationResult {
  const maxTotalSize = options.maxTotalSize ?? DEFAULT_MAX_TOTAL_SIZE;
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const errors: ValidationError[] = [];

  // Check each file against the individual file size limit
  for (const entry of scanResult.entries) {
    if (!entry.isDirectory && entry.size > maxFileSize) {
      errors.push({
        type: 'file_size_exceeded',
        message: `File "${entry.relativePath}" exceeds the ${formatSize(maxFileSize)} limit (${formatSize(entry.size)})`,
        file: entry,
        actualSize: entry.size,
        limit: maxFileSize,
      });
    }
  }

  // Check total size against the total size limit
  if (scanResult.totalSize > maxTotalSize) {
    errors.push({
      type: 'total_size_exceeded',
      message: `Total directory size ${formatSize(scanResult.totalSize)} exceeds the ${formatSize(maxTotalSize)} limit`,
      actualSize: scanResult.totalSize,
      limit: maxTotalSize,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Formats a size in bytes to a human-readable string.
 * 
 * @param bytes - Size in bytes
 * @returns Human-readable size string (e.g., "1.5 MB")
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
