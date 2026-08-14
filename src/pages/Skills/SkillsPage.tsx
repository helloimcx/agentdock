import { useCallback, useEffect, useMemo, useState } from 'react';
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
  BookOpen,
} from 'lucide-react';
import { Button, Card, EmptyState, Input, Modal, Textarea, PageHeader } from '@/components/ui';
import { skills as skillsApi } from '@cc/core-sdk';
import type { SkillInfo, SkillDetail, SkillScope } from '@cc/superai-contracts/skills';
import { cn } from '@/lib/utils';

type NoticeTone = 'success' | 'error' | 'warning';

interface NoticeState {
  tone: NoticeTone;
  message: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | SkillScope>('all');

  // Modals
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null);
  const [_isDetailLoading, setIsDetailLoading] = useState(false);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editedContent, setEditedContent] = useState('');

  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installUrl, setInstallUrl] = useState('');
  const [installScope, setInstallScope] = useState<'user' | 'workspace'>('user');
  const [installing, setInstalling] = useState(false);
  const [installingBundle, setInstallingBundle] = useState(false);

  const [showNewModal, setShowNewModal] = useState(false);
  const [newSkillId, setNewSkillId] = useState('');
  const [newSkillScope, setNewSkillScope] = useState<'user' | 'workspace'>('workspace');
  const [newSkillContent, setNewSkillContent] = useState(
    `---\nname: my-custom-skill\ndescription: 描述 Skill 的用途与触发场景\nversion: 1.0.0\n---\n\n# Skill 指令与步骤\n\n当符合条件时执行以下操作...\n`
  );
  const [creating, setCreating] = useState(false);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await skillsApi.listSkills();
      setSkills(res.skills || []);
    } catch (err) {
      setNotice({ tone: 'error', message: `获取 Skill 列表失败: ${String(err)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const showSkillDetail = async (skill: SkillInfo) => {
    setIsDetailLoading(true);
    setIsEditingContent(false);
    try {
      const detail = await skillsApi.getSkill(skill.id);
      setSelectedSkill(detail);
      setEditedContent(detail.content);
    } catch (err) {
      setNotice({ tone: 'error', message: `获取 Skill 详情失败: ${String(err)}` });
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleToggleSkill = async (skill: SkillInfo) => {
    try {
      await skillsApi.toggleSkill({ id: skill.id, enabled: !skill.enabled });
      setSkills((prev) =>
        prev.map((s) => (s.id === skill.id && s.scope === skill.scope ? { ...s, enabled: !s.enabled } : s))
      );
      setNotice({
        tone: 'success',
        message: `已${!skill.enabled ? '启用' : '禁用'} Skill "${skill.name || skill.id}"`,
      });
    } catch (err) {
      setNotice({ tone: 'error', message: `状态切换失败: ${String(err)}` });
    }
  };

  const handleSaveSkillContent = async () => {
    if (!selectedSkill) return;
    try {
      await skillsApi.saveSkill({
        id: selectedSkill.id,
        scope: selectedSkill.scope === 'builtin' ? 'user' : selectedSkill.scope,
        content: editedContent,
      });
      setNotice({ tone: 'success', message: `Skill "${selectedSkill.name}" 保存成功` });
      setIsEditingContent(false);
      setSelectedSkill((prev) => (prev ? { ...prev, content: editedContent } : null));
      fetchSkills();
    } catch (err) {
      setNotice({ tone: 'error', message: `保存失败: ${String(err)}` });
    }
  };

  const handleDeleteSkill = async (skill: SkillInfo) => {
    if (!confirm(`确定要删除 Skill "${skill.name || skill.id}" 吗？此操作无法撤销。`)) return;
    try {
      await skillsApi.deleteSkill({ id: skill.id, scope: skill.scope as 'user' | 'workspace' });
      setNotice({ tone: 'success', message: `Skill "${skill.name || skill.id}" 已成功删除` });
      if (selectedSkill?.id === skill.id) {
        setSelectedSkill(null);
      }
      fetchSkills();
    } catch (err) {
      setNotice({ tone: 'error', message: `删除失败: ${String(err)}` });
    }
  };

  const handleInstallSkill = async () => {
    if (!installUrl.trim()) return;
    setInstalling(true);
    try {
      const installed = await skillsApi.installSkill({ url: installUrl, targetScope: installScope });
      setNotice({ tone: 'success', message: `成功安装 Skill "${installed.name || installed.id}"！` });
      setShowInstallModal(false);
      setInstallUrl('');
      fetchSkills();
    } catch (err) {
      setNotice({ tone: 'error', message: `安装失败: ${String(err)}` });
    } finally {
      setInstalling(false);
    }
  };

  const handleInstallObsidianBundle = async () => {
    if (!confirm('将从 github.com/kepano/obsidian-skills 安装 5 个 Obsidian 技能到用户级目录（obsidian-markdown / obsidian-bases / json-canvas / obsidian-cli / defuddle）。继续？')) return;
    setInstallingBundle(true);
    try {
      const result = await skillsApi.installSkillBundle({
        url: 'https://github.com/kepano/obsidian-skills.git',
        skillsDir: 'skills',
        targetScope: 'user',
      });
      const count = result.installed.length;
      const skippedNote = result.skipped.length ? `（跳过 ${result.skipped.length} 个不符合命名规范的目录）` : '';
      setNotice({ tone: 'success', message: `成功安装 ${count} 个 Obsidian 技能${skippedNote}。` });
      fetchSkills();
    } catch (err) {
      setNotice({ tone: 'error', message: `Obsidian 技能包安装失败: ${String(err)}` });
    } finally {
      setInstallingBundle(false);
    }
  };

  const handleCreateSkill = async () => {
    if (!newSkillId.trim()) return;
    setCreating(true);
    try {
      await skillsApi.saveSkill({
        id: newSkillId.trim(),
        scope: newSkillScope,
        content: newSkillContent,
      });
      setNotice({ tone: 'success', message: `成功创建 Skill "${newSkillId}"！` });
      setShowNewModal(false);
      setNewSkillId('');
      fetchSkills();
    } catch (err) {
      setNotice({ tone: 'error', message: `创建失败: ${String(err)}` });
    } finally {
      setCreating(false);
    }
  };

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      if (scopeFilter !== 'all' && skill.scope !== scopeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          skill.id.toLowerCase().includes(q) ||
          skill.name.toLowerCase().includes(q) ||
          skill.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [skills, scopeFilter, searchQuery]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader
        title="技能中心 (Agent Skills)"
        description="管理与配置开放 Agent Skills（SKILL.md 格式）。技能自动挂载/软链到 Claude Code、Codex、Gemini CLI、Pi、Hermes 等 Agent 原生目录中。"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchSkills()} title="刷新">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleInstallObsidianBundle}
              disabled={installingBundle}
              title="一键安装 kepano/obsidian-skills 中的 5 个官方 Obsidian 技能"
            >
              <BookOpen className={cn('mr-1.5 h-4 w-4', installingBundle && 'animate-pulse')} />
              {installingBundle ? '安装中…' : '安装 Obsidian 技能包'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowInstallModal(true)}>
              <FolderGit2 className="mr-1.5 h-4 w-4" />
              Git / URL 安装
            </Button>
            <Button size="sm" onClick={() => setShowNewModal(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              新建 Skill
            </Button>
          </div>
        }
      />

      {notice && (
        <div
          className={cn(
            'flex items-center justify-between rounded-lg border p-4 text-sm font-medium transition-all',
            notice.tone === 'success' && 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
            notice.tone === 'warning' && 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300',
            notice.tone === 'error' && 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300'
          )}
        >
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} className="ml-4 opacity-70 hover:opacity-100">
            ×
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索 Skill 名称、ID 或描述..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1 text-xs">
          <button
            onClick={() => setScopeFilter('all')}
            className={cn('rounded-md px-3 py-1.5 font-medium transition-colors', scopeFilter === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            全部 ({skills.length})
          </button>
          <button
            onClick={() => setScopeFilter('workspace')}
            className={cn('rounded-md px-3 py-1.5 font-medium transition-colors', scopeFilter === 'workspace' ? 'bg-background shadow-sm text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground hover:text-foreground')}
          >
            Workspace 项目级
          </button>
          <button
            onClick={() => setScopeFilter('user')}
            className={cn('rounded-md px-3 py-1.5 font-medium transition-colors', scopeFilter === 'user' ? 'bg-background shadow-sm text-blue-600 dark:text-blue-400' : 'text-muted-foreground hover:text-foreground')}
          >
            User 全局级
          </button>
          <button
            onClick={() => setScopeFilter('builtin')}
            className={cn('rounded-md px-3 py-1.5 font-medium transition-colors', scopeFilter === 'builtin' ? 'bg-background shadow-sm text-purple-600 dark:text-purple-400' : 'text-muted-foreground hover:text-foreground')}
          >
            Builtin 内置级
          </button>
        </div>
      </div>

      {/* Skills Grid */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">正在加载 Skill 目录...</div>
      ) : filteredSkills.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          message={searchQuery ? '没有匹配搜索条件的 Skill' : '当前工作区与系统目录下暂无可用 Skill，可点击上方新建或安装'}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSkills.map((skill) => (
            <Card
              key={`${skill.scope}:${skill.id}`}
              className={cn(
                'group relative flex flex-col justify-between border p-5 transition-all hover:border-primary/50 hover:shadow-md',
                !skill.enabled && 'opacity-60 bg-muted/20',
                skill.overridden && 'border-dashed border-amber-500/40 bg-amber-500/5'
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
                  </div>

                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      onChange={() => handleToggleSkill(skill)}
                      className="peer sr-only"
                    />
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => showSkillDetail(skill)}
                  className="h-8 text-xs hover:bg-primary/10 hover:text-primary"
                >
                  <Code2 className="mr-1.5 h-3.5 w-3.5" />
                  查看 / 编辑 SKILL.md
                </Button>

                {skill.scope !== 'builtin' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteSkill(skill)}
                    className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Skill Detail Modal */}
      {selectedSkill && (
        <Modal
          open={!!selectedSkill}
          onClose={() => setSelectedSkill(null)}
          title={`Skill 详情: ${selectedSkill.name || selectedSkill.id}`}
          className="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b pb-3 text-sm">
              <div className="flex items-center gap-2">
                <ScopeBadge scope={selectedSkill.scope} />
                <span className="font-mono text-xs text-muted-foreground">{selectedSkill.path}</span>
              </div>
              <div className="flex items-center gap-2">
                {!isEditingContent ? (
                  <Button size="sm" variant="outline" onClick={() => setIsEditingContent(true)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    编辑 SKILL.md
                  </Button>
                ) : (
                  <Button size="sm" onClick={handleSaveSkillContent}>
                    保存修改
                  </Button>
                )}
              </div>
            </div>

            {selectedSkill.helpers && selectedSkill.helpers.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                  <FileCode className="h-3.5 w-3.5 text-primary" /> 关联 Helper / Script 依赖:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedSkill.helpers.map((h) => (
                    <span key={h} className="rounded bg-background px-2 py-0.5 font-mono text-[11px] border">
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {isEditingContent ? (
              <div className="space-y-2">
                <Textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="font-mono text-xs min-h-[350px] leading-relaxed"
                />
              </div>
            ) : (
              <pre className="max-h-[450px] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {selectedSkill.content}
              </pre>
            )}
          </div>
        </Modal>
      )}

      {/* Install Skill Modal */}
      {showInstallModal && (
        <Modal
          open={showInstallModal}
          onClose={() => setShowInstallModal(false)}
          title="从 Git / URL 安装 Skill"
        >
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              输入社区或 Git 仓库 URL，系统将自动 clone 并解析包含的 SKILL.md。
            </p>

            <div className="space-y-2">
              <label className="text-xs font-medium">Git 仓库 URL</label>
              <Input
                placeholder="https://github.com/user/agent-skill-example.git"
                value={installUrl}
                onChange={(e) => setInstallUrl(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">安装目标作用域 Scope</label>
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    checked={installScope === 'user'}
                    onChange={() => setInstallScope('user')}
                  />
                  User 全局级 (~/.agentdock/skills/)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    checked={installScope === 'workspace'}
                    onChange={() => setInstallScope('workspace')}
                  />
                  Workspace 项目级 (.agentdock/skills/)
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowInstallModal(false)}>
                取消
              </Button>
              <Button onClick={handleInstallSkill} disabled={installing || !installUrl.trim()}>
                {installing ? '正在安装...' : '开始安装'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* New Skill Modal */}
      {showNewModal && (
        <Modal
          open={showNewModal}
          onClose={() => setShowNewModal(false)}
          title="创建新 Skill"
          className="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Skill 标识 ID (字母数字短横线)</label>
                <Input
                  placeholder="my-custom-skill"
                  value={newSkillId}
                  onChange={(e) => setNewSkillId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">保存目录 Scope</label>
                <select
                  value={newSkillScope}
                  onChange={(e) => setNewSkillScope(e.target.value as 'user' | 'workspace')}
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
                value={newSkillContent}
                onChange={(e) => setNewSkillContent(e.target.value)}
                className="font-mono text-xs min-h-[260px]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowNewModal(false)}>
                取消
              </Button>
              <Button onClick={handleCreateSkill} disabled={creating || !newSkillId.trim()}>
                {creating ? '正在创建...' : '创建并保存'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
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
