/**
 * Tools Schema - Tool Definitions
 * 
 * Defines the collection of tools available for the Agent to call, described in JSON Schema format.
 * These definitions are sent to the LLM so it knows which tools are available and how to call them.
 * 
 * Currently Available Tools:
 *   bash    - Execute Bash commands
 *   python  - Execute Python code
 */

export const tools = [
  {
    type: "function" as const,
    function: {
      name: "bash",
      description: "Execute a bash command. Use for file operations, git commands, running scripts, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The bash command to execute" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "python",
      description: "Execute Python code. Use for data processing, calculations, etc.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "The Python code to execute" }
        },
        required: ["code"]
      }
    }
  }
];
