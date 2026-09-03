import { MessageSquarePlus } from 'lucide-react';

export interface ThreadChatEmptyStateProps {
  selectedProject: string;
  selectedKnowledgeBases: Array<{ id: string; name: string }>;
}

export function ThreadChatEmptyState({ selectedProject, selectedKnowledgeBases }: ThreadChatEmptyStateProps) {
  return (
    <div className="flex h-full min-h-[18rem] items-center justify-center">
      <div className="w-full max-w-2xl rounded-[24px] border border-slate-200 bg-[#fbfbfd] px-5 py-8 text-center dark:border-white/[0.06] dark:bg-white/[0.03] sm:px-8 sm:py-10">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MessageSquarePlus size={22} />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white sm:text-xl">开始一段新的桌面对话</h3>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
          {selectedProject
            ? `当前项目是 ${selectedProject}。直接提问即可创建会话并开始对话。`
            : '先在左侧选择项目，然后直接输入你的问题。'}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {selectedKnowledgeBases.length > 0 ? (
            selectedKnowledgeBases.map((base) => (
              <span
                key={base.id}
                className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary dark:bg-primary/10 dark:text-primary"
              >
                {base.name}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500 dark:bg-white/[0.05] dark:text-slate-400">
              当前未限制知识库范围
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
