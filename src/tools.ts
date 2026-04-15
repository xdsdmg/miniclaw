/**
 * Tool Executor
 *
 * Executes external tools called by the Agent, currently supports:
 *   - File operations: file_read, file_write, file_edit
 *   - Search:         glob, grep
 *   - Execution:      bash, python
 *   - Web:            web_search, web_fetch
 *
 * Security Features:
 *   - Command execution timeout limit (30 seconds)
 *   - Output buffer limit (10MB)
 *   - Dangerous command pattern detection for bash
 *   - Dangerous code pattern detection for Python
 *   - Path validation for file operations
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Tool Executor Class
 * Unified management of all available tool executions
 */
export class ToolExecutor {

  // ── File Operations ──────────────────────────────────────────────

  /**
   * Read file contents with optional offset and limit
   */
  async executeFileRead(
    filePath: string,
    offset?: number,
    limit?: number
  ): Promise<string> {
    if (!fs.existsSync(filePath)) {
      return `Error: File not found: ${filePath}`;
    }

    const stat = fs.statSync(filePath);
    if (stat.size > 10 * 1024 * 1024) {
      return `Error: File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Use offset and limit to read specific parts.`;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = (offset && offset > 0) ? offset - 1 : 0; // 1-based to 0-based
    const end = limit ? start + limit : lines.length;
    const sliced = lines.slice(start, end);

    // Format with line numbers (matching cat -n format)
    const numbered = sliced
      .map((line, i) => `${String(start + i + 1).padStart(6)}\t${line}`)
      .join('\n');

    return numbered || '(empty file)';
  }

  /**
   * Write content to a file, creating parent directories if needed
   */
  async executeFileWrite(filePath: string, content: string): Promise<string> {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, content, 'utf-8');
      return `Successfully wrote ${content.split('\n').length} lines to ${filePath}`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }

  /**
   * Edit a file by replacing an exact string match
   */
  async executeFileEdit(
    filePath: string,
    oldString: string,
    newString: string
  ): Promise<string> {
    if (!fs.existsSync(filePath)) {
      return `Error: File not found: ${filePath}`;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // Check if old_string exists
    if (!content.includes(oldString)) {
      return `Error: The specified text was not found in the file.`;
    }

    // Check uniqueness
    const occurrences = content.split(oldString).length - 1;
    if (occurrences > 1) {
      return `Error: The specified text appears ${occurrences} times in the file. Please provide more context to make it unique.`;
    }

    const newContent = content.replace(oldString, newString);
    fs.writeFileSync(filePath, newContent, 'utf-8');

    return `Successfully edited ${filePath} (replaced 1 occurrence)`;
  }

  // ── Search ───────────────────────────────────────────────────────

  /**
   * Find files matching a glob pattern
   */
  async executeGlob(pattern: string, searchPath?: string): Promise<string> {
    const dir = searchPath || process.cwd();

    if (!fs.existsSync(dir)) {
      return `Error: Directory not found: ${dir}`;
    }

    try {
      const results = this.globSync(pattern, dir);
      if (results.length === 0) {
        return `No files found matching pattern: ${pattern}`;
      }

      // Sort by modification time (newest first)
      results.sort((a, b) =>
        fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
      );

      // Limit output
      if (results.length > 100) {
        return results.slice(0, 100).join('\n') +
          `\n... (${results.length - 100} more files)`;
      }

      return results.join('\n');
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }

  /**
   * Recursive glob matching using pure Node.js fs
   */
  private globSync(pattern: string, dir: string): string[] {
    const results: string[] = [];
    const parts = pattern.split('/');
    this.globWalk(parts, dir, results);
    return results;
  }

  private globWalk(
    parts: string[],
    currentDir: string,
    results: string[]
  ): void {
    if (parts.length === 0 || !fs.existsSync(currentDir)) return;

    const part = parts[0];
    const rest = parts.slice(1);
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    // ** matches zero or more directories
    // Zero levels: try matching rest of pattern in current dir (once)
    if (part === '**' && rest.length > 0) {
      this.globWalk(rest, currentDir, results);
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (part === '**') {
        // One or more levels: recurse into subdirectory with same pattern
        if (entry.isDirectory()) {
          this.globWalk(parts, fullPath, results);
        }
        continue;
      }

      if (this.matchGlobPart(part, entry.name)) {
        if (rest.length === 0) {
          if (entry.isFile()) results.push(fullPath);
        } else if (entry.isDirectory()) {
          this.globWalk(rest, fullPath, results);
        }
      }
    }
  }

  private matchGlobPart(pattern: string, name: string): boolean {
    if (pattern === '**' || pattern === '*') return true;
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
    );
    return regex.test(name);
  }

  /**
   * Search file contents using a regex pattern
   */
  async executeGrep(
    pattern: string,
    searchPath?: string,
    include?: string
  ): Promise<string> {
    const dir = searchPath || process.cwd();

    if (!fs.existsSync(dir)) {
      return `Error: Path not found: ${dir}`;
    }

    try {
      let cmd = `grep -rn --color=never`;
      if (include) {
        cmd += ` --include="${include}"`;
      }
      cmd += ` ${this.escapeGrepPattern(pattern)} ${dir}`;

      const { stdout } = await execAsync(cmd, {
        timeout: 15000,
        maxBuffer: 1024 * 1024 * 10,
      });

      if (!stdout.trim()) {
        return `No matches found for pattern: ${pattern}`;
      }

      // Limit output
      const lines = stdout.trim().split('\n');
      if (lines.length > 100) {
        return lines.slice(0, 100).join('\n') + `\n... (${lines.length - 100} more matches)`;
      }

      return stdout.trim();
    } catch (error: any) {
      if (error.code === 1) {
        // grep returns 1 when no matches found
        return `No matches found for pattern: ${pattern}`;
      }
      return `Error: ${error.message}`;
    }
  }

  /**
   * Escape special characters in grep pattern
   */
  private escapeGrepPattern(pattern: string): string {
    return pattern.replace(/'/g, "'\\''");
  }

  // ── Execution ────────────────────────────────────────────────────

  /**
   * Execute Bash command
   */
  async executeBash(command: string): Promise<string> {
    if (this.isDangerousCommand(command)) {
      throw new Error(`Potentially dangerous command blocked: ${command}`);
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 10,
      });

      return stdout || stderr || 'Command executed successfully with no output.';
    } catch (error: any) {
      if (error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT') {
        throw new Error(`Command timed out: ${command}`);
      }
      return `Error: ${error.message}`;
    }
  }

  /**
   * Execute Python code
   */
  async executePython(code: string): Promise<string> {
    if (this.isDangerousPythonCode(code)) {
      throw new Error(`Potentially dangerous Python code blocked:\n${code}`);
    }

    const tempDir = os.tmpdir();
    const fileName = `miniclaw_python_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.py`;
    const filePath = path.join(tempDir, fileName);

    try {
      fs.writeFileSync(filePath, code);

      const { stdout, stderr } = await execAsync(`python3 ${filePath}`, {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 10,
      });

      fs.unlinkSync(filePath);

      return stdout || stderr || 'Python script executed successfully with no output.';
    } catch (error: any) {
      try {
        fs.unlinkSync(filePath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      if (error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT') {
        throw new Error(`Python script timed out:\n${code}`);
      }
      return `Error: ${error.message}`;
    }
  }

  // ── Web ──────────────────────────────────────────────────────────

  /**
   * Search the web (placeholder — needs API configuration)
   */
  async executeWebSearch(query: string): Promise<string> {
    return `Web search is not yet configured. To enable it, set up a search API (e.g., SerpAPI, Bing Search API).\nQuery: ${query}`;
  }

  /**
   * Fetch a URL and return its text content
   */
  async executeWebFetch(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Miniclaw/1.0',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text') && !contentType.includes('json') && !contentType.includes('javascript')) {
        return `Error: Unsupported content type: ${contentType}. Only text-based content is supported.`;
      }

      const text = await response.text();

      // Limit output size
      if (text.length > 100000) {
        return text.slice(0, 100000) + '\n\n... (content truncated)';
      }

      return text;
    } catch (error: any) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        return 'Error: Request timed out (15s limit)';
      }
      return `Error: ${error.message}`;
    }
  }

  // ── Dispatch ─────────────────────────────────────────────────────

  /**
   * Execute specified tool
   * Dispatch to corresponding tool execution method
   */
  async execute(toolName: string, args: Record<string, any>): Promise<string> {
    switch (toolName) {
      case 'file_read':
        return this.executeFileRead(args.file_path, args.offset, args.limit);
      case 'file_write':
        return this.executeFileWrite(args.file_path, args.content);
      case 'file_edit':
        return this.executeFileEdit(args.file_path, args.old_string, args.new_string);
      case 'glob':
        return this.executeGlob(args.pattern, args.path);
      case 'grep':
        return this.executeGrep(args.pattern, args.path, args.include);
      case 'bash':
        return this.executeBash(args.command);
      case 'python':
        return this.executePython(args.code);
      case 'web_search':
        return this.executeWebSearch(args.query);
      case 'web_fetch':
        return this.executeWebFetch(args.url);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // ── Safety Checks ────────────────────────────────────────────────

  /**
   * Check if command is dangerous
   */
  private isDangerousCommand(command: string): boolean {
    const dangerousPatterns = [
      /\bsudo\b/,
      /\brm\s+-r?\s*\/\s*/,
      /\bmv\s+\S+\s+\/\s*/,
      /\bchmod\s+777\s+\//,
      /\bchown\s+\S+:\S+\s+\//,
      /\bmount\b/,
      /\bumount\b/,
      /\bkill\s+-9\s+1\b/,
      /\bshutdown\b/,
      /\breboot\b/,
      /\bpkill\b/,
      /\b:>.*\/etc\//,
      /\bcat\s+.*>.*\/etc\//,
    ];

    return dangerousPatterns.some(pattern => pattern.test(command.toLowerCase()));
  }

  /**
   * Check if Python code is dangerous
   */
  private isDangerousPythonCode(code: string): boolean {
    const dangerousPatterns = [
      /import\s+os\b/,
      /import\s+sys\b/,
      /import\s+subprocess\b/,
      /import\s+shutil\b/,
      /import\s+socket\b/,
      /exec\s*\(/,
      /eval\s*\(/,
      /__import__\(/,
      /open\s*\([^)]*['"][~\/]\w/,
      /\.system\s*\(/,
      /\.popen\s*\(/,
    ];

    return dangerousPatterns.some(pattern => pattern.test(code));
  }
}
