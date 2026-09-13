import { useState } from 'react';
import {
  BookOpen,
  FolderGit2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { cn } from '@/lib/utils';
import type {
  MemoryCategory,
  MemoryPage,
  MemoryPageWriteInput,
} from '@cc/superai-contracts/memory';
import { MEMORY_CATEGORIES } from '@cc/superai-contracts/memory';
import { useWorkspaceMemory } from './useWorkspaceMemory';

const CATEGORY_LABELS: Record<MemoryCategory, { label: string; desc: string }> = {
  _rules: { label: '规范与约束 (_rules)', desc: '项目不变规则与开发约定' },
  decisions: { label: '技术决策 (decisions)', desc: 'ADR 架构决策与选型取舍' },
  procedures: { label: '操作规程 (procedures)', desc: '部署、测试与运维步骤' },
  gotchas: { label: '排坑记录 (gotchas)', desc: '隐蔽缺陷与解决方案' },
};

export function WorkspaceMemorySection({ workspaceId }: { workspaceId: string }) {
  const mem = useWorkspaceMemory(workspaceId);

  const displayedPages = mem.searchResults !== null
    ? mem.searchResults.map((r) => r.page)
    : mem.selectedCategory === 'all'
      ? mem.pages
      : mem.pages.filter((p) => p.category === mem.selectedCategory);

  return (
    <div className="space-y-4" data-testid="workspace-memory-section">
      <MemorySectionHeader
        syncing={mem.syncing}
        onSync={mem.handleSync}
        onCreate={() => { mem.setIsCreating(true); mem.setIsEditing(false); }}
      />
      {mem.notice ? (
        <div className={cn('flex items-center justify-between rounded-lg px-3.5 py-2.5 text-xs', mem.notice.tone === 'success' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300')}>
          <span>{mem.notice.message}</span>
          <button type="button" onClick={() => mem.setNotice(null)} className="ml-2 font-semibold">✕</button>
        </div>
      ) : null}
      <MemoryFilterBar
        pages={mem.pages}
        selectedCategory={mem.selectedCategory}
        searchQuery={mem.searchQuery}
        onSelectCategory={(c) => { mem.setSelectedCategory(c); mem.setSearchResults(null); }}
        onSearch={mem.handleSearch}
      />
      {mem.isCreating || mem.isEditing ? (
        <MemoryEditorPane
          initialData={mem.isEditing ? mem.selectedPage : null}
          onSave={mem.handleSave}
          onCancel={() => { mem.setIsCreating(false); mem.setIsEditing(false); }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <MemoryPageListView
            pages={displayedPages}
            selectedPage={mem.selectedPage}
            searchQuery={mem.searchQuery}
            onSelectPage={mem.setSelectedPage}
          />
          <MemoryPageDetailView
            page={mem.selectedPage}
            onEdit={() => { mem.setIsEditing(true); mem.setIsCreating(false); }}
            onDelete={mem.handleDelete}
          />
        </div>
      )}
    </div>
  );
}

function MemorySectionHeader({ syncing, onSync, onCreate }: { syncing: boolean; onSync: () => void; onCreate: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-white/10">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
          <BookOpen size={18} className="text-primary" />
          项目工作记忆 (Workspace Memory)
        </h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          持久化保存于 <code>.agentdock/memory/</code>，供跨 Agent 全文检索与决策对齐。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onSync} loading={syncing} data-testid="sync-memory-btn" className="flex items-center gap-1.5">
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          磁盘双向同步
        </Button>
        <Button size="sm" onClick={onCreate} data-testid="create-memory-btn" className="flex items-center gap-1.5 bg-primary text-slate-950 hover:bg-primary/90">
          <Plus size={14} />
          新建记忆
        </Button>
      </div>
    </div>
  );
}

function MemoryFilterBar({
  pages,
  selectedCategory,
  searchQuery,
  onSelectCategory,
  onSearch,
}: {
  pages: MemoryPage[];
  selectedCategory: string;
  searchQuery: string;
  onSelectCategory: (c: string) => void;
  onSearch: (q: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-white/[0.06]">
        <button
          type="button"
          onClick={() => onSelectCategory('all')}
          className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition', selectedCategory === 'all' ? 'bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200')}
        >
          全部 ({pages.length})
        </button>
        {MEMORY_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => onSelectCategory(cat)}
            className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition', selectedCategory === cat ? 'bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200')}
          >
            {cat} ({pages.filter((p) => p.category === cat).length})
          </button>
        ))}
      </div>
      <div className="relative min-w-[220px] flex-1">
        <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
        <Input value={searchQuery} onChange={(e) => onSearch(e.target.value)} placeholder="全文检索记忆与标签 (FTS5)..." className="pl-8 text-xs" />
      </div>
    </div>
  );
}

function MemoryPageListView({
  pages,
  selectedPage,
  searchQuery,
  onSelectPage,
}: {
  pages: MemoryPage[];
  selectedPage: MemoryPage | null;
  searchQuery: string;
  onSelectPage: (p: MemoryPage) => void;
}) {
  return (
    <div className="lg:col-span-5 space-y-2 max-h-[600px] overflow-y-auto pr-1">
      {pages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500 dark:border-white/10">
          {searchQuery ? `未找到匹配 "${searchQuery}" 的记忆` : '当前分类下暂无记忆页面，点击上方按钮新建。'}
        </div>
      ) : (
        pages.map((p) => (
          <div
            key={`${p.category}/${p.slug}`}
            onClick={() => onSelectPage(p)}
            className={cn('cursor-pointer rounded-xl border p-3 text-left transition', selectedPage?.slug === p.slug && selectedPage?.category === p.category ? 'border-primary/50 bg-primary/5 shadow-sm dark:bg-primary/[0.04]' : 'border-slate-200 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.02]')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-white/10 dark:text-slate-300">{p.category}</span>
              <span className="font-mono text-[10px] text-slate-400">{p.slug}.md</span>
            </div>
            <h4 className="mt-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{p.title}</h4>
            {p.summary ? <p className="mt-1 text-[11px] text-slate-500 line-clamp-2 dark:text-slate-400">{p.summary}</p> : null}
            {p.tags && p.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {p.tags.map((tag) => <span key={tag} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">#{tag}</span>)}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

function MemoryPageDetailView({
  page,
  onEdit,
  onDelete,
}: {
  page: MemoryPage | null;
  onEdit: () => void;
  onDelete: (p: MemoryPage) => void;
}) {
  return (
    <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
      {page ? (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-white/5">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">{page.category}</span>
                <span className="font-mono text-xs text-slate-500">{page.relativePath}</span>
              </div>
              <h2 className="mt-2 text-base font-bold text-slate-900 dark:text-slate-100">{page.title}</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={onEdit}>编辑</Button>
              <Button size="sm" variant="danger" onClick={() => onDelete(page)} className="p-2"><Trash2 size={14} /></Button>
            </div>
          </div>
          {page.summary ? (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-white/[0.03] dark:text-slate-300">
              <span className="font-semibold">摘要：</span>{page.summary}
            </div>
          ) : null}
          {page.tags && page.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {page.tags.map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-white/10 dark:text-slate-300">#{t}</span>)}
            </div>
          ) : null}
          <div className="border-t border-slate-100 pt-3 dark:border-white/5 max-h-[450px] overflow-y-auto">
            <ChatMarkdown content={page.content} isUser={false} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500">
          <FolderGit2 size={36} className="text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-medium">请从左侧选择一篇记忆页面进行预览</p>
          <p className="mt-1 text-xs text-slate-400">
            支持 <code>_rules</code>、<code>decisions</code>、<code>procedures</code>、<code>gotchas</code> 四大分类。
          </p>
        </div>
      )}
    </div>
  );
}

function MemoryEditorPane({
  initialData,
  onSave,
  onCancel,
}: {
  initialData: MemoryPage | null;
  onSave: (input: MemoryPageWriteInput) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<MemoryCategory>(initialData?.category || 'decisions');
  const [slug, setSlug] = useState(initialData?.slug || '');
  const [title, setTitle] = useState(initialData?.title || '');
  const [summary, setSummary] = useState(initialData?.summary || '');
  const [tags, setTags] = useState((initialData?.tags || []).join(', '));
  const [content, setContent] = useState(initialData?.content || '');

  const submit = () => {
    const parsedTags = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    onSave({
      category,
      slug: slug.trim(),
      title: title.trim() || slug.trim(),
      summary: summary.trim() || undefined,
      tags: parsedTags,
      content,
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#111214] space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {initialData ? '编辑记忆页面' : '新建工作记忆页面'}
        </h4>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel}>取消</Button>
          <Button size="sm" onClick={submit} className="bg-primary text-slate-950 hover:bg-primary/90">保存记忆</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">记忆分类</label>
          <Select value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory)} disabled={Boolean(initialData)} className="w-full text-xs">
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]?.label || c}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">文件标识 Slug</label>
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} disabled={Boolean(initialData)} placeholder="例如: sqlite-fts5-binding" className="text-xs font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">标题 Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如: SQLite FTS5 绑定方案" className="text-xs" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">标签 Tags (逗号分隔)</label>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例如: sqlite, fts5, search" className="text-xs" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">摘要描述 Description (可选)</label>
        <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="简述该记忆的核心要点或决策背景" className="text-xs" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Markdown 正文</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={10} placeholder="# 记忆正文 (支持标准 Markdown 语法)..." className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 focus:border-primary focus:outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100" />
      </div>
    </div>
  );
}
