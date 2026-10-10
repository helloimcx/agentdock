/**
 * Sidebar group membership for the renderer nav registry. Every visible
 * registry nav id must appear in exactly one group, or the desktop sidebar
 * silently hides the entry (the mobile bottom bar renders ungrouped items).
 */
export type SidebarNavGroup = { label: string; ids: string[] };

export const sidebarNavGroups: SidebarNavGroup[] = [
  { label: 'Core', ids: ['dashboard', 'chat', 'workspace', 'providers', 'projects', 'sessions', 'costs'] },
  { label: 'Knowledge', ids: ['knowledge', 'skills'] },
  { label: 'Automation', ids: ['automations'] },
  { label: 'System', ids: ['mesh', 'system'] },
];

export function navItemsWithoutGroup(ids: string[]): string[] {
  return ids.filter((id) => !sidebarNavGroups.some((group) => group.ids.includes(id)));
}
