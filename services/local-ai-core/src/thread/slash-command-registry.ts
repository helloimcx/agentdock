import { parseSlashCommand } from '../acp/local-core-slash-commands.js';

export type ParsedSlashCommand = {
  name: string;
  args: string[];
};

export type SlashCommandHandler<TContext, TResult> = {
  names: string[];
  usage?: string;
  summary?: string;
  execute(command: ParsedSlashCommand, context: TContext): Promise<TResult> | TResult;
};

export class SlashCommandRegistry<TContext, TResult> {
  private readonly handlers = new Map<string, SlashCommandHandler<TContext, TResult>>();

  register(handler: SlashCommandHandler<TContext, TResult>) {
    for (const name of handler.names) {
      const normalized = String(name || '').trim().toLowerCase();
      if (normalized) {
        this.handlers.set(normalized, handler);
      }
    }
  }

  list() {
    return [...new Set(this.handlers.values())];
  }

  async execute(text: string, context: TContext): Promise<TResult | null> {
    const command = parseSlashCommand(text);
    if (!command) {
      return null;
    }
    const handler = this.handlers.get(command.name);
    if (!handler) {
      return null;
    }
    return handler.execute(command, context);
  }
}
