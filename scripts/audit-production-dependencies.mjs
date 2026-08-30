import { spawnSync } from 'node:child_process';

const runAudit = () => {
  const npmCli = process.env.npm_execpath;
  const npm = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const auditArguments = ['audit', '--omit=dev', '--json'];
  const result = spawnSync(
    npm,
    npmCli ? [npmCli, ...auditArguments] : auditArguments,
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: !npmCli && process.platform === 'win32',
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit returned invalid JSON (exit ${result.status ?? 'unknown'}).`);
  }

  if (report?.error) {
    throw new Error(`npm audit failed${report.error.summary ? `: ${report.error.summary}` : '.'}`);
  }

  const vulnerabilities = report?.metadata?.vulnerabilities;
  const total = vulnerabilities?.total;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('npm audit did not return a usable vulnerability total.');
  }
  if (result.status !== 0 || total !== 0) {
    throw new Error(`Production dependency audit reported ${total} known vulnerability(ies).`);
  }

  console.log('Production dependency audit passed with 0 known vulnerabilities.');
};

try {
  runAudit();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
