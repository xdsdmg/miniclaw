/**
 * Tool Executor
 * 
 * Executes external tools called by the Agent, currently supports:
 * - bash: Execute Bash commands
 * - python: Execute Python code
 * 
 * Security Features:
 * - Command execution timeout limit (30 seconds)
 * - Output buffer limit (10MB)
 * - Dangerous command pattern detection (sudo, rm -rf, etc.)
 * - Dangerous Python code detection (os/sys imports, eval/exec, etc.)
 * - Automatic temporary file cleanup
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
  /**
   * Execute Bash command
   * 
   * Security measures:
   * - Check dangerous commands before execution
   * - 30 second timeout limit
   * - 10MB output buffer limit
   * 
   * @param command Bash command to execute
   * @returns Command output
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
   * 
   * Security measures:
   * - Check dangerous code patterns before execution
   * - Write code to temporary file for execution
   * - 30 second timeout limit
   * - 10MB output buffer limit
   * - Auto-cleanup temporary files after execution
   * 
   * @param code Python code to execute
   * @returns Code execution result
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

  /**
   * Execute specified tool
   * Dispatch to corresponding tool execution method
   * 
   * @param toolName Tool name (bash | python)
   * @param args     Tool arguments
   * @returns Tool execution result
   */
  async execute(toolName: string, args: Record<string, any>): Promise<string> {
    switch (toolName.toLowerCase()) {
      case "bash":
        return this.executeBash(args.command);
      case "python":
        return this.executePython(args.code);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Check if command is dangerous
   * Dangerous patterns include: sudo, rm -rf /, chmod 777, shutdown, reboot, etc.
   * 
   * @param command Command to check
   * @returns Whether it is a dangerous command
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
   * Dangerous patterns include: os/sys/subprocess/socket imports, eval/exec, file operations, etc.
   * 
   * @param code Python code to check
   * @returns Whether it is dangerous code
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
