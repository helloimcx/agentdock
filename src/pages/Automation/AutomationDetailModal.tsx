import { useEffect, useState } from 'react';
import { listAutomationEvaluations, listAutomationRuns, listAutomationScriptVersions } from '@cc/core-sdk/automations';
import type { AutomationDefinition, AutomationEvaluation, AutomationRun, AutomationScriptVersion } from '@cc/superai-contracts/automations';
import { Badge, Button, Modal } from '@/components/ui';
import { formatEvaluation, formatRun, redactSecretName } from './automation-page-model';
import ScriptApprovalModal from './ScriptApprovalModal';

type Props = { automation: AutomationDefinition | null; onClose: () => void; onChanged: () => Promise<void> | void };

export default function AutomationDetailModal({ automation, onClose, onChanged }: Props) {
  const [evaluations, setEvaluations] = useState<AutomationEvaluation[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [version, setVersion] = useState<AutomationScriptVersion | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const load = async () => {
    if (!automation) return;
    const [evaluationData, runData] = await Promise.all([
      listAutomationEvaluations(automation.id, automation.workspaceId),
      listAutomationRuns(automation.id, automation.workspaceId),
    ]);
    setEvaluations(evaluationData.evaluations);
    setRuns(runData.runs);
    const condition = automation.condition;
    if (condition.kind === 'approved-script') {
      const versions = await listAutomationScriptVersions(condition.scriptId, automation.workspaceId);
      setVersion(versions.versions.find((candidate) => candidate.id === condition.approvedVersionId) || null);
    } else setVersion(null);
  };
  useEffect(() => { void load(); }, [automation?.id]); // selected definition is refreshed by the parent.
  if (!automation) return null;
  return (
    <>
      <Modal open onClose={onClose} title={automation.title} className="sm:max-w-2xl">
        <div className="space-y-4 text-sm">
          {automation.health === 'blocked' && <p className="rounded-md bg-red-50 p-3 text-red-700 dark:bg-red-950/30 dark:text-red-200">Blocked: {automation.blockedReason || 'Automation is unavailable.'} No fallback will run.</p>}
          <section><h3 className="font-medium">Definition</h3><p>Activation: {automation.activation.kind} · Condition: {automation.condition.kind} · Workspace: {automation.workspaceId}</p></section>
          {version && <section className="space-y-1"><h3 className="font-medium">Approved script (read-only)</h3><p>Hash: <code>{version.packageSha256}</code></p><p>Interpreter: {version.interpreterPath} ({version.interpreterVersion})</p><p>Permissions: network {version.networkMode}; internal access {version.internalAccess ? 'allowed' : 'denied'}; read directories {version.allowedReadDirs.length}</p><p>Secrets: {version.secretRefs.length ? version.secretRefs.map(redactSecretName).join(', ') : 'none'}</p>{version.networkMode === 'public' && <p className="text-amber-700 dark:text-amber-200">Public-network access is enabled. Private destinations remain denied.</p>}<p>Test plan: {JSON.stringify(version.testPlan)}</p>{version.testReport && <p>Test report: {JSON.stringify(version.testReport)}</p>}<div><Badge variant={version.status === 'approved' ? 'success' : 'warning'}>{version.status}</Badge> <Button size="sm" variant="secondary" onClick={() => setApprovalOpen(true)}>Approval</Button></div></section>}
          <section><h3 className="font-medium">Recent evaluations</h3>{evaluations.length ? evaluations.slice(0, 5).map((evaluation) => <p key={evaluation.id}>{formatEvaluation(evaluation)} · {evaluation.finishedAt || evaluation.startedAt}</p>) : <p>—</p>}</section>
          <section><h3 className="font-medium">Recent runs</h3>{runs.length ? runs.slice(0, 5).map((run) => <p key={run.id}>{formatRun(run)} · {run.finishedAt || run.createdAt}</p>) : <p>—</p>}</section>
        </div>
      </Modal>
      <ScriptApprovalModal open={approvalOpen} version={version} workspaceId={automation.workspaceId} onClose={() => setApprovalOpen(false)} onChanged={async () => { await load(); await onChanged(); }} />
    </>
  );
}
