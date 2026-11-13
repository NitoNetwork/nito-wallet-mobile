import { spawnSync } from 'node:child_process';

const AUDIT_TOOL_VERSION = '0.9.3';
const EXPIRES_AT = Date.parse('2027-02-13T00:00:00.000Z');
const ALLOWED_ADVISORY = Object.freeze({
  id: 'GHSA-8474-xrp6-wh69',
  gem: 'activesupport',
  version: '7.2.3.2',
});

const fail = (message) => {
  throw new Error(message);
};

const parseReport = (rawReport) => {
  let report;
  try {
    report = JSON.parse(rawReport);
  } catch {
    fail('bundler-audit returned invalid JSON.');
  }

  if (report?.version !== AUDIT_TOOL_VERSION || !Array.isArray(report?.results)) {
    fail('bundler-audit returned an unsupported report structure.');
  }
  return report;
};

const evaluateReport = (report, now = Date.now()) => {
  if (!Number.isFinite(now)) {
    fail('The Ruby audit date is invalid.');
  }
  if (now >= EXPIRES_AT) {
    fail('The temporary ActiveSupport build-tool exception expired on 2027-02-13.');
  }

  const matches = report.results.filter(
    (result) => result?.advisory?.id === ALLOWED_ADVISORY.id,
  );
  if (matches.length !== 1) {
    fail(
      matches.length === 0
        ? 'The allowed ActiveSupport advisory is absent. Remove the obsolete exception.'
        : 'The allowed ActiveSupport advisory appears more than once.',
    );
  }

  const [allowedResult] = matches;
  if (
    allowedResult.type !== 'unpatched_gem'
    || allowedResult?.gem?.name !== ALLOWED_ADVISORY.gem
    || allowedResult?.gem?.version !== ALLOWED_ADVISORY.version
  ) {
    fail('The allowed ActiveSupport advisory no longer matches the reviewed dependency.');
  }

  const unexpected = report.results.filter(
    (result) => result?.advisory?.id !== ALLOWED_ADVISORY.id,
  );
  if (unexpected.length > 0) {
    const identifiers = unexpected
      .map((result) => result?.advisory?.id ?? 'unknown-advisory')
      .join(', ');
    fail(`Ruby build dependency audit reported unexpected advisories: ${identifiers}.`);
  }
};

const runBundleAudit = (args) => {
  const windows = process.platform === 'win32';
  const command = windows ? (process.env.ComSpec ?? 'cmd.exe') : 'bundle';
  const commandArgs = windows
    ? ['/d', '/c', 'bundle', 'exec', 'bundler-audit', ...args]
    : ['exec', 'bundler-audit', ...args];
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }
  return result;
};

const assertUpdateSucceeded = (result) => {
  if (result.status !== 0) {
    fail(`bundler-audit database update failed with exit ${result.status ?? 'unknown'}.`);
  }
};

const assertAuditStatusSupported = (result) => {
  if (result.status !== 0 && result.status !== 1) {
    fail(`bundler-audit failed with exit ${result.status ?? 'unknown'}.`);
  }
};

const runAudit = () => {
  const update = runBundleAudit(['update']);
  if (update.stdout) {
    process.stdout.write(update.stdout);
  }
  if (update.stderr) {
    process.stderr.write(update.stderr);
  }
  assertUpdateSucceeded(update);

  const audit = runBundleAudit([
    'check',
    '--format',
    'json',
    '--gemfile-lock',
    'Gemfile.lock',
  ]);
  if (audit.stderr) {
    process.stderr.write(audit.stderr);
  }
  assertAuditStatusSupported(audit);

  const report = parseReport(audit.stdout);
  evaluateReport(report);
  console.log(
    'Ruby build dependency audit accepted only GHSA-8474-xrp6-wh69 '
      + 'for ActiveSupport 7.2.3.2. The exception expires on 2027-02-13.',
  );
};

const expectFailure = (callback, expectedFragment) => {
  try {
    callback();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(expectedFragment)) {
      return;
    }
    fail(`Unexpected self-test failure: ${message}`);
  }
  fail(`Expected self-test failure containing: ${expectedFragment}`);
};

const makeReport = (results) => ({ version: AUDIT_TOOL_VERSION, results });
const makeAllowedResult = (overrides = {}) => ({
  type: 'unpatched_gem',
  gem: {
    name: ALLOWED_ADVISORY.gem,
    version: ALLOWED_ADVISORY.version,
    ...overrides.gem,
  },
  advisory: {
    id: ALLOWED_ADVISORY.id,
    ...overrides.advisory,
  },
  ...overrides.result,
});

const runSelfTest = () => {
  const justBeforeExpiry = EXPIRES_AT - 1;
  evaluateReport(makeReport([makeAllowedResult()]), justBeforeExpiry);

  expectFailure(
    () => evaluateReport(makeReport([]), justBeforeExpiry),
    'absent',
  );
  expectFailure(
    () => evaluateReport(
      makeReport([
        makeAllowedResult(),
        {
          type: 'unpatched_gem',
          gem: { name: 'example', version: '1.0.0' },
          advisory: { id: 'GHSA-example' },
        },
      ]),
      justBeforeExpiry,
    ),
    'unexpected advisories',
  );
  expectFailure(
    () => evaluateReport(
      makeReport([makeAllowedResult({ advisory: { id: 'GHSA-other' } })]),
      justBeforeExpiry,
    ),
    'absent',
  );
  expectFailure(
    () => evaluateReport(
      makeReport([makeAllowedResult({ gem: { name: 'other' } })]),
      justBeforeExpiry,
    ),
    'no longer matches',
  );
  expectFailure(
    () => evaluateReport(
      makeReport([makeAllowedResult({ gem: { version: '7.2.4' } })]),
      justBeforeExpiry,
    ),
    'no longer matches',
  );
  expectFailure(
    () => evaluateReport(
      makeReport([makeAllowedResult(), makeAllowedResult()]),
      justBeforeExpiry,
    ),
    'more than once',
  );
  expectFailure(
    () => evaluateReport(makeReport([makeAllowedResult()]), EXPIRES_AT),
    'expired',
  );
  expectFailure(
    () => parseReport('{invalid'),
    'invalid JSON',
  );
  expectFailure(
    () => parseReport(JSON.stringify({ version: '0.9.2', results: [] })),
    'unsupported report structure',
  );
  expectFailure(
    () => assertUpdateSucceeded({ status: 1 }),
    'database update failed with exit 1',
  );
  expectFailure(
    () => assertAuditStatusSupported({ status: 2 }),
    'failed with exit 2',
  );

  console.log('Ruby build dependency audit policy self-test passed.');
};

try {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    runAudit();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
