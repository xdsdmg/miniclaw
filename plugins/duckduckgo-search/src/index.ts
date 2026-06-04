/**
 * DuckDuckGo Search Plugin
 *
 * Provides web search functionality for miniclaw by bridging to the Python
 * duckduckgo-search library via child_process.
 *
 * Architecture:
 *   TypeScript (this file)  --child_process-->  Python (search.py)
 *                                                    -> DDGS().text()
 *                                                    <- JSON stdout
 *   <- parsed results
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

// ============================================================================
// Types
// ============================================================================

/**
 * A single search result from DuckDuckGo
 */
export interface SearchResult {
  /** Page title */
  title: string;
  /** Page URL */
  href: string;
  /** Snippet / body text */
  body: string;
}

/**
 * Search provider configuration
 */
export interface SearchConfig {
  /** Path to the Python search script (default: auto-resolved) */
  scriptPath?: string;
  /** Path to the Python interpreter (default: .venv/bin/python3) */
  pythonBin?: string;
  /** Max number of results (default: 5) */
  maxResults?: number;
  /** Execution timeout in milliseconds (default: 15000) */
  timeout?: number;
}

// ============================================================================
// DuckDuckGoSearchProvider
// ============================================================================

/**
 * DuckDuckGo Search Provider
 *
 * Wraps the Python duckduckgo-search library via child_process,
 * providing a clean TypeScript interface for web search.
 */
export class DuckDuckGoSearchProvider {
  private scriptPath: string;
  private pythonBin: string;
  private maxResults: number;
  private timeout: number;

  constructor(config?: SearchConfig) {
    // Resolve Python script path relative to this file
    this.scriptPath = config?.scriptPath ||
      path.resolve(__dirname, '..', 'search.py');

    // Prefer virtual environment Python if available
    this.pythonBin = config?.pythonBin ||
      path.resolve(__dirname, '..', '.venv', 'bin', 'python3');

    this.maxResults = config?.maxResults || 5;
    this.timeout = config?.timeout || 60000;
  }

  /**
   * Execute a web search query
   *
   * @param query     Search query string
   * @param maxResults Override max results for this query
   * @returns Array of search results
   */
  async search(query: string, maxResults?: number): Promise<SearchResult[]> {
    const limit = maxResults || this.maxResults;

    try {
      const { stdout } = await execFileAsync(this.pythonBin, [
        this.scriptPath,
        '--query', JSON.stringify(query),
        '--max-results', String(limit),
      ], {
        timeout: this.timeout,
        maxBuffer: 1024 * 1024, // 1MB
      });

      const results: SearchResult[] = JSON.parse(stdout);
      return results;
    } catch (error: any) {
      // Re-throw with descriptive message for upstream handling
      if (error.code === 'ENOENT') {
        throw new Error('python3 not found. Python 3 is required for web search.');
      }
      if (error.killed || error.code === 'ETIMEDOUT') {
        throw new Error(`Search timed out after ${this.timeout}ms`);
      }
      // Forward Python stderr if available
      const stderr = error.stderr?.toString().trim();
      if (stderr) {
        throw new Error(stderr);
      }
      throw new Error(`Search failed: ${error.message}`);
    }
  }
}

// ============================================================================
// Result Formatting
// ============================================================================

/** Max characters per result body snippet */
const MAX_BODY_LENGTH = 200;

/**
 * Format search results into an LLM-friendly numbered list
 *
 * @param results  Array of search results
 * @returns Formatted string with numbered results
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (!results || results.length === 0) {
    return 'No results found.';
  }

  const lines = results.map((r, i) => {
    const body = r.body.length > MAX_BODY_LENGTH
      ? r.body.slice(0, MAX_BODY_LENGTH) + '...'
      : r.body;
    return `${i + 1}. ${r.title}\n   ${r.href}\n   ${body}`;
  });

  return lines.join('\n\n');
}
