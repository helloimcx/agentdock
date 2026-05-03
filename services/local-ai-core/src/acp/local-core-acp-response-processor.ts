import type { ScheduledJob, ScheduledJobRoute } from '../../../../packages/contracts/src/index.js';
import { detectCronCommands, stripCronCommands, type CronCommand } from '../scheduler/cron-command-detector.js';
import { toPublicScheduledJobId } from '../scheduler/job-id.js';

type SchedulerHandlers = {
  createJob: (input: {
    workspaceId: string;
    platform: string;
    route: ScheduledJobRoute;
    name: string;
    schedule: string;
    scheduleDescription: string;
    message: string;
  }) => Promise<ScheduledJob>;
  listJobsForThread: (threadId: string) => Promise<ScheduledJob[]>;
  deleteJob: (jobId: string) => Promise<void>;
};

type ResponseProcessorOptions = {
  getScheduledDeliveryBinding: (threadId: string) => {
    workspaceId: string;
    platform: string;
    route: ScheduledJobRoute;
  } | null;
  scheduler: SchedulerHandlers;
};

export class LocalCoreAcpResponseProcessor {
  constructor(private readonly options: ResponseProcessorOptions) {}

  deriveSlashCommandReply(content: string, result: Record<string, unknown>) {
    const normalized = String(content || '').trim();
    const [commandName = ''] = normalized.split(/\s+/, 1);
    const direct = [
      result.result,
      result.message,
      result.summary,
      result.output,
    ];
    for (const candidate of direct) {
      const text = this.normalizeSlashCommandResult(candidate);
      if (text) {
        return text;
      }
    }
    if (commandName === '/mode') {
      return '模式命令已执行，但当前 ACP 运行时没有返回可显示的模式菜单。请直接使用 `/mode <name>`。';
    }
    return `命令已执行：${commandName}`;
  }

  async processAssistantResponse(threadId: string, content: string) {
    const commands = detectCronCommands(content);
    if (commands.length === 0) {
      return {
        displayContent: content,
        systemResponses: [] as string[],
      };
    }
    const systemResponses: string[] = [];
    for (const command of commands) {
      const response = await this.handleCronCommand(threadId, command);
      if (response) {
        systemResponses.push(response);
      }
    }
    return {
      displayContent: stripCronCommands(content),
      systemResponses,
    };
  }

  private normalizeSlashCommandResult(value: unknown) {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (!value || typeof value !== 'object') {
      return '';
    }
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'content', 'message', 'summary', 'result']) {
      if (typeof record[key] === 'string' && String(record[key]).trim()) {
        return String(record[key]).trim();
      }
    }
    return '';
  }

  private async handleCronCommand(threadId: string, command: CronCommand) {
    try {
      switch (command.kind) {
        case 'create': {
          const binding = this.options.getScheduledDeliveryBinding(threadId);
          if (!binding) {
            return '定时任务创建失败：当前对话没有绑定可调度的平台会话。请先在平台对话线程中使用，或先建立平台绑定。';
          }
          const job = await this.options.scheduler.createJob({
            workspaceId: binding.workspaceId,
            platform: binding.platform,
            route: {
              ...binding.route,
              threadId,
            },
            name: command.name,
            schedule: command.schedule,
            scheduleDescription: command.scheduleDescription,
            message: command.message,
          });
          return `已创建定时任务：${job.description || command.name}，计划 ${command.scheduleDescription}（${command.schedule}），ID: ${toPublicScheduledJobId(job.id)}`;
        }
        case 'list': {
          const jobs = await this.options.scheduler.listJobsForThread(threadId);
          if (jobs.length === 0) {
            return '当前对话没有定时任务。';
          }
          return [
            '当前对话定时任务：',
            ...jobs.map((job) => `- ${job.description || toPublicScheduledJobId(job.id)} | ${job.triggerType === 'cron' ? job.cronExpr : job.runAt} | ${job.enabled ? 'enabled' : 'disabled'} | ${toPublicScheduledJobId(job.id)}`),
          ].join('\n');
        }
        case 'delete': {
          await this.options.scheduler.deleteJob(command.jobId);
          return `已删除定时任务：${command.jobId}`;
        }
        default:
          return '';
      }
    } catch (error) {
      return `定时任务操作失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
