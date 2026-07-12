import { useState } from 'react';
import {
  approveAutomationScriptVersion,
  executeAutomationScriptTest,
  rejectAutomationScriptVersion,
  requestAutomationScriptEnableApproval,
  revokeAutomationScriptVersion,
} from '@cc/core-sdk/automations';
import { resolveApprovalRequest } from '@cc/core-sdk/runtime';
import type { AutomationScriptVersion } from '@cc/superai-contracts/automations';
import { Button, Input, Modal } from '@/components/ui';
import { approvalActionForVersion, approvalResolutionForVersion, type ApprovalDecision } from './automation-page-model';

type Props = {
  open: boolean;
  version: AutomationScriptVersion | null;
  workspaceId: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
};

/** Approval controls intentionally use only server-issued pending approval IDs. */
export default function ScriptApprovalModal({ open, version, workspaceId, onClose, onChanged }: Props) {
  const [actor, setActor] = useState('desktop-user');
  const [submitting, setSubmitting] = useState(false);
  if (!version) return null;
  const action = approvalActionForVersion(version);
  const run = async (operation: () => Promise<unknown>) => {
    setSubmitting(true);
    try {
      await operation();
      await onChanged();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };
  const resolveAndApply = (decision: ApprovalDecision) => {
    const resolution = approvalResolutionForVersion(version, decision);
    if (!resolution) return;
    return run(async () => {
      const resolvedBy = actor.trim();
      await resolveApprovalRequest(resolution.approvalId, {
        status: resolution.decision,
        resolvedBy,
        resolution: `Automation script ${resolution.decision} in desktop UI.`,
      });
      if (resolution.decision === 'approved') {
        await approveAutomationScriptVersion(version.id, workspaceId, resolution.approvalId, resolvedBy);
      } else {
        await rejectAutomationScriptVersion(version.id, workspaceId, resolution.approvalId, resolvedBy);
      }
    });
  };
  const canResolve = Boolean(approvalResolutionForVersion(version, 'approved'));

  return (
    <Modal open={open} onClose={onClose} title="Script approval">
      <div className="space-y-4 text-sm">
        <p><strong>Version:</strong> {version.id}</p>
        <p><strong>Status:</strong> {version.status}</p>
        <p className="text-xs text-gray-500">The server validates the version, pending approval ID, and actor for every action.</p>
        <Input label="Approver" value={actor} onChange={(event) => setActor(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          {action === 'authorize-test' && canResolve && <Button loading={submitting} onClick={() => void resolveAndApply('approved')}>Authorize test</Button>}
          {action === 'run-test' && <Button loading={submitting} onClick={() => void run(() => executeAutomationScriptTest(version.id, workspaceId, actor.trim()))}>Run sandbox test</Button>}
          {action === 'request-enable' && <Button loading={submitting} onClick={() => void run(() => requestAutomationScriptEnableApproval(version.id, workspaceId, actor.trim()))}>Request enable approval</Button>}
          {action === 'approve-enable' && canResolve && <Button loading={submitting} onClick={() => void resolveAndApply('approved')}>Approve & enable</Button>}
          {action === 'revoke' && <Button variant="danger" loading={submitting} onClick={() => void run(() => revokeAutomationScriptVersion(version.id, workspaceId, actor.trim()))}>Revoke</Button>}
          {canResolve && <Button variant="secondary" loading={submitting} onClick={() => void resolveAndApply('rejected')}>Reject</Button>}
        </div>
      </div>
    </Modal>
  );
}
