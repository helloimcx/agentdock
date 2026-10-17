import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { runtime, type DirectoryListingResult } from '@cc/core-sdk';
import {
  Folder,
  FolderUp,
  Search,
  Check,
  Loader2,
  RefreshCw,
  AlertCircle,
  HardDrive,
  Laptop,
} from 'lucide-react';

export interface DirectoryPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (selectedPath: string) => void;
  initialPath?: string;
  deviceId?: string;
  deviceLabel?: string;
}

function computeChildPath(currentPath: string, child: string, isRemote: boolean): string {
  if (isRemote) {
    return currentPath === '.' || !currentPath ? child : `${currentPath}/${child}`;
  }
  const isWindows = /^[A-Za-z]:[\\/]/.test(currentPath) || currentPath.includes('\\');
  const sep = isWindows ? '\\' : '/';
  if (currentPath === '/' || currentPath === '\\') {
    return `${sep}${child}`;
  }
  return `${currentPath.replace(/[/\\]+$/, '')}${sep}${child}`;
}

function computeInitialStartPath(initialPath: string | undefined, isRemote: boolean): string {
  const trimmed = initialPath?.trim() || '';
  if (isRemote && (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed))) {
    return '.';
  }
  return trimmed;
}

function DeviceBanner({
  isRemote,
  deviceLabel,
  deviceId,
}: {
  isRemote: boolean;
  deviceLabel?: string;
  deviceId?: string;
}) {
  const displayName = isRemote ? deviceLabel || deviceId : '本机 (Local Server)';
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
      {isRemote ? <Laptop size={14} className="text-primary" /> : <HardDrive size={14} className="text-primary" />}
      <span>
        设备: <strong className="text-foreground font-medium">{displayName}</strong>
      </span>
      {isRemote && (
        <span className="ml-auto text-[11px] text-muted-foreground">
          (在远程节点受控根目录内浏览)
        </span>
      )}
    </div>
  );
}

function PathNavigationForm({
  pathInput,
  setPathInput,
  parentPath,
  loading,
  isRemote,
  onNavigateUp,
  onRefresh,
  onSubmit,
}: {
  pathInput: string;
  setPathInput: (val: string) => void;
  parentPath: string | null;
  loading: boolean;
  isRemote: boolean;
  onNavigateUp: () => void;
  onRefresh: () => void;
  onSubmit: (path: string) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (pathInput.trim()) onSubmit(pathInput.trim());
      }}
      className="flex items-center gap-2"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onNavigateUp}
        disabled={loading || parentPath === null}
        title={parentPath !== null ? `返回上一级: ${parentPath}` : '已到达顶层'}
        className="px-2"
      >
        <FolderUp size={15} />
      </Button>
      <div className="flex-1">
        <Input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          placeholder={isRemote ? '例如 . 或 project-dir' : '/Users/example/project'}
          className="font-mono text-xs"
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={loading}
        title="刷新"
        className="px-2"
      >
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      </Button>
    </form>
  );
}

function DirectoryListBody({
  loading,
  error,
  directories,
  searchQuery,
  onNavigateChild,
  onReset,
}: {
  loading: boolean;
  error: string | null;
  directories: string[];
  searchQuery: string;
  onNavigateChild: (dir: string) => void;
  onReset: () => void;
}) {
  if (error) {
    return (
      <div className="m-2 flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
        <AlertCircle size={15} className="mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-medium">无法访问该目录</p>
          <p className="mt-0.5 opacity-90">{error}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onReset} className="h-7 text-xs">
          重置
        </Button>
      </div>
    );
  }

  if (directories.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-muted-foreground">
        <Folder size={28} className="mb-2 opacity-30" />
        {searchQuery ? '未找到匹配的子文件夹' : '当前目录下无子文件夹'}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {directories.map((dir) => (
        <button
          key={dir}
          type="button"
          onClick={() => onNavigateChild(dir)}
          className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:outline-none"
        >
          <Folder size={14} className="shrink-0 text-primary" />
          <span className="truncate font-mono">{dir}</span>
        </button>
      ))}
    </div>
  );
}

function SelectionFooter({
  currentPath,
  loading,
  onClose,
  onConfirm,
}: {
  currentPath: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="truncate text-xs text-muted-foreground">
        选定: <span className="font-mono text-foreground font-medium">{currentPath || '(未选择)'}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onConfirm}
          disabled={!currentPath || loading}
          className="gap-1"
        >
          <Check size={14} />
          选择此目录
        </Button>
      </div>
    </div>
  );
}

function useDirectoryPickerState({
  open,
  initialPath,
  deviceId,
  isRemote,
}: {
  open: boolean;
  initialPath?: string;
  deviceId?: string;
  isRemote: boolean;
}) {
  const [currentPath, setCurrentPath] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const loadDirectories = useCallback(
    async (targetPath?: string) => {
      const reqId = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const result: DirectoryListingResult = await runtime.listDirectories({
          deviceId,
          path: targetPath,
        });
        if (reqId !== requestSeq.current) return;
        setCurrentPath(result.path);
        setPathInput(result.path);
        setParentPath(result.parentPath ?? null);
        setDirectories(result.directories);
      } catch (err: unknown) {
        if (reqId !== requestSeq.current) return;
        const msg = err instanceof Error ? err.message : 'Failed to list directory contents';
        setError(msg);
      } finally {
        if (reqId === requestSeq.current) {
          setLoading(false);
        }
      }
    },
    [deviceId]
  );

  useEffect(() => {
    if (open) {
      setError(null);
      setSearchQuery('');
      const startPath = computeInitialStartPath(initialPath, isRemote);
      loadDirectories(startPath || undefined);
    }
  }, [open, isRemote, initialPath, loadDirectories]);

  const filteredDirectories = useMemo(() => {
    if (!searchQuery.trim()) return directories;
    const q = searchQuery.toLowerCase();
    return directories.filter((dir) => dir.toLowerCase().includes(q));
  }, [directories, searchQuery]);

  return {
    currentPath,
    pathInput,
    setPathInput,
    parentPath,
    searchQuery,
    setSearchQuery,
    loading,
    error,
    filteredDirectories,
    loadDirectories,
  };
}

export function DirectoryPickerModal({
  open,
  onClose,
  onSelect,
  initialPath,
  deviceId,
  deviceLabel,
}: DirectoryPickerModalProps) {
  const isRemote = Boolean(deviceId && deviceId !== 'local');
  const state = useDirectoryPickerState({ open, initialPath, deviceId, isRemote });
  const modalTitle = isRemote ? '选择远程目录 (Remote Directory)' : '选择本地目录 (Local Directory)';

  return (
    <Modal open={open} onClose={onClose} title={modalTitle} className="max-w-xl">
      <div className="flex flex-col gap-3">
        <DeviceBanner isRemote={isRemote} deviceLabel={deviceLabel} deviceId={deviceId} />
        <PathNavigationForm
          pathInput={state.pathInput}
          setPathInput={state.setPathInput}
          parentPath={state.parentPath}
          loading={state.loading}
          isRemote={isRemote}
          onNavigateUp={() => state.parentPath !== null && state.loadDirectories(state.parentPath)}
          onRefresh={() => state.loadDirectories(state.currentPath)}
          onSubmit={state.loadDirectories}
        />
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <input
            type="text"
            value={state.searchQuery}
            onChange={(e) => state.setSearchQuery(e.target.value)}
            placeholder="搜索当前目录下的子文件夹..."
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="relative min-h-[220px] max-h-[280px] overflow-y-auto rounded-md border bg-background/50 p-1">
          {state.loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
              <Loader2 size={20} className="animate-spin text-primary" />
            </div>
          )}
          <DirectoryListBody
            loading={state.loading}
            error={state.error}
            directories={state.filteredDirectories}
            searchQuery={state.searchQuery}
            onNavigateChild={(dir) => state.loadDirectories(computeChildPath(state.currentPath, dir, isRemote))}
            onReset={() => state.loadDirectories(isRemote ? '.' : undefined)}
          />
        </div>
        <SelectionFooter
          currentPath={state.currentPath}
          loading={state.loading}
          onClose={onClose}
          onConfirm={() => {
            onSelect(state.currentPath);
            onClose();
          }}
        />
      </div>
    </Modal>
  );
}
