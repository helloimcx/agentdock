export function buildLarkPostContent(markdown: string) {
  const content = renderLarkPostLines(markdown);
  return {
    zh_cn: {
      content: content.length > 0 ? content : [[{ tag: 'text', text: ' ' }]],
    },
  };
}

function renderLarkPostLines(markdown: string): Array<Array<Record<string, unknown>>> {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const rendered: Array<Array<Record<string, unknown>>> = [];
  let codeFence: { marker: string; language: string; lines: string[] } | null = null;

  for (const line of lines) {
    const fence = matchFence(line);
    if (fence) {
      if (codeFence && fence.marker[0] === codeFence.marker[0] && fence.marker.length >= codeFence.marker.length) {
        rendered.push([{
          tag: 'code_block',
          language: codeFence.language,
          text: codeFence.lines.join('\n'),
        }]);
        codeFence = null;
      } else if (!codeFence) {
        codeFence = {
          marker: fence.marker,
          language: fence.language,
          lines: [],
        };
      } else {
        codeFence.lines.push(line);
      }
      continue;
    }

    if (codeFence) {
      codeFence.lines.push(line);
      continue;
    }

    if (!line.trim()) {
      rendered.push([{ tag: 'text', text: '' }]);
      continue;
    }

    rendered.push([{ tag: 'md', text: sanitizeLarkPostMarkdown(line) }]);
  }

  if (codeFence) {
    rendered.push([{
      tag: 'code_block',
      language: codeFence.language,
      text: codeFence.lines.join('\n'),
    }]);
  }

  return rendered;
}

function matchFence(line: string) {
  const match = line.trim().match(/^(`{3,}|~{3,})([A-Za-z0-9_-]*)\s*$/);
  if (!match) {
    return null;
  }
  return {
    marker: match[1],
    language: match[2] || '',
  };
}

function sanitizeLarkPostMarkdown(markdown: string) {
  return markdown.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, label: string, href: string) => {
    return /^https?:\/\//i.test(href) ? match : `${label} (${href})`;
  });
}
