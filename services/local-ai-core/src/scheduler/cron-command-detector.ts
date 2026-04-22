export type CronCommand =
  | { kind: 'create'; name: string; schedule: string; scheduleDescription: string; message: string }
  | { kind: 'list' }
  | { kind: 'delete'; jobId: string };

function stripCodeBlocks(content: string) {
  return content.replace(/```[\s\S]*?```/g, '');
}

export function detectCronCommands(content: string): CronCommand[] {
  if (!content || typeof content !== 'string') {
    return [];
  }
  const cleanContent = stripCodeBlocks(content);
  const commands: CronCommand[] = [];
  const createMatches = cleanContent.matchAll(/\[CRON_CREATE\]\s*\n?([\s\S]*?)\[\/CRON_CREATE\]/gi);
  for (const match of createMatches) {
    const parsed = parseCronCreateBody(match[1] || '');
    if (parsed) {
      commands.push({ kind: 'create', ...parsed });
    }
  }
  if (!commands.some((command) => command.kind === 'create')) {
    const fallbackMatch = cleanContent.match(/\[CRON_CREATE\]\s*\n?([\s\S]*?)(?=\[CRON_(?:LIST|DELETE)|$)/i);
    if (fallbackMatch) {
      const parsed = parseCronCreateBody(fallbackMatch[1] || '');
      if (parsed) {
        commands.push({ kind: 'create', ...parsed });
      }
    }
  }
  if (/\[CRON_LIST\]/i.test(cleanContent)) {
    commands.push({ kind: 'list' });
  }
  const deleteMatches = cleanContent.matchAll(/\[CRON_DELETE:\s*([^\]]+)\]/gi);
  for (const match of deleteMatches) {
    const jobId = String(match[1] || '').trim();
    if (jobId) {
      commands.push({ kind: 'delete', jobId });
    }
  }
  return commands;
}

export function stripCronCommands(content: string) {
  if (!content || typeof content !== 'string') {
    return content;
  }
  return content
    .replace(/\[CRON_CREATE\][\s\S]*?\[\/CRON_CREATE\]/gi, '')
    .replace(/\[CRON_LIST\]/gi, '')
    .replace(/\[CRON_DELETE:[^\]]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseCronCreateBody(body: string) {
  if (!body) {
    return null;
  }
  const name = body.match(/^name:\s*(.+)$/im)?.[1]?.trim();
  const schedule = body.match(/^schedule:\s*(.+)$/im)?.[1]?.trim();
  const scheduleDescription = body.match(/^schedule_description:\s*(.+)$/im)?.[1]?.trim();
  const message = body.match(/message:\s*([\s\S]*?)(?=\n(?:name|schedule|schedule_description):|$)/i)?.[1]?.trim();
  if (!name || !schedule || !scheduleDescription || !message) {
    return null;
  }
  return {
    name,
    schedule,
    scheduleDescription,
    message: message.replace(/\[\/CRON_CREATE\]/gi, '').trim(),
  };
}
