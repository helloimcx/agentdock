import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  toolEditFile,
  toolExecuteCommand,
  toolGlobFiles,
  toolListDirectory,
  toolReadFile,
  toolWriteFile,
} from './remote-mesh-mcp-server.js';

type MeshArgs = Record<string, unknown>;
type MeshToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
}) as never;

export default function registerMeshTools(pi: ExtensionAPI) {
  registerTool(pi, {
    name: 'mesh_read_file',
    label: 'Mesh Read',
    description: 'Read a UTF-8 file from the paired Mesh node. Relative paths start at its approved root; this never reads the AgentDock host workspace.',
    parameters: objectSchema({ path: { type: 'string', description: 'Relative path on the paired node' } }, ['path']),
    execute: toolReadFile,
  });
  registerTool(pi, {
    name: 'mesh_write_file',
    label: 'Mesh Write',
    description: 'Write a UTF-8 file on the paired Mesh node. Relative paths start at its approved root.',
    parameters: objectSchema({
      path: { type: 'string', description: 'Relative path on the paired node' },
      content: { type: 'string', description: 'Text content to write' },
    }, ['path', 'content']),
    execute: toolWriteFile,
  });
  registerTool(pi, {
    name: 'mesh_edit_file',
    label: 'Mesh Edit',
    description: 'Replace one unique text match in a UTF-8 file on the paired Mesh node.',
    parameters: objectSchema({
      path: { type: 'string', description: 'Relative path on the paired node' },
      old_text: { type: 'string', description: 'Exact text that must occur exactly once' },
      new_text: { type: 'string', description: 'Replacement text' },
    }, ['path', 'old_text', 'new_text']),
    execute: toolEditFile,
  });
  registerTool(pi, {
    name: 'mesh_list_directory',
    label: 'Mesh List',
    description: 'List a directory on the paired Mesh node. Paths are relative to its approved root.',
    parameters: objectSchema({ path: { type: 'string', description: 'Relative directory path' } }, ['path']),
    execute: toolListDirectory,
  });
  registerTool(pi, {
    name: 'mesh_glob_files',
    label: 'Mesh Glob',
    description: 'Find files on the paired Mesh node using a relative glob pattern. Search is bounded.',
    parameters: objectSchema({ pattern: { type: 'string', description: 'Relative pattern such as **/*.ts' } }, ['pattern']),
    execute: toolGlobFiles,
  });
  registerTool(pi, {
    name: 'mesh_execute_command',
    label: 'Mesh Terminal',
    description: 'Run a terminal command on the paired Mesh node with its approved root as working directory.',
    parameters: objectSchema({ command: { type: 'string', description: 'Command to run on the paired node' } }, ['command']),
    execute: toolExecuteCommand,
  });
}

function registerTool(
  pi: ExtensionAPI,
  definition: {
    name: string;
    label: string;
    description: string;
    parameters: never;
    execute: (args: MeshArgs) => Promise<MeshToolResult>;
  },
) {
  pi.registerTool({
    ...definition,
    async execute(_toolCallId: string, args: unknown) {
      try {
        return await definition.execute(args as MeshArgs);
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  } as never);
}
