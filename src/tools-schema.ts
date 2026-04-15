/**
 * Tools Schema - Tool Definitions
 *
 * Defines the collection of tools available for the Agent to call,
 * described in JSON Schema format compatible with OpenAI function calling.
 *
 * Tools are organized into 4 categories:
 *   - File operations: file_read, file_write, file_edit
 *   - Search:         glob, grep
 *   - Execution:      bash, python
 *   - Web:            web_search, web_fetch
 */

export const tools = [
  // ── File Operations ──────────────────────────────────────────────

  {
    type: "function" as const,
    function: {
      name: "file_read",
      description:
        "Read file contents. Returns text with line numbers. Use offset and limit for large files.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file",
          },
          offset: {
            type: "number",
            description: "Line number to start reading from (1-based, default: 1)",
          },
          limit: {
            type: "number",
            description: "Maximum number of lines to read",
          },
        },
        required: ["file_path"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "file_write",
      description:
        "Write content to a file. Creates the file (and parent directories) if they don't exist, overwrites if they do.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file",
          },
          content: {
            type: "string",
            description: "Content to write",
          },
        },
        required: ["file_path", "content"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "file_edit",
      description:
        "Edit a file by replacing an exact string match with new text. The old_string must exist and be unique in the file.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file",
          },
          old_string: {
            type: "string",
            description: "Exact text to find and replace",
          },
          new_string: {
            type: "string",
            description: "Replacement text (must differ from old_string)",
          },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
  },

  // ── Search ───────────────────────────────────────────────────────

  {
    type: "function" as const,
    function: {
      name: "glob",
      description:
        "Find files matching a glob pattern. Returns matching file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "Glob pattern (e.g. '**/*.ts', 'src/**/*.py', '*.json')",
          },
          path: {
            type: "string",
            description: "Directory to search in (default: current directory)",
          },
        },
        required: ["pattern"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "grep",
      description:
        "Search file contents using a regex pattern. Returns matching lines with file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for",
          },
          path: {
            type: "string",
            description: "File or directory to search in (default: current directory)",
          },
          include: {
            type: "string",
            description: "File glob filter (e.g. '*.ts', '*.py')",
          },
        },
        required: ["pattern"],
      },
    },
  },

  // ── Execution ────────────────────────────────────────────────────

  {
    type: "function" as const,
    function: {
      name: "bash",
      description:
        "Execute a bash command. Use for system operations, git commands, running scripts, installing packages, etc. Prefer file_read/file_write/file_edit for file operations.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to execute",
          },
        },
        required: ["command"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "python",
      description:
        "Execute Python code. Use for calculations, data processing, JSON manipulation, string formatting, etc.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The Python code to execute",
          },
        },
        required: ["code"],
      },
    },
  },

  // ── Web ──────────────────────────────────────────────────────────

  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the web for current information. Use when you need up-to-date data or information beyond your knowledge cutoff.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
      },
    },
  },

  {
    type: "function" as const,
    function: {
      name: "web_fetch",
      description:
        "Fetch a URL and return its text content. Useful for reading web pages, APIs, or documentation.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch",
          },
        },
        required: ["url"],
      },
    },
  },
];
