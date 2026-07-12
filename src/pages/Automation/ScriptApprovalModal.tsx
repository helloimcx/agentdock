import { useState } from 'react';
import {
  approveAutomationScriptVersion,
  executeAutomationScriptTest,
  rejectAutomationScriptVersion,
  requestAutomationScriptEnableApproval,
  revokeAutomationScriptVersion,
} from '@cc/core-sdk/automations';
import type { AutomationScriptVersion } from '@cc/superai-contracts/automations';
import { Button, Input, Modal } from '@/components/ui';
import { approvalActionForVersion } from './automation-page-model';

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
  const approvalId = version.status === 'pending_test_approval' ? version.pendingTestApprovalId : version.pendingApprovalId;
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
  const reject = approvalId ? () => run(() => rejectAutomationScriptVersion(version.id, workspaceId, approvalId, actor.trim())) : undefined;

  return (
    <Modal open={open} onClose={onClose} title="Script approval">
      <div className="space-y-4 text-sm">
        <p><strong>Version:</strong> {version.id}</p>
        <p><strong>Status:</strong> {version.status}</p>
        <p className="text-xs text-gray-500">The server validates the version, pending approval ID, and actor for every action.</p>
        <Input label="Approver" value={actor} onChange={(event) => setActor(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          {action === 'authorize-test' && approvalId && <Button loading={submitting} onClick={() => void run(() => approveAutomationScriptVersion(version.id, workspaceId, approvalId, actor.trim()))}>Authorize test</Button>}
          {action === 'run-test' && <Button loading={submitting} onClick={() => void run(() => executeAutomationScriptTest(version.id, workspaceId, actor.trim()))}>Run sandbox test</Button>}
          {action === 'request-enable' && <Button loading={submitting} onClick={() => void run(() => requestAutomationScriptEnableApproval(version.id, workspaceId, actor.trim()))}>Request enable approval</Button>}
          {action === 'approve-enable' && approvalId && <Button loading={submitting} onClick={() => void run(() => approveAutomationScriptVersion(version.id, workspaceId, approvalId, actor.trim()))}>Approve & enable</Button>}
          {action === 'revoke' && <Button variant="danger" loading={submitting} onClick={() => void run(() => revokeAutomationScriptVersion(version.id, workspaceId, actor.trim()))}>Revoke</Button>}
          {reject && <Button variant="secondary" loading={submitting} onClick={() => void reject()}>Reject</Button>}
        </div>
      </div>
    </Modal>
  );
}
