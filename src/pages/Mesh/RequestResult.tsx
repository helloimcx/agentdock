import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';

function decodeFile(result: Record<string, unknown>) {
  if (result.encoding !== 'base64' || typeof result.content !== 'string') return;
  try {
    const bytes = Uint8Array.from(atob(result.content), char => char.charCodeAt(0));
    let content: string | undefined;
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!decoded.includes('\0')) content = decoded;
    } catch { /* Binary files remain downloadable. */ }
    const name = typeof result.path === 'string' ? result.path.split(/[\\/]/).pop() || 'mesh-file' : 'mesh-file';
    return { bytes, content, name };
  } catch { return; }
}

export default function RequestResult({ result }: { result: unknown }) {
  const { t } = useTranslation();
  const value = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const file = decodeFile(value);
  if (file) return <div className="space-y-2">
    <Button variant="secondary" size="sm" onClick={() => {
      const url = URL.createObjectURL(new Blob([file.bytes], { type: 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>{t('mesh.download')}</Button>
    {file.content !== undefined && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{file.content}</pre>}
  </div>;
  if (Array.isArray(value.entries)) return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{value.entries.map(entry => typeof entry?.name === 'string' ? entry.name : '').join('\n')}{value.truncated ? `\n${t('mesh.truncated')}` : ''}</pre>;
  if (typeof value.stdout === 'string' && typeof value.stderr === 'string') return <div className="space-y-1">
    <p className="text-xs">{t('mesh.exitCode')}: {String(value.exitCode ?? value.signal ?? '')}</p>
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{value.stdout}{value.stderr}</pre>
  </div>;
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(result, null, 2)}</pre>;
}
