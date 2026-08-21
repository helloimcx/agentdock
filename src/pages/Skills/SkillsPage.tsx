import { useState, useEffect } from 'react';
import {
  Sparkles,
  Search,
  Plus,
  FileCode,
  Pencil,
  Trash2,
  Code2,
  FolderGit2,
  RefreshCw,
  AlertTriangle,
  Compass,
  Layers,
  Download,
  ExternalLink,
  CheckCircle2,
  GitBranch,
} from 'lucide-react';
import { Button, Card, EmptyState, Input, Modal, Textarea, PageHeader } from '@/components/ui';
import { skills as skillsApi } from '@cc/core-sdk';
import type { SkillInfo, SkillDetail, SkillScope, CuratedSkillPack, SkillSource } from '@cc/superai-contracts/skills';
import { cn } from '@/lib/utils';
import { useSkillsPageController, type NoticeState } from './useSkillsPageController';

export default function SkillsPage() {
  const ctrl = useSkillsPageController();

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <SkillsPageHeader
        skillsCount={ctrl.skills.length}
        activeTab={ctrl.activeTab}
        setActiveTab={ctrl.setActiveTab}
        loading={ctrl.loading}
        verifying={ctrl.verifying}
        onRefresh={ctrl.fetchSkills}
        onVerify={ctrl.handleVerifySkills}
        onOpenInstall={() => ctrl.setShowInstallModal(true)}
        onOpenNew={() => ctrl.setShowNewModal(true)}
      />

      {ctrl.notice && <NoticeBanner notice={ctrl.notice} onDismiss={() => ctrl.setNotice(null)} />}

      <SkillsToolbar
        activeTab={ctrl.activeTab}
        searchQuery={ctrl.searchQuery}
        setSearchQuery={ctrl.setSearchQuery}
        scopeFilter={ctrl.scopeFilter}
        setScopeFilter={ctrl.setScopeFilter}
        skillsCount={ctrl.skills.length}
      />

      {ctrl.activeTab === 'installed' ? (
        <SkillsInstalledGrid
          loading={ctrl.loading}
          skills={ctrl.filteredSkills}
          searchQuery={ctrl.searchQuery}
          onToggle={ctrl.handleToggleSkill}
          onDetail={(skill) =>
            ctrl.setSelectedSkill({
              id: skill.id,
              name: skill.name,
              description: skill.description,
              scope: skill.scope,
              path: skill.path,
              content: '',
              enabled: skill.enabled,
              overridden: skill.overridden,
            })
          }
          onUpdate={ctrl.handleUpdateSkill}
          onDelete={ctrl.handleDeleteSkill}
        />
      ) : (
        <SkillsBrowseGrid
          packs={ctrl.filteredPacks}
          installing={ctrl.installing}
          onInstall={(pack) => {
            ctrl.setInstallUrl(pack.repo);
            ctrl.setInstallRef(pack.defaultRef || '');
            ctrl.setShowInstallModal(true);
          }}
        />
      )}

      {ctrl.selectedSkill && (
        <SkillDetailModal
          skill={ctrl.selectedSkill}
          onClose={() => ctrl.setSelectedSkill(null)}
          onSaved={() => {
            ctrl.setNotice({ tone: 'success', message: 'Skill 保存成功' });
            ctrl.fetchSkills();
          }}
        />
      )}

      {ctrl.showInstallModal && (
        <SkillInstallModal
          open={ctrl.showInstallModal}
          installUrl={ctrl.installUrl}
          setInstallUrl={ctrl.setInstallUrl}
          installRef={ctrl.installRef}
          setInstallRef={ctrl.setInstallRef}
          installScope={ctrl.installScope}
          setInstallScope={ctrl.setInstallScope}
          installing={ctrl.installing}
          onClose={() => ctrl.setShowInstallModal(false)}
          onInstall={ctrl.handleInstallSkill}
        />
      )}

      {ctrl.showNewModal && (
        <SkillNewModal
          open={ctrl.showNewModal}
          onClose={() => ctrl.setShowNewModal(false)}
          onCreated={(id) => {
            ctrl.setNotice({ tone: 'success', message: `成功创建 Skill "${id}"！` });
            ctrl.fetchSkills();
          }}
        />
      )}
    </div>
  );
}

function SkillsPageHeader(props: {
  skillsCount: number;
  activeTab: 'installed' | 'browse';
  setActiveTab: (t: 'installed' | 'browse') => void;
  loading: boolean;
  verifying: boolean;
  onRefresh: () => void;
  onVerify: () => void;
  onOpenInstall: () => void;
  onOpenNew: () => void;
}) {
  return (
    <PageHeader
      title="技能中心 (Agent Skills)"
      description="统一 Agent Skills（SKILL.md）分发与管理。兼容 .agents/ 根目录与 GitHub 生态，技能自动挂载到 Claude Code、Codex、Gemini CLI 等 Agent 原生目录中。"
      actions={
        <div className="flex items-center gap-2">
          <div className="mr-2 flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
            <button
              onClick={() => props.setActiveTab('installed')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all',
                props.activeTab === 'installed'
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              已安装 ({props.skillsCount})
            </button>
            <button
              onClick={() => props.setActiveTab('browse')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all',
                props.activeTab === 'browse'
                  ? 'bg-background shadow-sm text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Compass className="h-3.5 w-3.5" />
              发现与推荐
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={props.onRefresh} title="刷新">
            <RefreshCw className={cn('h-4 w-4', props.loading && 'animate-spin')} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={props.onVerify}
            disabled={props.verifying}
            title="校验本地已安装技能指纹"
          >
            <CheckCircle2 className={cn('mr-1.5 h-4 w-4', props.verifying && 'animate-spin')} />
            {props.verifying ? '校验中…' : '指纹校验'}
          </Button>
          <Button variant="outline" size="sm" onClick={props.onOpenInstall}>
            <FolderGit2 className="mr-1.5 h-4 w-4" />
            安装 GitHub 技能
          </Button>
          <Button size="sm" onClick={props.onOpenNew}>
            <Plus className="mr-1.5 h-4 w-4" />
            新建 Skill
          </Button>
        </div>
      }
    />
  );
}

function NoticeBanner({ notice, onDismiss }: { notice: NoticeState; onDismiss: () => void }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-lg border p-4 text-sm font-medium transition-all',
        notice.tone === 'success' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
        notice.tone === 'warning' && 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300',
        notice.tone === 'error' && 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300',
      )}
    >
      <span>{notice.message}</span>
      <button onClick={onDismiss} className="ml-4 opacity-70 hover:opacity-100">
        ×
      </button>
    </div>
  );
}

function SkillsToolbar(props: {
  activeTab: 'installed' | 'browse';
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  scopeFilter: 'all' | SkillScope;
  setScopeFilter: (s: 'all' | SkillScope) => void;
  skillsCount: number;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={props.activeTab === 'installed' ? '搜索已安装 Skill 名称、ID 或描述...' : '搜索推荐技能包与关键词...'}
          value={props.searchQuery}
          onChange={(e) => props.setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      {props.activeTab === 'installed' && (
        <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1 text-xs">
          <button
            onClick={() => props.setScopeFilter('all')}
            className={cn(
              'rounded-md px-3 py-1.5 font-medium transition-colors',
              props.scopeFilter === 'all'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            全部 ({props.skillsCount})
          </button>
          <button
            onClick={() => props.setScopeFilter('workspace')}
            className={cn(
              'rounded-md px-3 py-1.5 font-medium transition-colors',
              props.scopeFilter === 'workspace'
                ? 'bg-background shadow-sm text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Workspace
          </button>
          <button
            onClick={() => props.setScopeFilter('user')}
            className={cn(
              'rounded-md px-3 py-1.5 font-medium transition-colors',
              props.scopeFilter === 'user'
                ? 'bg-background shadow-sm text-blue-600 dark:text-blue-400'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            User
          </button>
          <button
            onClick={() => props.setScopeFilter('builtin')}
            className={cn(
              'rounded-md px-3 py-1.5 font-medium transition-colors',
              props.scopeFilter === 'builtin'
                ? 'bg-background shadow-sm text-purple-600 dark:text-purple-400'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Builtin
          </button>
        </div>
      )}
    </div>
  );
}

function SkillsInstalledGrid(props: {
  loading: boolean;
  skills: SkillInfo[];
  searchQuery: string;
  onToggle: (s: SkillInfo) => void;
  onDetail: (s: SkillInfo) => void;
  onUpdate: (id?: string) => void;
  onDelete: (s: SkillInfo) => void;
}) {
  if (props.loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">正在加载 Skill 目录...</div>;
  }
  if (props.skills.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        message={props.searchQuery ? '没有匹配搜索条件的 Skill' : '当前目录下暂无可用 Skill，可点击上方新建或在发现页安装'}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {props.skills.map((skill) => (
        <SkillInstalledCard
          key={`${skill.scope}:${skill.id}`}
          skill={skill}
          onToggle={() => props.onToggle(skill)}
          onDetail={() => props.onDetail(skill)}
          onUpdate={() => props.onUpdate(skill.id)}
          onDelete={() => props.onDelete(skill)}
        />
      ))}
    </div>
  );
}

function SkillInstalledCard(props: {
  skill: SkillInfo;
  onToggle: () => void;
  onDetail: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  const { skill } = props;
  return (
    <Card
      className={cn(
        'group relative flex flex-col justify-between border p-5 transition-all hover:border-primary/50 hover:shadow-md',
        !skill.enabled && 'opacity-60 bg-muted/20',
        skill.overridden && 'border-dashed border-amber-500/40 bg-amber-500/5',
      )}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground text-base group-hover:text-primary transition-colors">
              {skill.name || skill.id}
            </span>
            <ScopeBadge scope={skill.scope} />
            {skill.overridden && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" /> 被 {skill.overriddenBy} 覆盖
              </span>
            )}
            {skill.source && <SourceStatusBadge source={skill.source} />}
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" checked={skill.enabled} onChange={props.onToggle} className="peer sr-only" />
            <div className="peer h-5 w-9 rounded-full bg-muted peer-checked:bg-primary peer-focus:outline-none after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-background after:transition-all after:content-[''] peer-checked:after:translate-x-full" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed min-h-[2.25rem]">
          {skill.description || '无详细描述'}
        </p>
        <div className="text-[11px] text-muted-foreground/80 font-mono truncate bg-muted/40 px-2 py-1 rounded">
          {skill.path}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs">
        <Button variant="ghost" size="sm" onClick={props.onDetail} className="h-8 text-xs hover:bg-primary/10 hover:text-primary">
          <Code2 className="mr-1.5 h-3.5 w-3.5" /> SKILL.md
        </Button>
        <div className="flex items-center gap-1">
          {skill.source && (
            <Button variant="ghost" size="sm" onClick={props.onUpdate} className="h-8 text-xs hover:bg-primary/10 hover:text-primary" title="从来源更新">
              <RefreshCw className="mr-1 h-3 w-3" /> 更新
            </Button>
          )}
          {skill.scope !== 'builtin' && (
            <Button variant="ghost" size="sm" onClick={props.onDelete} className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function SkillsBrowseGrid(props: {
  packs: CuratedSkillPack[];
  installing: boolean;
  onInstall: (pack: CuratedSkillPack) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {props.packs.map((pack) => (
        <Card
          key={pack.id}
          className="flex flex-col justify-between border p-5 transition-all hover:border-primary/50 hover:shadow-md"
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-base text-foreground">{pack.name}</h3>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5 font-mono">
                  <GitBranch className="h-3 w-3" /> {pack.repo}
                </div>
              </div>
              <span className="rounded bg-primary/10 px-2 py-0.5 font-semibold text-xs text-primary">{pack.stars}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed min-h-[3rem]">{pack.description}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {pack.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between border-t pt-3 text-xs">
            <a
              href={`https://github.com/${pack.repo}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" /> GitHub
            </a>
            <Button size="sm" onClick={() => props.onInstall(pack)} disabled={props.installing} className="h-8 text-xs">
              <Download className="mr-1.5 h-3.5 w-3.5" /> 一键安装
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function SkillDetailModal({
  skill,
  onClose,
  onSaved,
}: {
  skill: SkillDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<SkillDetail>(skill);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');

  useEffect(() => {
    skillsApi
      .getSkill(skill.id)
      .then((d) => {
        setDetail(d);
        setEditedContent(d.content);
      })
      .catch(() => {});
  }, [skill.id]);

  const handleSave = async () => {
    try {
      await skillsApi.saveSkill({
        id: detail.id,
        scope: detail.scope === 'builtin' ? 'user' : detail.scope,
        content: editedContent,
      });
      setIsEditing(false);
      onSaved();
    } catch {}
  };

  return (
    <Modal open={true} onClose={onClose} title={`Skill 详情: ${detail.name || detail.id}`} className="max-w-3xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b pb-3 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <ScopeBadge scope={detail.scope} />
            {detail.source && <SourceStatusBadge source={detail.source} />}
            <span className="font-mono text-xs text-muted-foreground">{detail.path}</span>
          </div>
          <Button
            size="sm"
            variant={isEditing ? 'default' : 'outline'}
            onClick={isEditing ? handleSave : () => setIsEditing(true)}
          >
            {isEditing ? (
              '保存修改'
            ) : (
              <>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> 编辑 SKILL.md
              </>
            )}
          </Button>
        </div>
        {detail.helpers && detail.helpers.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="font-medium text-foreground mb-1.5 flex items-center gap-1.5">
              <FileCode className="h-3.5 w-3.5 text-primary" /> 关联 Helper 依赖:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {detail.helpers.map((h) => (
                <span key={h} className="rounded bg-background px-2 py-0.5 font-mono text-[11px] border">
                  {h}
                </span>
              ))}
            </div>
          </div>
        )}
        {isEditing ? (
          <Textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="font-mono text-xs min-h-[350px] leading-relaxed"
          />
        ) : (
          <pre className="max-h-[450px] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {detail.content}
          </pre>
        )}
      </div>
    </Modal>
  );
}

function SkillInstallModal(props: {
  open: boolean;
  installUrl: string;
  setInstallUrl: (v: string) => void;
  installRef: string;
  setInstallRef: (v: string) => void;
  installScope: 'user' | 'workspace';
  setInstallScope: (v: 'user' | 'workspace') => void;
  installing: boolean;
  onClose: () => void;
  onInstall: () => void;
}) {
  return (
    <Modal open={props.open} onClose={props.onClose} title="安装 GitHub / URL Skill">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          输入 GitHub 仓库（例如 <code className="bg-muted px-1 py-0.5 rounded">mattpocock/skills</code> 或{' '}
          <code className="bg-muted px-1 py-0.5 rounded">owner/repo@ref</code>），系统将自动拉取并解析 SKILL.md。
        </p>
        <div className="space-y-2">
          <label className="text-xs font-medium">GitHub 仓库或 URL</label>
          <Input
            placeholder="owner/repo[@ref] 或 https://github.com/..."
            value={props.installUrl}
            onChange={(e) => props.setInstallUrl(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium">指定版本 Branch / Tag (可选)</label>
          <Input
            placeholder="main / v1.0.0"
            value={props.installRef}
            onChange={(e) => props.setInstallRef(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium">安装作用域 Scope</label>
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scope"
                checked={props.installScope === 'user'}
                onChange={() => props.setInstallScope('user')}
              />
              User 全局级 (~/.agentdock/skills/)
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scope"
                checked={props.installScope === 'workspace'}
                onChange={() => props.setInstallScope('workspace')}
              />
              Workspace 项目级 (.agentdock/skills/)
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={props.onClose}>
            取消
          </Button>
          <Button onClick={props.onInstall} disabled={props.installing || !props.installUrl.trim()}>
            {props.installing ? '正在安装...' : '开始安装'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SkillNewModal(props: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [id, setId] = useState('');
  const [scope, setScope] = useState<'user' | 'workspace'>('workspace');
  const [content, setContent] = useState(
    `---\nname: my-custom-skill\ndescription: 描述 Skill 的用途与触发场景\nversion: 1.0.0\n---\n\n# Skill 指令与步骤\n\n当符合条件时执行以下操作...\n`,
  );
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!id.trim()) return;
    setCreating(true);
    try {
      await skillsApi.saveSkill({ id: id.trim(), scope, content });
      props.onCreated(id.trim());
      props.onClose();
    } catch {} finally {
      setCreating(false);
    }
  };

  return (
    <Modal open={props.open} onClose={props.onClose} title="创建新 Skill" className="max-w-3xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Skill 标识 ID</label>
            <Input
              placeholder="my-custom-skill"
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">保存目录 Scope</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'user' | 'workspace')}
              className="w-full rounded-md border bg-background px-3 py-2 text-xs"
            >
              <option value="workspace">Workspace 项目级 (.agentdock/skills/)</option>
              <option value="user">User 全局级 (~/.agentdock/skills/)</option>
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium">SKILL.md 内容模板</label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="font-mono text-xs min-h-[260px]"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={props.onClose}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={creating || !id.trim()}>
            {creating ? '正在创建...' : '创建并保存'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ScopeBadge({ scope }: { scope: SkillScope }) {
  if (scope === 'workspace') {
    return (
      <span className="inline-flex items-center rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
        Workspace
      </span>
    );
  }
  if (scope === 'user') {
    return (
      <span className="inline-flex items-center rounded bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 border border-blue-500/20">
        User Global
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded bg-purple-500/10 px-2 py-0.5 text-[11px] font-medium text-purple-600 dark:text-purple-400 border border-purple-500/20">
      Builtin
    </span>
  );
}

function SourceStatusBadge({ source }: { source: SkillSource }) {
  const label = source.sourceRef ? `${source.sourceRepo}@${source.sourceRef}` : source.sourceRepo;
  if (source.status === 'locally-modified') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400 border border-amber-500/20 font-mono"
        title="该技能已在本地被编辑修改"
      >
        <AlertTriangle className="h-3 w-3" /> {label} (modified)
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground border font-mono"
      title={`来源: ${label}`}
    >
      <GitBranch className="h-3 w-3" /> {label}
    </span>
  );
}
