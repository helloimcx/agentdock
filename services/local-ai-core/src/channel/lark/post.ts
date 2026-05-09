export function buildLarkPostContent(markdown: string) {
  return {
    zh_cn: {
      content: [[{
        tag: 'md',
        text: sanitizeLarkPostMarkdown(String(markdown || '').trim() || ' '),
      }]],
    },
  };
}

function sanitizeLarkPostMarkdown(markdown: string) {
  return markdown.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, label: string, href: string) => {
    return /^https?:\/\//i.test(href) ? match : `${label} (${href})`;
  });
}
