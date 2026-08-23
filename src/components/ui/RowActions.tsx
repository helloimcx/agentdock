import { Pencil, Play, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';

interface RowActionLabels {
  run: string;
  edit: string;
  delete: string;
}

interface RowActionsProps {
  labels: RowActionLabels;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  className?: string;
}

export function RowActions({ labels, onRun, onEdit, onDelete, className }: RowActionsProps) {
  return (
    <div className={cn('flex shrink-0 gap-2', className)}>
      <Button variant="secondary" size="sm" className="app-icon-button" onClick={onRun} title={labels.run} aria-label={labels.run}>
        <Play size={14} />
      </Button>
      <Button variant="secondary" size="sm" className="app-icon-button" onClick={onEdit} title={labels.edit} aria-label={labels.edit}>
        <Pencil size={14} />
      </Button>
      <Button variant="danger" size="sm" className="app-icon-button" onClick={onDelete} title={labels.delete} aria-label={labels.delete}>
        <Trash2 size={14} />
      </Button>
    </div>
  );
}
