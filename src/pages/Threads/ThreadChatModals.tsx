import { Button, Input, Modal } from '@/components/ui';
import type { ThreadActionTarget } from './thread-chat-model';

interface ThreadChatModalsProps {
  deleteTarget: ThreadActionTarget | null;
  pendingSessionAction: 'rename' | 'delete' | null;
  renameDraft: string;
  renameTarget: ThreadActionTarget | null;
  onDeleteSession: () => void;
  onRenameSession: () => void;
  setDeleteTarget: (target: ThreadActionTarget | null) => void;
  setRenameDraft: (draft: string) => void;
  setRenameTarget: (target: ThreadActionTarget | null) => void;
}

export function ThreadChatModals({
  deleteTarget,
  pendingSessionAction,
  renameDraft,
  renameTarget,
  onDeleteSession,
  onRenameSession,
  setDeleteTarget,
  setRenameDraft,
  setRenameTarget,
}: ThreadChatModalsProps) {
  return (
    <>
      <Modal open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} title="重命名会话">
        <div className="space-y-4">
          <Input
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onInput={(event) => setRenameDraft((event.target as HTMLInputElement).value)}
            placeholder="输入会话名称"
            data-testid="desktop-chat-rename-input"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameTarget(null)} data-testid="desktop-chat-rename-cancel">
              取消
            </Button>
            <Button
              onClick={() => void onRenameSession()}
              loading={pendingSessionAction === 'rename'}
              disabled={!renameDraft.trim()}
              data-testid="desktop-chat-rename-save"
            >
              保存名称
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="删除会话">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            确定删除 <span className="font-medium text-gray-900 dark:text-white">{deleteTarget?.name}</span> 吗？这会移除该会话的本地保存记录。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} data-testid="desktop-chat-delete-cancel">
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => void onDeleteSession()}
              loading={pendingSessionAction === 'delete'}
              data-testid="desktop-chat-delete-confirm"
            >
              删除会话
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
