import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, RefreshCw, Sparkles } from 'lucide-react';
import { Button, Select } from '@/components/ui';
import type { DesktopProjectConfig } from '@cc/superai-contracts';
import type { StandardPackInfo } from '@cc/superai-contracts/standards';
import {
  listStandardPacks,
  materializeWorkspaceStandards,
  detectWorkspaceTechStack,
} from '@cc/core-sdk/standards';
import {
  desktopProjectWorkspaceId,
  toStandardsForm,
  fromStandardsForm,
  type StandardsForm,
} from './workspace-model';

type StandardsSectionProps = {
  project: DesktopProjectConfig;
  updateProject: (updater: (project: DesktopProjectConfig) => DesktopProjectConfig) => void;
};

const DEFAULT_CURATED_PACKS: StandardPackInfo[] = [
  {
    id: 'general',
    name: '通用工程与架构规范',
    language: 'general',
    description: '单向依赖、契约边界、防御式编程与供应链安全',
    version: '1.0.0',
    scope: 'builtin',
    enabled: true,
  },
  {
    id: 'design-system',
    name: '界面设计与体验规范',
    language: 'design-system',
    description: 'VoltAgent 设计规范、AgentDock 品牌色 (#42ff9c) 与交互状态反馈',
    version: '1.0.0',
    scope: 'builtin',
    enabled: true,
  },
  {
    id: 'typescript',
    name: 'Strict TypeScript 规范',
    language: 'typescript',
    description: '严格空检查、禁止 any、类型断言最小化',
    version: '1.0.0',
    scope: 'builtin',
    enabled: true,
  },
  {
    id: 'golang',
    name: 'Go 语言最佳实践',
    language: 'golang',
    description: '显式错误处理、Goroutine 生命周期安全与结构体对齐',
    version: '1.0.0',
    scope: 'builtin',
    enabled: true,
  },
  {
    id: 'python',
    name: 'Python PEP8 编码规范',
    language: 'python',
    description: '类型注解、上下文管理器与异常分层',
    version: '1.0.0',
    scope: 'builtin',
    enabled: true,
  },
];

function useStandardsSectionState({ project, updateProject }: StandardsSectionProps) {
  const workspaceId = desktopProjectWorkspaceId(project);
  const standards = project.agent?.options?.standards;
  const form = toStandardsForm(standards);

  const [materializing, setMaterializing] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [availablePacks, setAvailablePacks] = useState<StandardPackInfo[]>(DEFAULT_CURATED_PACKS);

  useEffect(() => {
    let cancelled = false;
    listStandardPacks({ workspaceId })
      .then((res) => {
        if (!cancelled && res.packs?.length > 0) {
          setAvailablePacks(res.packs);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const updateStandards = (patch: Partial<StandardsForm>) => {
    const next = { ...form, ...patch };
    updateProject((current) => ({
      ...current,
      agent: {
        ...current.agent,
        options: {
          ...(current.agent.options || {}),
          standards: fromStandardsForm(next),
        },
      },
    }));
  };

  const handleDetect = async () => {
    if (!workspaceId) return;
    setDetecting(true);
    setStatusMessage(null);
    try {
      const res = await detectWorkspaceTechStack(workspaceId);
      const recommended = res.detectedStacks?.recommendedPacks || [];
      const newActive = Array.from(new Set([...form.active_packs, ...recommended]));
      updateStandards({ active_packs: newActive });
      setStatusMessage({
        tone: 'success',
        text: `已识别技术栈: ${res.detectedStacks?.languages?.join(', ') || '通用'}，已自动激活推荐规范: ${recommended.join(', ')}`,
      });
    } catch (err: any) {
      setStatusMessage({ tone: 'error', text: `技术栈识别失败: ${err.message}` });
    } finally {
      setDetecting(false);
    }
  };

  const handleMaterialize = async () => {
    if (!workspaceId) return;
    setMaterializing(true);
    setStatusMessage(null);
    try {
      const res = await materializeWorkspaceStandards(workspaceId);
      const fileSummaries = res.files.map((f) => `${f.targetFile} (${f.action})`).join(', ');
      setStatusMessage({
        tone: 'success',
        text: `规范材料化完成: ${fileSummaries} (~${res.totalRules} 条规则, 约 ${res.tokenEstimate} Tokens)`,
      });
    } catch (err: any) {
      setStatusMessage({ tone: 'error', text: `规范材料化失败: ${err.message}` });
    } finally {
      setMaterializing(false);
    }
  };

  return {
    form,
    detecting,
    materializing,
    statusMessage,
    availablePacks,
    updateStandards,
    handleDetect,
    handleMaterialize,
  };
}

export function StandardsSection(props: StandardsSectionProps) {
  const {
    form,
    detecting,
    materializing,
    statusMessage,
    availablePacks,
    updateStandards,
    handleDetect,
    handleMaterialize,
  } = useStandardsSectionState(props);

  return (
    <section className="space-y-4">
      <StandardsHeader
        detecting={detecting}
        materializing={materializing}
        onDetect={handleDetect}
        onMaterialize={handleMaterialize}
      />

      {statusMessage && <StandardsStatusBanner status={statusMessage} />}

      <StandardsControls form={form} onChange={updateStandards} />

      <StandardsTargetFiles selectedFiles={form.target_files} onChange={(files) => updateStandards({ target_files: files })} />

      <StandardsPacksGrid
        availablePacks={availablePacks}
        activePacks={form.active_packs}
        onTogglePack={(packId) => {
          const next = new Set(form.active_packs);
          if (next.has(packId)) next.delete(packId);
          else next.add(packId);
          updateStandards({ active_packs: Array.from(next) });
        }}
      />

      <StandardsCustomRulesInput
        customRules={form.custom_rules}
        onChange={(val) => updateStandards({ custom_rules: val })}
      />
    </section>
  );
}

function StandardsHeader({
  detecting,
  materializing,
  onDetect,
  onMaterialize,
}: {
  detecting: boolean;
  materializing: boolean;
  onDetect: () => void;
  onMaterialize: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-sm font-semibold text-slate-950 dark:text-white">编码规范层 (Workspace Standards)</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          自动将工程规范注入 AGENTS.md / CLAUDE.md 等目标文件，非破坏性共存用户已有指令。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onDetect} disabled={detecting}>
          <Sparkles size={14} className={detecting ? 'animate-spin' : ''} />
          {detecting ? '识别中...' : '识别技术栈'}
        </Button>
        <Button size="sm" variant="secondary" onClick={onMaterialize} disabled={materializing}>
          <RefreshCw size={14} className={materializing ? 'animate-spin' : ''} />
          {materializing ? '同步中...' : '立即同步规范'}
        </Button>
      </div>
    </div>
  );
}

function StandardsStatusBanner({ status }: { status: { tone: 'success' | 'error'; text: string } }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
        status.tone === 'success'
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
          : 'border-rose-500/20 bg-rose-500/10 text-rose-400'
      }`}
    >
      {status.tone === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
      <span>{status.text}</span>
    </div>
  );
}

function StandardsControls({
  form,
  onChange,
}: {
  form: StandardsForm;
  onChange: (patch: Partial<StandardsForm>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Select
        label="规范启用状态"
        value={form.enabled ? 'true' : 'false'}
        onChange={(e) => onChange({ enabled: e.target.value === 'true' })}
      >
        <option value="true">启用规范注入 (Enabled)</option>
        <option value="false">停用规范注入 (Disabled)</option>
      </Select>

      <Select
        label="规范注入强度 (Ponytail Intensity)"
        value={form.intensity}
        onChange={(e) => onChange({ intensity: e.target.value as StandardsForm['intensity'] })}
      >
        <option value="full">full — 完整规范与决策阶梯 (默认推荐)</option>
        <option value="lite">lite — 核心原则与不可妥协安全红线</option>
        <option value="ultra">ultra — 严苛模式 (企业合规与全量 AST 审计)</option>
        <option value="off">off — 关闭规范 (清理标记块)</option>
      </Select>
    </div>
  );
}

function StandardsTargetFiles({
  selectedFiles,
  onChange,
}: {
  selectedFiles: string[];
  onChange: (files: string[]) => void;
}) {
  const toggleFile = (file: string) => {
    const next = new Set(selectedFiles);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    onChange(Array.from(next));
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        同步目标文件 (Target Files)
      </label>
      <div className="flex flex-wrap gap-2">
        {['AGENTS.md', 'CLAUDE.md', '.cursorrules'].map((file) => {
          const isChecked = selectedFiles.includes(file);
          return (
            <button
              key={file}
              type="button"
              onClick={() => toggleFile(file)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                isChecked
                  ? 'border-primary bg-primary/10 text-primary dark:border-[#42ff9c]/30 dark:bg-[#42ff9c]/10 dark:text-[#42ff9c]'
                  : 'border-black/10 bg-transparent text-muted-foreground hover:bg-black/5 dark:border-white/[0.08] dark:hover:bg-white/5'
              }`}
            >
              <FileText size={12} />
              <span>{file}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StandardsPacksGrid({
  availablePacks,
  activePacks,
  onTogglePack,
}: {
  availablePacks: StandardPackInfo[];
  activePacks: string[];
  onTogglePack: (packId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        激活规范包 (Standard Packs)
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {availablePacks.map((pack) => {
          const isActive = activePacks.includes(pack.id);
          return (
            <div
              key={pack.id}
              onClick={() => onTogglePack(pack.id)}
              className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                isActive
                  ? 'border-primary bg-primary/5 dark:border-[#42ff9c]/30 dark:bg-[#42ff9c]/5'
                  : 'border-black/10 bg-transparent opacity-70 hover:opacity-100 dark:border-white/[0.08]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-950 dark:text-white">{pack.name}</div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    isActive
                      ? 'bg-primary/20 text-primary dark:bg-[#42ff9c]/20 dark:text-[#42ff9c]'
                      : 'bg-black/5 text-muted-foreground dark:bg-white/5'
                  }`}
                >
                  {isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{pack.description}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StandardsCustomRulesInput({
  customRules,
  onChange,
}: {
  customRules: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        自定义规则 (Custom Markdown Rules)
      </label>
      <textarea
        rows={4}
        value={customRules}
        onChange={(e) => onChange(e.target.value)}
        placeholder="可输入项目特有的规范内容。支持 <important if=&quot;...&quot;> 条件语法。"
        className="w-full rounded-xl border border-black/10 bg-transparent p-3 font-mono text-xs text-slate-950 focus:border-primary focus:outline-none dark:border-white/[0.08] dark:text-white dark:focus:border-[#42ff9c]"
      />
      <p className="text-[11px] text-muted-foreground">
        注意: AgentDock 采用非破坏性标记块 <code>&lt;!-- agentdock:standards:start --&gt;</code>，外部手写内容永久 100% 保持原样。
      </p>
    </div>
  );
}
