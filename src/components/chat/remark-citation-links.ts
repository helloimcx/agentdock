type MarkdownPosition = {
  start: { offset?: number };
  end: { offset?: number };
};

type MarkdownNode = {
  type: string;
  url?: string;
  position?: MarkdownPosition;
  children?: MarkdownNode[];
};

type MarkdownFile = { value?: unknown };

function repairCitationLink(node: MarkdownNode, source: string) {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof node.url !== 'string' || start === undefined || end === undefined) return;

  const markdownLink = source.slice(start, end);
  const citationAfterLink = /^\s*\[\d+\]/.test(source.slice(end));
  if (!citationAfterLink || !/\]\([^\)\r\n]*\[\)$/.test(markdownLink)) return;

  node.url = node.url.replace(/(?:%5B|\[)$/i, '');
}

function visitLinks(node: MarkdownNode, source: string) {
  if (node.type === 'link') repairCitationLink(node, source);
  node.children?.forEach((child) => visitLinks(child, source));
}

export function remarkCitationLinks() {
  return (tree: MarkdownNode, file: MarkdownFile) => {
    if (typeof file.value !== 'string') return;
    visitLinks(tree, file.value);
  };
}
