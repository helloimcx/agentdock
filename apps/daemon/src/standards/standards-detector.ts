import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { DetectedTechStack } from './standards-types.js';

const FRAMEWORK_MATCHERS = [
  { name: 'react', keys: ['react', 'react-dom', '@types/react'] },
  { name: 'vue', keys: ['vue'] },
  { name: 'tailwindcss', keys: ['tailwindcss', '@tailwindcss/typography'] },
];

function detectFrameworks(deps: Record<string, unknown>, frameworks: Set<string>, recommendedPacks: Set<string>) {
  let matched = false;
  for (const item of FRAMEWORK_MATCHERS) {
    if (item.keys.some((k) => k in deps)) {
      frameworks.add(item.name);
      matched = true;
    }
  }
  if (matched) {
    recommendedPacks.add('design-system');
  }
}

function detectNodeEcosystem(
  workspacePath: string,
  languages: Set<string>,
  frameworks: Set<string>,
  detectedFiles: string[],
  recommendedPacks: Set<string>,
) {
  const tsconfig = join(workspacePath, 'tsconfig.json');
  if (existsSync(tsconfig)) {
    languages.add('typescript');
    detectedFiles.push('tsconfig.json');
    recommendedPacks.add('typescript');
  }

  const packageJsonPath = join(workspacePath, 'package.json');
  if (!existsSync(packageJsonPath)) return;

  detectedFiles.push('package.json');
  try {
    const raw = readFileSync(packageJsonPath, 'utf8');
    const pkg = JSON.parse(raw);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    if (deps.typescript) {
      languages.add('typescript');
      recommendedPacks.add('typescript');
    } else {
      languages.add('javascript');
    }

    detectFrameworks(deps, frameworks, recommendedPacks);
  } catch {
    // Ignore JSON parse errors
  }
}

function detectOtherEcosystems(
  workspacePath: string,
  languages: Set<string>,
  detectedFiles: string[],
  recommendedPacks: Set<string>,
) {
  if (existsSync(join(workspacePath, 'go.mod'))) {
    languages.add('golang');
    detectedFiles.push('go.mod');
    recommendedPacks.add('golang');
  }

  const pyproject = join(workspacePath, 'pyproject.toml');
  const reqTxt = join(workspacePath, 'requirements.txt');
  if (existsSync(pyproject) || existsSync(reqTxt)) {
    languages.add('python');
    if (existsSync(pyproject)) detectedFiles.push('pyproject.toml');
    if (existsSync(reqTxt)) detectedFiles.push('requirements.txt');
    recommendedPacks.add('python');
  }

  if (existsSync(join(workspacePath, 'Cargo.toml'))) {
    languages.add('rust');
    detectedFiles.push('Cargo.toml');
  }
}

export function detectWorkspaceTechStack(workspacePath: string): DetectedTechStack {
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const detectedFiles: string[] = [];
  const recommendedPacks = new Set<string>(['general']);

  detectNodeEcosystem(workspacePath, languages, frameworks, detectedFiles, recommendedPacks);
  detectOtherEcosystems(workspacePath, languages, detectedFiles, recommendedPacks);

  const langArr = Array.from(languages);
  return {
    primaryLanguage: langArr[0] || 'general',
    languages: langArr,
    frameworks: Array.from(frameworks),
    detectedFiles,
    recommendedPacks: Array.from(recommendedPacks),
  };
}
