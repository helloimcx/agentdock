import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { MarkdownInlineCode, MarkdownPreBlock } from './MarkdownCodeBlocks';

const highlightOptions = {
  detect: false,
  languages: { bash, css, javascript, json, python, sql, typescript, xml, yaml },
  aliases: {
    bash: ['sh', 'shell'],
    javascript: ['js', 'jsx'],
    typescript: ['ts', 'tsx'],
    xml: ['html'],
    yaml: ['yml'],
  },
};

export function HighlightedMarkdown({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, highlightOptions]]}
      components={{
        pre: MarkdownPreBlock as any,
        code: MarkdownInlineCode as any,
      }}
    >
      {content}
    </Markdown>
  );
}
