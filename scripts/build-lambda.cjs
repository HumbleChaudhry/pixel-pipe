const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { dependencies } = require('../package.json');

const handlers = ['get-upload-url', 'dispatch-tasks', 'resize-worker', 'analysis-worker'];
const handler = process.argv[2];

if (!handlers.includes(handler)) {
  console.error(`Expected a Lambda handler: ${handlers.join(', ')}`);
  process.exit(1);
}

// Resolve from this file so Terraform can also invoke builds from infrastructure/.
const projectRoot = path.resolve(__dirname, '..');
const runtimeDependencies = { 'aws-xray-sdk': dependencies['aws-xray-sdk'] };
if (handler === 'resize-worker') runtimeDependencies.sharp = dependencies.sharp;

const manifest = JSON.stringify({
  name: handler,
  version: '1.0.0',
  dependencies: runtimeDependencies,
});
const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
const externalFlags = Object.keys(runtimeDependencies).map((name) => `--external:${name}`);
const command = [
  'npm ci',
  `npx --no-install esbuild src/handlers/${handler}.ts --bundle --platform=node --target=node18 ${externalFlags.join(' ')} --outfile=dist/${handler}/index.js`,
  `cd dist/${handler}`,
  `printf '%s\\n' ${quote(manifest)} > package.json`,
  'npm install --omit=dev',
].join(' && ');

// Pass arguments directly to Docker, avoiding Windows/Linux host-shell expansion.
const result = spawnSync('docker', [
  'run', '--rm',
  '--volume', `${projectRoot}:/var/task`,
  '--workdir', '/var/task',
  '--entrypoint', 'sh',
  'public.ecr.aws/lambda/nodejs:18',
  '-c', command,
], { cwd: projectRoot, stdio: 'inherit' });

if (result.error) console.error(`Could not start Docker: ${result.error.message}`);
process.exit(result.status ?? 1);
