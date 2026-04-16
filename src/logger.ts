/**
 * Global Logger
 *
 * Provides a singleton logger that writes to both console and a daily log file.
 * Log files are stored in the `logs/` directory with the naming format: `YYYY-MM-DD.log`.
 *
 * Usage:
 *   import { logger } from './logger';
 *   logger.info('Task started');
 *   logger.warn('Retrying without tools...');
 *   logger.error('Connection failed', error);
 */

import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

type LogPayload = string | Error | Record<string, unknown> | undefined;

/**
 * Logger Class
 * Singleton logger with console and file output.
 */
class Logger {
  private logDir: string;
  private level: LogLevel;

  constructor(logDir?: string, level?: LogLevel) {
    this.logDir = logDir || path.join(process.cwd(), 'logs');
    this.level = level ?? (process.env.LOG_LEVEL ? (LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] ?? LogLevel.INFO) : LogLevel.INFO);

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Get the log file path for today
   */
  private getLogFilePath(): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(this.logDir, `${date}.log`);
  }

  /**
   * Format a log entry
   */
  private format(level: string, message: string, payload?: LogPayload): string {
    const timestamp = new Date().toISOString();
    let entry = `[${timestamp}] [${level}] ${message}`;

    if (payload !== undefined) {
      if (payload instanceof Error) {
        entry += `\n${payload.stack || payload.message}`;
      } else if (typeof payload === 'string') {
        entry += ` ${payload}`;
      } else {
        entry += ` ${JSON.stringify(payload)}`;
      }
    }

    return entry;
  }

  /**
   * Write to log file (append mode)
   */
  private writeToFile(formatted: string): void {
    try {
      fs.appendFileSync(this.getLogFilePath(), formatted + '\n');
    } catch {
      // Silently ignore file write errors
    }
  }

  debug(message: string, payload?: LogPayload): void {
    if (this.level > LogLevel.DEBUG) return;
    const formatted = this.format('DEBUG', message, payload);
    console.debug(formatted);
    this.writeToFile(formatted);
  }

  info(message: string, payload?: LogPayload): void {
    if (this.level > LogLevel.INFO) return;
    const formatted = this.format('INFO', message, payload);
    console.log(formatted);
    this.writeToFile(formatted);
  }

  warn(message: string, payload?: LogPayload): void {
    if (this.level > LogLevel.WARN) return;
    const formatted = this.format('WARN', message, payload);
    console.warn(formatted);
    this.writeToFile(formatted);
  }

  error(message: string, payload?: LogPayload): void {
    if (this.level > LogLevel.ERROR) return;
    const formatted = this.format('ERROR', message, payload);
    console.error(formatted);
    this.writeToFile(formatted);
  }
}

/**
 * Global logger instance
 * Import this and use it throughout the application.
 *
 * Configure log level via LOG_LEVEL environment variable:
 *   LOG_LEVEL=DEBUG npm run dev
 */
export const logger = new Logger(undefined, LogLevel.DEBUG);
