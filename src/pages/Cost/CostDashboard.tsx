import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Calendar,
  Coins,
  Cpu,
  Layers,
  Plus,
  RefreshCw,
  Sliders,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { costs as costsApi, budgets as budgetsApi } from '@cc/core-sdk';
import type {
  Budget,
  BudgetAction,
  BudgetCreateInput,
  BudgetPeriodKind,
  BudgetScopeKind,
  BudgetUpdateInput,
  CostDimensionSummary,
  CostSummary,
  TopExpensiveRun,
} from '@cc/superai-contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  StatCard,
  StatusPill,
} from '@/components/ui';
import { RunTimelineDrawer } from '@/components/traces/RunTimelineDrawer';
import { cn } from '@/lib/utils';

type DimensionTab = 'agents' | 'sources' | 'models' | 'providers';

const PERIOD_LABELS: Record<string, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
};

const ACTION_LABELS: Record<string, string> = {
  alert_and_skip: '超支跳过',
  alert_and_kill: '超支强杀',
  alert: '仅告警',
};

function getBudgetVisualState(b: Budget, spend: number, limit: number) {
  if (b.status === 'hard_exceeded' || spend >= limit * b.hardThreshold) {
    return { tone: 'danger' as const, text: '超支硬阻断', barClass: 'bg-red-500', cardClass: 'border-red-500/50 bg-red-500/5' };
  }
  if (b.status === 'soft_warning' || spend >= limit * b.softThreshold) {
    return { tone: 'warning' as const, text: '接近上限', barClass: 'bg-amber-500', cardClass: 'border-amber-500/50 bg-amber-500/5' };
  }
  return { tone: 'success' as const, text: '额度充足', barClass: 'bg-emerald-500', cardClass: 'border-border bg-card' };
}

function BudgetCardItem({
  budget: b,
  onEdit,
  onDelete,
}: {
  budget: Budget;
  onEdit: (b: Budget) => void;
  onDelete: (b: Budget) => void;
}) {
  const spend = b.currentSpendUsd || 0;
  const limit = b.limitUsd || 1;
  const percent = Math.min(100, Math.round((spend / limit) * 100));
  const visual = getBudgetVisualState(b, spend, limit);

  return (
    <div className={cn('relative flex flex-col justify-between rounded-lg border p-4 shadow-xs transition-all', visual.cardClass)}>
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground">{b.name}</span>
            {!b.enabled && <Badge variant="outline">已禁用</Badge>}
          </div>
          <StatusPill tone={visual.tone}>{visual.text}</StatusPill>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          <Badge variant="secondary">{PERIOD_LABELS[b.periodKind] || b.periodKind}</Badge>
          <Badge variant="outline">{`作用域: ${b.scopeKind}${b.scopeId ? ` (${b.scopeId})` : ''}`}</Badge>
          <Badge variant="outline">{`动作: ${ACTION_LABELS[b.action || 'alert'] || b.action}`}</Badge>
        </div>

        <div className="mt-4 space-y-1.5">
          <div className="flex justify-between text-xs font-medium">
            <span>已用: ${spend.toFixed(4)}</span>
            <span className="text-muted-foreground font-normal">上限: ${limit.toFixed(2)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full transition-all', visual.barClass)} style={{ width: `${percent}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>告警线: {(b.softThreshold * 100).toFixed(0)}%</span>
            <span>硬阻断线: {(b.hardThreshold * 100).toFixed(0)}% ({percent}%)</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
        <Button variant="outline" size="sm" onClick={() => onEdit(b)}>
          编辑
        </Button>
        <Button variant="outline" size="sm" onClick={() => onDelete(b)} className="text-red-500 hover:text-red-600">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function CostStatCards({ summary }: { summary: CostSummary | null }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label={t('costs.todayCost', '今日花费 (Today)')}
        value={`$${(summary?.todayCostUsd || 0).toFixed(4)}`}
        accent
      />
      <StatCard
        label={t('costs.weekCost', '本周花费 (This Week)')}
        value={`$${(summary?.weekCostUsd || 0).toFixed(4)}`}
      />
      <StatCard
        label={t('costs.monthCost', '本月花费 (This Month)')}
        value={`$${(summary?.monthCostUsd || 0).toFixed(4)}`}
      />
      <StatCard
        label={t('costs.totalTokens', '总消耗 Token')}
        value={(summary?.totalTokens || 0).toLocaleString()}
      />
    </div>
  );
}

function ActiveBudgetsSection({
  budgets,
  onOpenCreate,
  onEdit,
  onDelete,
}: {
  budgets: Budget[];
  onOpenCreate: () => void;
  onEdit: (b: Budget) => void;
  onDelete: (b: Budget) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Sliders className="h-4 w-4 text-primary" />
            {t('costs.activeBudgets', '预算管控与硬约束规则 (Active Budgets)')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('costs.activeBudgetsDesc', '设置软告警阈值与硬中断上限；达到上限时自动阻断定时/监控/自动化任务（Preflight Skip）或中途强杀（Kill）。')}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onOpenCreate} className="gap-1">
          <Plus className="h-3.5 w-3.5" />
          添加策略
        </Button>
      </CardHeader>
      <CardContent>
        {budgets.length === 0 ? (
          <EmptyState
            message={t('costs.emptyBudgets', '暂未配置预算策略。点击右上角「添加策略」配置工作区、Agent 或自动化任务的预算上限与告警规则。')}
            icon={Sliders}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {budgets.map((b) => (
              <BudgetCardItem
                key={b.id}
                budget={b}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CostDimensionPanel({
  summary,
  activeTab,
  onTabChange,
}: {
  summary: CostSummary | null;
  activeTab: DimensionTab;
  onTabChange: (tab: DimensionTab) => void;
}) {
  const { t } = useTranslation();
  const getList = (): CostDimensionSummary[] => {
    if (!summary) return [];
    if (activeTab === 'agents') return summary.byAgent || [];
    if (activeTab === 'sources') return summary.bySourceKind || [];
    if (activeTab === 'models') return summary.byModel || [];
    return summary.byProvider || [];
  };

  const list = getList();
  const total = summary?.totalCostUsd || 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4 text-indigo-500" />
            {t('costs.breakdown', '多维度成本归集 (Cost Breakdown)')}
          </CardTitle>
          <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 text-xs">
            {(['agents', 'sources', 'models', 'providers'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab)}
                className={cn(
                  'rounded-md px-2.5 py-1 font-medium transition-colors',
                  activeTab === tab ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab === 'agents' ? 'Agent' : tab === 'sources' ? '触发源' : tab === 'models' ? '模型' : 'Provider'}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">{t('costs.emptyBreakdown', '暂无归集统计数据')}</div>
        ) : (
          <div className="space-y-3">
            {list.map((item) => {
              const percent = total > 0 ? Math.round((item.costUsd / total) * 100) : 0;
              return (
                <div key={item.name} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      <span className="font-mono">{item.name}</span>
                      <span className="text-[11px] text-muted-foreground font-normal">({item.runCount} 次运行)</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">{item.tokensTotal.toLocaleString()} tokens</span>
                      <span className="font-semibold text-foreground">${item.costUsd.toFixed(4)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TopRunsPanel({
  runs,
  onViewTrace,
}: {
  runs: TopExpensiveRun[];
  onViewTrace: (runId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-500" />
          {t('costs.topRuns', '单次最高花费运行 (Top Expensive Runs)')}
        </CardTitle>
        <CardDescription className="text-xs">
          {t('costs.topRunsDesc', '找出最消耗预算的 ACP 执行记录，点击可直接查看详细 Timeline 轨迹图。')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">{t('costs.emptyTopRuns', '暂无运行记录')}</div>
        ) : (
          <div className="divide-y text-xs">
            {runs.map((run) => (
              <div key={run.runId} className="flex items-center justify-between py-2.5">
                <div className="space-y-0.5 max-w-[65%]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground truncate">{run.title || run.runId}</span>
                    <Badge variant="outline">{run.agentType}</Badge>
                    <Badge variant="secondary">{run.sourceKind}</Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {run.tokensTotal.toLocaleString()} tokens (In: {run.tokensIn.toLocaleString()} / Out: {run.tokensOut.toLocaleString()})
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="font-bold text-foreground">${run.costUsd.toFixed(4)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(run.recordedAt).toLocaleTimeString()}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onViewTrace(run.runId)}
                    className="text-xs h-7 px-2"
                  >
                    {t('costs.trace', '轨迹')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetModalForm({
  open,
  editingBudget,
  modalForm,
  setModalForm,
  onClose,
  onSave,
}: {
  open: boolean;
  editingBudget: Budget | null;
  modalForm: BudgetCreateInput;
  setModalForm: React.Dispatch<React.SetStateAction<BudgetCreateInput>>;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingBudget ? t('costs.editBudget', '编辑预算策略') : t('costs.createBudget', '新建预算策略')}
    >
      <div className="space-y-4 py-2 text-xs">
        <div>
          <label className="block font-medium text-foreground mb-1">策略名称</label>
          <Input
            value={modalForm.name}
            onChange={(e) => setModalForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="例如：每日自动化额度上限"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="监控周期"
            value={modalForm.periodKind}
            onChange={(e) => setModalForm((prev) => ({ ...prev, periodKind: e.target.value as BudgetPeriodKind }))}
          >
            <option value="daily">每日 (Daily)</option>
            <option value="weekly">每周 (Weekly)</option>
            <option value="monthly">每月 (Monthly)</option>
          </Select>
          <div>
            <label className="block font-medium text-foreground mb-1">预算限额 (USD $)</label>
            <Input
              type="number"
              step="0.1"
              min="0.01"
              value={modalForm.limitUsd}
              onChange={(e) => setModalForm((prev) => ({ ...prev, limitUsd: Number(e.target.value) }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="作用域类别"
            value={modalForm.scopeKind}
            onChange={(e) => setModalForm((prev) => ({ ...prev, scopeKind: e.target.value as BudgetScopeKind }))}
          >
            <option value="global">全局 (Global)</option>
            <option value="workspace">当前工作区 (Workspace)</option>
            <option value="agent">指定 Agent</option>
            <option value="channel">指定渠道 (Channel)</option>
            <option value="automation">指定自动化任务 (Automation)</option>
          </Select>
          <div>
            <label className="block font-medium text-foreground mb-1">作用域标识 (可选)</label>
            <Input
              value={modalForm.scopeId || ''}
              onChange={(e) => setModalForm((prev) => ({ ...prev, scopeId: e.target.value }))}
              placeholder="Agent名 / Channel ID / 任务 ID"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="触达硬上限动作"
            value={modalForm.action || 'alert_and_skip'}
            onChange={(e) => setModalForm((prev) => ({ ...prev, action: e.target.value as BudgetAction }))}
          >
            <option value="alert">仅发出告警 (Alert)</option>
            <option value="alert_and_skip">告警并在 Preflight 跳过执行 (Alert & Skip)</option>
            <option value="alert_and_kill">告警、跳过并强杀运行中 Run (Alert & Kill)</option>
          </Select>
          <div>
            <label className="block font-medium text-foreground mb-1">软告警线 / 硬阻断线</label>
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                type="number"
                step="0.05"
                min="0.1"
                max="1.0"
                value={modalForm.softThreshold}
                onChange={(e) => setModalForm((prev) => ({ ...prev, softThreshold: Number(e.target.value) }))}
                placeholder="0.8"
              />
              <Input
                type="number"
                step="0.05"
                min="0.1"
                max="2.0"
                value={modalForm.hardThreshold}
                onChange={(e) => setModalForm((prev) => ({ ...prev, hardThreshold: Number(e.target.value) }))}
                placeholder="1.0"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            {t('costs.cancel', '取消')}
          </Button>
          <Button onClick={onSave}>
            {t('costs.saveBudget', '保存策略')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteConfirmModal({
  target,
  onClose,
  onConfirm,
}: {
  target: Budget | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={t('costs.deleteConfirmTitle', '确认删除预算策略')}
    >
      <div className="space-y-4 py-2 text-xs">
        <p className="text-muted-foreground">
          {t('costs.deleteConfirmDesc', '确定要删除该预算策略吗？删除后将停止对该范围的预算硬阻断与告警检查。')}
        </p>
        <div className="rounded-md border bg-muted/40 p-2.5 font-medium text-foreground">
          {target?.name} (${target?.limitUsd} / {target?.periodKind})
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            {t('costs.cancel', '取消')}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t('common.remove', '删除')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function useCostDashboardData() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [topRuns, setTopRuns] = useState<TopExpensiveRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [deletingBudget, setDeletingBudget] = useState<Budget | null>(null);
  const [modalForm, setModalForm] = useState<BudgetCreateInput>({
    workspaceId: 'default',
    name: '',
    scopeKind: 'workspace',
    scopeId: '',
    periodKind: 'daily',
    limitUsd: 5.0,
    softThreshold: 0.8,
    hardThreshold: 1.0,
    action: 'alert_and_skip',
    enabled: true,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumData, budgetData, topRunData] = await Promise.all([
        costsApi.getCostSummary(),
        budgetsApi.listBudgets(),
        costsApi.getTopExpensiveRuns(undefined, 10),
      ]);
      setSummary(sumData);
      setBudgets(budgetData.budgets || []);
      setTopRuns(topRunData.runs || []);
    } catch (err) {
      console.error('Failed to load cost & budget data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const openCreateModal = () => {
    setEditingBudget(null);
    setModalForm({
      workspaceId: 'default',
      name: '',
      scopeKind: 'workspace',
      scopeId: '',
      periodKind: 'daily',
      limitUsd: 5.0,
      softThreshold: 0.8,
      hardThreshold: 1.0,
      action: 'alert_and_skip',
      enabled: true,
    });
    setBudgetModalOpen(true);
  };

  const openEditModal = (b: Budget) => {
    setEditingBudget(b);
    setModalForm({
      workspaceId: b.workspaceId,
      name: b.name,
      scopeKind: b.scopeKind,
      scopeId: b.scopeId || '',
      periodKind: b.periodKind,
      limitUsd: b.limitUsd,
      softThreshold: b.softThreshold,
      hardThreshold: b.hardThreshold,
      action: b.action,
      enabled: b.enabled,
    });
    setBudgetModalOpen(true);
  };

  const saveBudget = async () => {
    if (!modalForm.name || !modalForm.limitUsd) return;
    try {
      if (editingBudget) {
        await budgetsApi.updateBudget(editingBudget.id, modalForm as BudgetUpdateInput);
      } else {
        await budgetsApi.createBudget(modalForm);
      }
      setBudgetModalOpen(false);
      await fetchData();
    } catch (err) {
      console.error('Failed to save budget:', err);
    }
  };

  const confirmDelete = async () => {
    if (!deletingBudget) return;
    try {
      await budgetsApi.deleteBudget(deletingBudget.id);
      setDeletingBudget(null);
      await fetchData();
    } catch (err) {
      console.error('Failed to delete budget:', err);
    }
  };

  return {
    summary,
    budgets,
    topRuns,
    loading,
    budgetModalOpen,
    setBudgetModalOpen,
    editingBudget,
    deletingBudget,
    setDeletingBudget,
    modalForm,
    setModalForm,
    fetchData,
    openCreateModal,
    openEditModal,
    saveBudget,
    confirmDelete,
  };
}

export default function CostDashboard() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<DimensionTab>('agents');
  const [traceRunId, setTraceRunId] = useState<string | null>(null);
  const {
    summary,
    budgets,
    topRuns,
    loading,
    budgetModalOpen,
    setBudgetModalOpen,
    editingBudget,
    deletingBudget,
    setDeletingBudget,
    modalForm,
    setModalForm,
    fetchData,
    openCreateModal,
    openEditModal,
    saveBudget,
    confirmDelete,
  } = useCostDashboardData();

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('costs.title', '成本与预算治理 (Cost & Budgets)')}
        description={t('costs.description', '多维度 Token 用量归集与自动化任务预算硬约束，避免无监督运行产生意外高额花费。')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              {t('costs.refresh', '刷新数据')}
            </Button>
            <Button size="sm" onClick={openCreateModal} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {t('costs.createBudget', '新建预算策略')}
            </Button>
          </div>
        }
      />

      <CostStatCards summary={summary} />

      <ActiveBudgetsSection
        budgets={budgets}
        onOpenCreate={openCreateModal}
        onEdit={openEditModal}
        onDelete={setDeletingBudget}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CostDimensionPanel summary={summary} activeTab={activeTab} onTabChange={setActiveTab} />
        <TopRunsPanel runs={topRuns} onViewTrace={setTraceRunId} />
      </div>

      <BudgetModalForm
        open={budgetModalOpen}
        editingBudget={editingBudget}
        modalForm={modalForm}
        setModalForm={setModalForm}
        onClose={() => setBudgetModalOpen(false)}
        onSave={saveBudget}
      />

      <DeleteConfirmModal
        target={deletingBudget}
        onClose={() => setDeletingBudget(null)}
        onConfirm={confirmDelete}
      />

      <RunTimelineDrawer open={Boolean(traceRunId)} onClose={() => setTraceRunId(null)} runId={traceRunId} />
    </div>
  );
}
