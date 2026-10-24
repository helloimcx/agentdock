import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_TEST_DIRECTORIES = [
  'dist-electron/tests/electron',
  'dist-electron/tests/contracts',
  'dist-electron/tests/integration',
  'dist-electron/packages/knowledge/test',
];
const SOURCE_TEST_DIRECTORIES = [
  'tests/electron',
  'tests/contracts',
  'tests/integration',
  'packages/knowledge/test',
];
const RENDERER_SOURCE_DIRECTORY = 'apps/web/src';
const RENDERER_OUTPUT_DIRECTORY = 'dist-electron/apps/web/src';
const RENDERER_TEST_PATTERN = /^(?:apps\/web\/)?src\/.+\.test\.ts$/;

function collectTests(directory, root) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTests(absolute, root);
      return entry.isFile() && entry.name.endsWith('.test.js')
        ? [path.relative(root, absolute).split(path.sep).join('/')]
        : [];
    });
}

function collectSourceTests(directory, root) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectSourceTests(absolute, root);
      return entry.isFile() && entry.name.endsWith('.test.ts')
        ? [path.relative(root, absolute).split(path.sep).join('/')]
        : [];
    });
}

function assertSameTests(sourceTests, compiledTests) {
  const compiledSet = new Set(compiledTests);
  const sourceSet = new Set(sourceTests);

  for (const sourceTest of sourceTests) {
    const expectedOutput = `dist-electron/${sourceTest.replace(/\.ts$/, '.js')}`;
    if (!compiledSet.has(expectedOutput)) {
      throw new Error(`Source test is missing compiled output: ${sourceTest}`);
    }
  }

  for (const compiledTest of compiledTests) {
    const sourceTest = compiledTest.replace(/^dist-electron\//, '').replace(/\.js$/, '.ts');
    if (!sourceSet.has(sourceTest)) {
      throw new Error(`Compiled test has no TypeScript source: ${compiledTest}`);
    }
  }
}

export function discoverTestFiles(root = process.cwd()) {
  const files = [];
  const sourceTests = [];
  const compiledTests = [];

  for (const relativeDirectory of REQUIRED_TEST_DIRECTORIES) {
    const directory = path.join(root, relativeDirectory);
    if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`Required compiled test directory is missing: ${relativeDirectory}`);
    }
    compiledTests.push(...collectTests(directory, root));
  }

  for (const relativeDirectory of SOURCE_TEST_DIRECTORIES) {
    const directory = path.join(root, relativeDirectory);
    if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`Required TypeScript test directory is missing: ${relativeDirectory}`);
    }
    sourceTests.push(...collectSourceTests(directory, root));
  }

  const tsconfigPath = path.join(root, 'tsconfig.electron.json');
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
  const rendererTests = (tsconfig.include || []).filter((entry) => RENDERER_TEST_PATTERN.test(entry));
  if (rendererTests.length === 0) throw new Error('No renderer tests are registered in tsconfig.electron.json.');

  const rendererSourceDirectory = path.join(root, RENDERER_SOURCE_DIRECTORY);
  const rendererSourceTests = fs.statSync(rendererSourceDirectory, { throwIfNoEntry: false })?.isDirectory()
    ? collectSourceTests(rendererSourceDirectory, root)
    : [];
  const configuredRendererTests = new Set(rendererTests);
  for (const sourceTest of rendererSourceTests) {
    if (!configuredRendererTests.has(sourceTest)) {
      throw new Error(`Renderer source test is not registered in tsconfig.electron.json: ${sourceTest}`);
    }
  }
  sourceTests.push(...rendererSourceTests);

  for (const sourceTest of rendererTests) {
    const compiledTest = path.join(root, 'dist-electron', sourceTest.replace(/\.ts$/, '.js'));
    if (!fs.statSync(compiledTest, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Configured renderer test is missing compiled output: ${sourceTest}`);
    }
    const relativeOutput = path.relative(root, compiledTest).split(path.sep).join('/');
    sourceTests.push(sourceTest);
    compiledTests.push(relativeOutput);
  }

  const rendererOutputDirectory = path.join(root, RENDERER_OUTPUT_DIRECTORY);
  if (fs.statSync(rendererOutputDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    compiledTests.push(...collectTests(rendererOutputDirectory, root));
  }

  const uniqueSources = [...new Set(sourceTests)].sort();
  const uniqueCompiled = [...new Set(compiledTests)].sort();
  assertSameTests(uniqueSources, uniqueCompiled);

  const uniqueFiles = uniqueCompiled;
  if (uniqueFiles.length === 0) throw new Error('No compiled tests were discovered.');
  return uniqueFiles;
}
