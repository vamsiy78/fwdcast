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
 * Transfer statistics
 */
export interface TransferStats {
  totalBytesSent: number;
  requestCount: number;
  activeViewers: number;
  currentSpeed: number; // bytes per second
}

/**
 * Configuration for the tunnel client
 */
export interface TunnelClientConfig {
  relayUrl: string;
  basePath: string;
  entries: DirectoryEntry[];
  expiresAt: number;
  password?: string;
  excludePatterns?: string[];
  onUrl?: (url: string) => void;
  onStats?: (stats: TransferStats) => void;
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
  private authenticatedTokens: Set<string> = new Set();
  private registrationPromise: {
    resolve: (result: RegistrationResult) => void;
    reject: (error: Error) => void;
  } | null = null;
  
  // Stats tracking
  private stats: TransferStats = {
    totalBytesSent: 0,
    requestCount: 0,
    activeViewers: 0,
    currentSpeed: 0,
  };
  private activeRequests: Set<string> = new Set();
  private recentBytes: { time: number; bytes: number }[] = [];
  private statsInterval: NodeJS.Timeout | null = null;

  constructor(config: TunnelClientConfig) {
    this.config = config;
  }

  /**
   * Track bytes sent for bandwidth stats
   */
  private trackBytesSent(bytes: number): void {
    this.stats.totalBytesSent += bytes;
    this.recentBytes.push({ time: Date.now(), bytes });
    
    // Keep only last 5 seconds of data
    const cutoff = Date.now() - 5000;
    this.recentBytes = this.recentBytes.filter(r => r.time > cutoff);
    
    // Calculate current speed
    if (this.recentBytes.length > 0) {
      const totalRecentBytes = this.recentBytes.reduce((sum, r) => sum + r.bytes, 0);
      const timeSpan = (Date.now() - this.recentBytes[0].time) / 1000;
      this.stats.currentSpeed = timeSpan > 0 ? totalRecentBytes / timeSpan : 0;
    }
  }

  /**
   * Start a request (track active viewers)
   */
  private startRequest(requestId: string): void {
    if (!this.activeRequests.has(requestId)) {
      this.activeRequests.add(requestId);
      this.stats.activeViewers = this.activeRequests.size;
      this.stats.requestCount++;
      this.emitStats();
    }
  }

  /**
   * End a request (track active viewers)
   */
  private endRequest(requestId: string): void {
    if (this.activeRequests.has(requestId)) {
      this.activeRequests.delete(requestId);
      this.stats.activeViewers = this.activeRequests.size;
      this.emitStats();
    }
  }

  /**
   * Emit stats to callback
   */
  private emitStats(): void {
    if (this.config.onStats) {
      this.config.onStats({ ...this.stats });
    }
  }

  /**
   * Start periodic stats updates
   */
  private startStatsInterval(): void {
    if (this.statsInterval) return;
    this.statsInterval = setInterval(() => {
      // Recalculate speed
      const cutoff = Date.now() - 5000;
      this.recentBytes = this.recentBytes.filter(r => r.time > cutoff);
      if (this.recentBytes.length > 0) {
        const totalRecentBytes = this.recentBytes.reduce((sum, r) => sum + r.bytes, 0);
        const timeSpan = (Date.now() - this.recentBytes[0].time) / 1000;
        this.stats.currentSpeed = timeSpan > 0 ? totalRecentBytes / timeSpan : 0;
      } else {
        this.stats.currentSpeed = 0;
      }
      this.emitStats();
    }, 1000);
  }

  /**
   * Stop stats interval
   */
  private stopStatsInterval(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
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
    this.stopStatsInterval();
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
      this.config.expiresAt,
      this.config.password
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
    
    // Start stats interval
    this.startStatsInterval();
  }

  /**
   * Handle incoming request from relay
   * Routes to file server or directory listing
   * 
   * Requirements: 3.1, 3.2, 5.3, 5.4, 5.5
   */
  private async handleRequest(message: RequestMessage): Promise<void> {
    const { id, method, path: requestPath } = message;

    // Track this request
    this.startRequest(id);

    // Normalize the request path
    const normalizedPath = this.normalizePath(requestPath);
    
    // Check for password authentication
    if (this.config.password) {
      // Check for auth token in query string
      const authMatch = requestPath.match(/[?&]auth=([^&]+)/);
      const authToken = authMatch ? authMatch[1] : null;
      
      // Handle login form submission
      if (normalizedPath === '__auth__' || normalizedPath.endsWith('/__auth__')) {
        await this.handleAuthRequest(id, requestPath);
        return;
      }
      
      // Check if authenticated
      if (!authToken || !this.authenticatedTokens.has(authToken)) {
        await this.serveLoginPage(id, normalizedPath);
        return;
      }
    }
    
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
   * Handle authentication request (password submission)
   */
  private async handleAuthRequest(requestId: string, requestPath: string): Promise<void> {
    // Extract password from query string
    const pwMatch = requestPath.match(/[?&]password=([^&]*)/);
    const submittedPassword = pwMatch ? decodeURIComponent(pwMatch[1]) : '';
    const redirectMatch = requestPath.match(/[?&]redirect=([^&]*)/);
    const redirectPath = redirectMatch ? decodeURIComponent(redirectMatch[1]) : '/';
    
    if (submittedPassword === this.config.password) {
      // Generate auth token
      const authToken = this.generateAuthToken();
      this.authenticatedTokens.add(authToken);
      
      // Redirect with auth token
      const baseUrl = this.sessionId ? `/${this.sessionId}` : '';
      const redirectUrl = `${baseUrl}${redirectPath.startsWith('/') ? redirectPath : '/' + redirectPath}?auth=${authToken}`;
      
      this.sendResponse(requestId, 302, {
        'Location': redirectUrl,
        'Content-Type': 'text/html',
        'Content-Length': '0',
      });
      this.sendEnd(requestId);
    } else {
      // Wrong password - show login page with error
      await this.serveLoginPage(requestId, redirectPath, true);
    }
  }

  /**
   * Generate a random auth token
   */
  private generateAuthToken(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  /**
   * Serve the login page for password-protected shares
   */
  private async serveLoginPage(requestId: string, redirectPath: string, showError: boolean = false): Promise<void> {
    const baseUrl = this.sessionId ? `/${this.sessionId}` : '';
    const html = this.generateLoginHtml(baseUrl, redirectPath, showError);
    const htmlBuffer = Buffer.from(html, 'utf-8');

    this.sendResponse(requestId, 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': htmlBuffer.length.toString(),
    });
    this.sendData(requestId, htmlBuffer);
    this.sendEnd(requestId);
  }

  /**
   * Generate login page HTML
   */
  private generateLoginHtml(baseUrl: string, redirectPath: string, showError: boolean): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>fwdcast - Password Required</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #1e1e1e;
      color: #cccccc;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .login-box {
      background: #252526;
      padding: 40px;
      border-radius: 8px;
      width: 100%;
      max-width: 360px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    .logo {
      text-align: center;
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      text-align: center;
      font-size: 20px;
      font-weight: 400;
      margin-bottom: 8px;
    }
    .subtitle {
      text-align: center;
      color: #858585;
      font-size: 13px;
      margin-bottom: 24px;
    }
    .error {
      background: #5a1d1d;
      color: #f48771;
      padding: 10px 14px;
      border-radius: 4px;
      margin-bottom: 16px;
      font-size: 13px;
    }
    label {
      display: block;
      font-size: 12px;
      color: #858585;
      margin-bottom: 6px;
    }
    input[type="password"] {
      width: 100%;
      padding: 10px 12px;
      background: #3c3c3c;
      border: 1px solid #3c3c3c;
      border-radius: 4px;
      color: #cccccc;
      font-size: 14px;
      margin-bottom: 20px;
    }
    input[type="password"]:focus {
      outline: none;
      border-color: #007acc;
    }
    button {
      width: 100%;
      padding: 10px;
      background: #007acc;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      cursor: pointer;
    }
    button:hover {
      background: #0098ff;
    }
  </style>
</head>
<body>
  <div class="login-box">
    <div class="logo">🔒</div>
    <h1>Password Required</h1>
    <p class="subtitle">This share is password protected</p>
    ${showError ? '<div class="error">Incorrect password. Please try again.</div>' : ''}
    <form method="GET" action="${baseUrl}/__auth__">
      <input type="hidden" name="redirect" value="${this.escapeHtml(redirectPath)}">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus required>
      <button type="submit">Access Files</button>
    </form>
  </div>
</body>
</html>`;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
      const excludePatterns = this.config.excludePatterns || [];
      const children = await scanDirectoryShallow(absoluteDirPath, this.config.basePath, excludePatterns);
      
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
    this.trackBytesSent(chunk.length);
  }

  /**
   * Send an end message
   * Requirements: 5.5
   */
  sendEnd(id: string): void {
    const message = createEndMessage(id);
    this.send(message);
    this.endRequest(id);
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
