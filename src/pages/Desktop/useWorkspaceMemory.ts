import { useCallback, useEffect, useState } from 'react';
import type {
  MemoryCategory,
  MemoryPage,
  MemoryPageWriteInput,
  MemorySearchResult,
} from '@cc/superai-contracts/memory';
import {
  deleteMemoryPage,
  listMemoryPages,
  queryMemoryPages,
  syncWorkspaceMemory,
  writeMemoryPage,
} from '@cc/core-sdk/memory';

export function useWorkspaceMemory(workspaceId: string) {
  const [pages, setPages] = useState<MemoryPage[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MemorySearchResult[] | null>(null);
  const [selectedPage, setSelectedPage] = useState<MemoryPage | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const loadPages = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await listMemoryPages(workspaceId);
      setPages(res.pages || []);
      if (selectedPage) {
        const updated = res.pages.find((p) => p.category === selectedPage.category && p.slug === selectedPage.slug);
        setSelectedPage(updated || null);
      }
    } catch (err) {
      setNotice({ tone: 'error', message: `加载记忆失败: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [workspaceId, selectedPage]);

  useEffect(() => { void loadPages(); }, [workspaceId]);

  const handleSync = async () => {
    if (!workspaceId || syncing) return;
    setSyncing(true);
    try {
      const res = await syncWorkspaceMemory(workspaceId);
      setNotice({ tone: 'success', message: `同步成功：已更新 ${res.synced} 篇，移除 ${res.deleted} 篇。` });
      await loadPages();
    } catch (err) {
      setNotice({ tone: 'error', message: `同步失败: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSyncing(false);
    }
  };

  const handleSearch = async (val: string) => {
    setSearchQuery(val);
    if (!val.trim()) { setSearchResults(null); return; }
    try {
      const category = selectedCategory !== 'all' ? selectedCategory : undefined;
      const res = await queryMemoryPages(workspaceId, { query: val.trim(), category });
      setSearchResults(res.results || []);
    } catch (err) {
      setNotice({ tone: 'error', message: `搜索失败: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const handleSave = async (input: MemoryPageWriteInput) => {
    if (!workspaceId) return;
    try {
      const res = await writeMemoryPage(workspaceId, input);
      setNotice({ tone: 'success', message: `已保存：${res.page.category}/${res.page.slug}` });
      setIsEditing(false);
      setIsCreating(false);
      setSelectedPage(res.page);
      await loadPages();
    } catch (err) {
      setNotice({ tone: 'error', message: `保存失败: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const handleDelete = async (page: MemoryPage) => {
    if (!window.confirm(`确定删除记忆页面 ${page.category}/${page.slug} 吗？`)) return;
    try {
      await deleteMemoryPage(workspaceId, page.category, page.slug);
      setNotice({ tone: 'success', message: `已删除：${page.category}/${page.slug}` });
      if (selectedPage?.slug === page.slug && selectedPage?.category === page.category) setSelectedPage(null);
      await loadPages();
    } catch (err) {
      setNotice({ tone: 'error', message: `删除失败: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  return {
    pages, selectedCategory, setSelectedCategory,
    searchQuery, searchResults, setSearchResults,
    selectedPage, setSelectedPage,
    syncing, notice, setNotice,
    isEditing, setIsEditing, isCreating, setIsCreating,
    handleSync, handleSearch, handleSave, handleDelete,
  };
}
