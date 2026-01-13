/**
 * Tunnel Client Module
 * 
 * Handles WebSocket connection to the relay server, message handling,
 * and file streaming for the fwdcast CLI.
 * 
 * Requirements: 1.5, 1.6, 3.1, 3.2, 3.6, 5.1, 5.3, 5.4, 5.5
 */

import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { lookup } from 'mime-types';
import archiver from 'archiver';
import {
  RegisterMessage,
  RegisteredMessage,
  RequestMessage,
  ResponseMessage,
  DataMessage,
  EndMessage,
  serializeMessage,
  deserializeMessage,
  isRegisteredMessage,
  isRequestMessage,
  isExpiredMessage,
  createRegisterMessage,
  createResponseMessage,
  createDataMessage,
  createEndMessage,
} from './protocol';
import { scanDirectory, calculateScanResult, scanDirectoryShallow } from './scanner';
import { DirectoryEntry } from './scanner';
import { generateDirectoryHtml } from './html-generator';

/**
 * Configuration for the tunnel client
 */
export interface TunnelClientConfig {
  relayUrl: string;
  basePath: string;
  entries: DirectoryEntry[];
  expiresAt: number;
  onUrl?: (url: string) => void;
  onExpired?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Result of a successful registration
 */
export interface RegistrationResult {
  sessionId: string;
  url: string;
}

/**
 * Chunk size for file streaming (64KB)
 */
const CHUNK_SIZE = 64 * 1024;

/**
 * TunnelClient manages the WebSocket connection to the relay server
 * and handles incoming requests by serving files or directory listings.
 */
export class TunnelClient {
  private ws: WebSocket | null = null;
  private config: TunnelClientConfig;
  private connected: boolean = false;
  private sessionId: string | null = null;
  private registrationPromise: {
    resolve: (result: RegistrationResult) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(config: TunnelClientConfig) {
    this.config = config;
  }

  /**
   * Connect to the relay server and register the session.
   * Returns the public URL for the shared directory.
   * 
   * Requirements: 1.5, 1.6, 5.1
   */
  async connect(): Promise<RegistrationResult> {
    return new Promise((resolve, reject) => {
      this.registrationPromise = { resolve, reject };

      try {
        this.ws = new WebSocket(this.config.relayUrl);

        this.ws.on('open', () => {
          this.connected = true;
          this.sendRegisterMessage();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', () => {
          this.connected = false;
          // Only call onDisconnect if we were successfully registered
          // (not during initial connection attempts)
          if (!this.registrationPromise && this.config.onDisconnect) {
            this.config.onDisconnect();
          }
          // If still trying to register, reject the promise
          if (this.registrationPromise) {
            this.registrationPromise.reject(new Error('Connection closed during registration'));
            this.registrationPromise = null;
          }
        });

        this.ws.on('error', (error: Error) => {
          if (this.registrationPromise) {
            this.registrationPromise.reject(error);
            this.registrationPromise = null;
          }
          if (this.config.onError) {
            this.config.onError(error);
          }
        });
      } catch (error) {
        reject(error as Error);
      }
    });
  }

  /**
   * Disconnect from the relay server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Send the register message to the relay server
   * Requirements: 5.1
   */
  private sendRegisterMessage(): void {
    const message = createRegisterMessage(
      this.config.basePath,
      this.config.expiresAt
    );
    this.send(message);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    const messageStr = data.toString();
    const message = deserializeMessage(messageStr);

    if (!message) {
      console.error('Received invalid message:', messageStr);
      return;
    }

    if (isRegisteredMessage(message)) {
      this.handleRegistered(message);
    } else if (isRequestMessage(message)) {
      this.handleRequest(message);
    } else if (isExpiredMessage(message)) {
      this.handleExpired();
    }
  }

  /**
   * Handle registration response from relay
   * Requirements: 1.6
   */
  private handleRegistered(message: RegisteredMessage): void {
    // Store session ID for use in directory listings
    this.sessionId = message.sessionId;
    
    const result: RegistrationResult = {
      sessionId: message.sessionId,
      url: message.url,
    };

    if (this.registrationPromise) {
      this.registrationPromise.resolve(result);
      this.registrationPromise = null;
    }

    if (this.config.onUrl) {
      this.config.onUrl(message.url);
    }
  }

  /**
   * Handle incoming request from relay
   * Routes to file server or directory listing
   * 
   * Requirements: 3.1, 3.2, 5.3, 5.4, 5.5
   */
  private async handleRequest(message: RequestMessage): Promise<void> {
    const { id, method, path: requestPath } = message;

    // Normalize the request path
    const normalizedPath = this.normalizePath(requestPath);
    
    // Check for special ZIP download request
    if (normalizedPath === '__download__.zip' || normalizedPath.endsWith('/__download__.zip')) {
      const dirPath = normalizedPath.replace('/__download__.zip', '').replace('__download__.zip', '');
      await this.serveZipDownload(id, dirPath);
      return;
    }
    
    const absolutePath = path.join(this.config.basePath, normalizedPath);

    // Security check: ensure the path is within the base directory
    const resolvedBase = path.resolve(this.config.basePath);
    const resolvedPath = path.resolve(absolutePath);
    
    if (!resolvedPath.startsWith(resolvedBase)) {
      this.sendErrorResponse(id, 403, 'Forbidden');
      return;
    }

    try {
      // Check if path exists
      const stat = await fs.promises.stat(resolvedPath);

      if (stat.isDirectory()) {
        // Serve directory listing
        await this.serveDirectoryListing(id, normalizedPath);
      } else {
        // Serve file
        await this.serveFile(id, resolvedPath, method);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.sendErrorResponse(id, 404, 'Not Found');
      } else {
        console.error('Error handling request:', error);
        this.sendErrorResponse(id, 500, 'Internal Server Error');
      }
    }
  }

  /**
   * Handle session expired message
   */
  private handleExpired(): void {
    if (this.config.onExpired) {
      this.config.onExpired();
    }
    this.disconnect();
  }

  /**
   * Serve a ZIP download of a directory
   */
  private async serveZipDownload(requestId: string, dirPath: string): Promise<void> {
    try {
      const absoluteDirPath = dirPath 
        ? path.join(this.config.basePath, dirPath)
        : this.config.basePath;
      
      // Get directory name for the ZIP filename
      const dirName = dirPath ? path.basename(dirPath) : 'files';
      
      // Send response headers (chunked transfer since we don't know size)
      this.sendResponse(requestId, 200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${dirName}.zip"`,
        'Transfer-Encoding': 'chunked',
      });

      // Create archive
      const archive = archiver('zip', { zlib: { level: 5 } });
      
      // Collect chunks and send them
      archive.on('data', (chunk: Buffer) => {
        this.sendData(requestId, chunk);
      });

      archive.on('end', () => {
        this.sendEnd(requestId);
      });

      archive.on('error', (err) => {
        console.error('Archive error:', err);
        this.sendEnd(requestId);
      });

      // Add directory contents to archive
      archive.directory(absoluteDirPath, false);
      
      // Finalize the archive
      await archive.finalize();
    } catch (error) {
      console.error('Error creating ZIP:', error);
      this.sendErrorResponse(requestId, 500, 'Failed to create ZIP');
    }
  }

  /**
   * Serve a directory listing as HTML
   * Requirements: 3.5
   * 
   * Dynamically scans the directory on each request to reflect
   * any files added/removed since the session started.
   */
  private async serveDirectoryListing(requestId: string, dirPath: string): Promise<void> {
    try {
      // Dynamically scan the directory for current contents
      const absoluteDirPath = path.join(this.config.basePath, dirPath);
      const children = await scanDirectoryShallow(absoluteDirPath, this.config.basePath);
      
      // Generate HTML with session ID for correct links
      const html = generateDirectoryHtml(children, dirPath, this.sessionId || undefined);
      const htmlBuffer = Buffer.from(html, 'utf-8');

      // Send response headers
      this.sendResponse(requestId, 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': htmlBuffer.length.toString(),
      });

      // Send data
      this.sendData(requestId, htmlBuffer);

      // Send end
      this.sendEnd(requestId);
    } catch (error) {
      console.error('Error serving directory listing:', error);
      this.sendErrorResponse(requestId, 500, 'Internal Server Error');
    }
  }

  /**
   * Stream a file to the relay
   * Requirements: 3.6
   */
  private async serveFile(
    requestId: string,
    filePath: string,
    method: string
  ): Promise<void> {
    const stat = await fs.promises.stat(filePath);
    const contentType = this.getContentType(filePath);

    // Send response headers
    this.sendResponse(requestId, 200, {
      'Content-Type': contentType,
      'Content-Length': stat.size.toString(),
    });

    // For HEAD requests, don't send body
    if (method === 'HEAD') {
      this.sendEnd(requestId);
      return;
    }

    // Stream file contents
    await this.streamFile(requestId, filePath);
  }

  /**
   * Stream file contents in chunks
   * Requirements: 3.6, 5.4, 5.5
   */
  private streamFile(requestId: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(filePath, {
        highWaterMark: CHUNK_SIZE,
      });

      readStream.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.sendData(requestId, buffer);
      });

      readStream.on('end', () => {
        this.sendEnd(requestId);
        resolve();
      });

      readStream.on('error', (error) => {
        console.error('Error streaming file:', error);
        this.sendEnd(requestId);
        reject(error);
      });
    });
  }

  /**
   * Send an error response
   */
  private sendErrorResponse(requestId: string, status: number, message: string): void {
    const html = `<!DOCTYPE html>
<html>
<head><title>${status} ${message}</title></head>
<body><h1>${status} ${message}</h1></body>
</html>`;
    const htmlBuffer = Buffer.from(html, 'utf-8');

    this.sendResponse(requestId, status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': htmlBuffer.length.toString(),
    });
    this.sendData(requestId, htmlBuffer);
    this.sendEnd(requestId);
  }

  /**
   * Send a response message
   * Requirements: 5.3
   */
  sendResponse(id: string, status: number, headers: Record<string, string>): void {
    const message = createResponseMessage(id, status, headers);
    this.send(message);
  }

  /**
   * Send a data message with base64 encoded chunk
   * Requirements: 5.4
   */
  sendData(id: string, chunk: Buffer): void {
    const message = createDataMessage(id, chunk.toString('base64'));
    this.send(message);
  }

  /**
   * Send an end message
   * Requirements: 5.5
   */
  sendEnd(id: string): void {
    const message = createEndMessage(id);
    this.send(message);
  }

  /**
   * Send a message through the WebSocket
   */
  private send(message: RegisterMessage | ResponseMessage | DataMessage | EndMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serializeMessage(message));
    }
  }

  /**
   * Normalize a request path
   */
  private normalizePath(requestPath: string): string {
    // Remove leading slash and decode URI components
    let normalized = decodeURIComponent(requestPath).replace(/^\/+/, '');
    // Remove trailing slash
    normalized = normalized.replace(/\/+$/, '');
    return normalized;
  }

  /**
   * Get the content type for a file based on its extension
   */
  private getContentType(filePath: string): string {
    const mimeType = lookup(filePath);
    return mimeType || 'application/octet-stream';
  }
}

/**
 * Create and connect a tunnel client
 * Convenience function for simple usage
 */
export async function createTunnelClient(
  config: TunnelClientConfig
): Promise<{ client: TunnelClient; result: RegistrationResult }> {
  const client = new TunnelClient(config);
  const result = await client.connect();
  return { client, result };
}
