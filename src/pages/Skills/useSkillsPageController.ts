import { useCallback, useEffect, useMemo, useState } from 'react';
import { skills as skillsApi } from '@cc/core-sdk';
import type { SkillInfo, SkillDetail, SkillScope, CuratedSkillPack } from '@cc/superai-contracts/skills';

export type NoticeTone = 'success' | 'error' | 'warning';

export interface NoticeState {
  tone: NoticeTone;
  message: string;
}

export const CURATED_PACKS: CuratedSkillPack[] = [
  {
    id: 'mattpocock-skills',
    repo: 'mattpocock/skills',
    name: 'Matt Pocock Engineering Skills',
    description: '面向工程师的真实软件开发技能集（TDD、to-spec、implement、handoff、grill-me、code-review 等）。',
    stars: '223k★',
    skillsCount: 7,
    tags: ['TDD', 'Spec', 'Engineering', 'Workflow'],
    defaultRef: 'main',
  },
  {
    id: 'superpowers',
    repo: 'obra/superpowers',
    name: 'Superpowers Methodology Pack',
    description: '面向复杂系统架构与工程规范的技能集，包含系统设计、分解、执行与交接标准。',
    stars: '274k★',
    skillsCount: 8,
    tags: ['Architecture', 'Methodology', 'Planning'],
    defaultRef: 'main',
  },
  {
    id: 'anthropics-skills',
    repo: 'anthropics/skills',
    name: 'Anthropic Official Skills',
    description: 'Anthropic 官方开源的通用 Agent 技能集合，涵盖代码分析、文档处理与工具集成。',
    stars: '168k★',
    skillsCount: 12,
    tags: ['Official', 'General', 'Analysis'],
    defaultRef: 'main',
  },
  {
    id: 'obsidian-skills',
    repo: 'kepano/obsidian-skills',
    name: 'Obsidian Knowledge Pack',
    description: 'Obsidian 官方 Markdown、Canvas 可视化白板、Bases 数据库与 CLI 操作增强技能集。',
    stars: '45k★',
    skillsCount: 5,
    tags: ['Knowledge', 'Markdown', 'Canvas', 'Obsidian'],
    defaultRef: 'main',
  },
  {
    id: 'agent-skills',
    repo: 'addyosmani/agent-skills',
    name: 'Addy Osmani Agent Skills',
    description: '专注于全栈工程优化、Web 性能与前端架构重构的高阶 Agent 技能集合。',
    stars: '85k★',
    skillsCount: 6,
    tags: ['Frontend', 'Performance', 'Refactoring'],
    defaultRef: 'main',
  },
];

export function useSkillsPageController() {
  const [activeTab, setActiveTab] = useState<'installed' | 'browse'>('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | SkillScope>('all');
  const modals = useSkillModalsState();
  const ops = useSkillOperations(modals.selectedSkill, modals.setSelectedSkill, modals.setShowInstallModal, modals.setInstallUrl, modals.setInstallRef, modals.installUrl, modals.installRef, modals.installScope);

  const filteredSkills = useMemo(() => {
    return ops.skills.filter((skill) => {
      if (scopeFilter !== 'all' && skill.scope !== scopeFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return skill.id.toLowerCase().includes(q) || skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q);
    });
  }, [ops.skills, scopeFilter, searchQuery]);

  const filteredPacks = useMemo(() => {
    if (!searchQuery.trim()) return CURATED_PACKS;
    const q = searchQuery.toLowerCase();
    return CURATED_PACKS.filter((p) => p.name.toLowerCase().includes(q) || p.repo.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q)));
  }, [searchQuery]);

  return {
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    scopeFilter,
    setScopeFilter,
    filteredSkills,
    filteredPacks,
    ...modals,
    ...ops,
  };
}

function useSkillModalsState() {
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installUrl, setInstallUrl] = useState('');
  const [installRef, setInstallRef] = useState('');
  const [installScope, setInstallScope] = useState<'user' | 'workspace'>('user');
  const [showNewModal, setShowNewModal] = useState(false);

  return {
    selectedSkill,
    setSelectedSkill,
    showInstallModal,
    setShowInstallModal,
    installUrl,
    setInstallUrl,
    installRef,
    setInstallRef,
    installScope,
    setInstallScope,
    showNewModal,
    setShowNewModal,
  };
}

function useSkillOperations(
  selectedSkill: SkillDetail | null,
  setSelectedSkill: (s: SkillDetail | null) => void,
  setShowInstallModal: (s: boolean) => void,
  setInstallUrl: (s: string) => void,
  setInstallRef: (s: string) => void,
  installUrl: string,
  installRef: string,
  installScope: 'user' | 'workspace',
) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [installing, setInstalling] = useState(false);
  const [verifying, setVerifying] = useState(false);

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

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const handleToggleSkill = async (skill: SkillInfo) => {
    try {
      await skillsApi.toggleSkill({ id: skill.id, enabled: !skill.enabled });
      setSkills((prev) => prev.map((s) => (s.id === skill.id && s.scope === skill.scope ? { ...s, enabled: !s.enabled } : s)));
      setNotice({ tone: 'success', message: `已${!skill.enabled ? '启用' : '禁用'} Skill "${skill.name || skill.id}"` });
    } catch (err) {
      setNotice({ tone: 'error', message: `状态切换失败: ${String(err)}` });
    }
  };

  const handleDeleteSkill = async (skill: SkillInfo) => {
    if (!confirm(`确定要删除 Skill "${skill.name || skill.id}" 吗？此操作无法撤销。`)) return;
    try {
      await skillsApi.deleteSkill({ id: skill.id, scope: skill.scope as 'user' | 'workspace' });
      setNotice({ tone: 'success', message: `Skill "${skill.name || skill.id}" 已成功删除` });
      if (selectedSkill?.id === skill.id) setSelectedSkill(null);
      fetchSkills();
    } catch (err) {
      setNotice({ tone: 'error', message: `删除失败: ${String(err)}` });
    }
  };

  const handleInstallSkill = async (customRepo?: string, customRef?: string) => {
    const targetRepo = customRepo || installUrl;
    if (!targetRepo.trim()) return;
    setInstalling(true);
    try {
      const result = await skillsApi.addSkill({ repo: targetRepo.trim(), ref: customRef || installRef.trim() || undefined, targetScope: installScope });
      setNotice({ tone: 'success', message: `成功安装 ${result.installed.length} 个 Skill！` });
      setShowInstallModal(false);
      setInstallUrl('');
      setInstallRef('');
      fetchSkills();
    } catch (err) {
      setNotice({ tone: 'error', message: `安装失败: ${String(err)}` });
    } finally {
      setInstalling(false);
    }
  };

  const handleUpdateSkill = async (skillId?: string) => {
    try {
      const result = await skillsApi.updateSkill({ id: skillId, all: !skillId });
      if (result.conflicts.length > 0) {
        setNotice({ tone: 'warning', message: `存在本地修改冲突: ${result.conflicts.map((c) => c.reason).join('; ')}` });
      } else {
        setNotice({ tone: 'success', message: `成功更新 ${result.updated.length} 个 Skill` });
      }
      fetchSkills();
    } catch (err) {
      setNotice({ tone: 'error', message: `更新失败: ${String(err)}` });
    }
  };

  const handleVerifySkills = async () => {
    setVerifying(true);
    try {
      const res = await skillsApi.verifySkills();
      const modified = res.skills.filter((s) => s.status === 'locally-modified');
      if (modified.length > 0) {
        setNotice({ tone: 'warning', message: `检测到 ${modified.length} 个技能已被本地修改（${modified.map((s) => s.id).join(', ')}）。` });
      } else {
        setNotice({ tone: 'success', message: '所有已安装技能的来源与指纹校验通过 (Clean)。' });
      }
      fetchSkills();
    } catch (err) {
      setNotice({ tone: 'error', message: `校验失败: ${String(err)}` });
    } finally {
      setVerifying(false);
    }
  };

  return {
    skills,
    loading,
    notice,
    setNotice,
    installing,
    verifying,
    fetchSkills,
    handleToggleSkill,
    handleDeleteSkill,
    handleInstallSkill,
    handleUpdateSkill,
    handleVerifySkills,
  };
}
