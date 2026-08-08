import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const AUDIT_LEVEL = 'moderate';
const EXPIRES_AFTER = '2026-11-08';
const SEVERITY_RANK = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const ALLOWED_ADVISORIES = new Map([
  [
    'GHSA-w3rx-r6r6-pgpr',
    'Build-time-only Metro image-size ICNS parser; the package is not shipped in the APK or IPA, and the repository contains no ICNS assets.',
  ],
  [
    'GHSA-5p2g-fcmc-qvqq',
    'Build-time-only Metro image-size JXL/HEIF parsers; the package is not shipped in the APK or IPA, and the repository contains no JXL or HEIF assets.',
  ],
]);

const advisoryId = (advisory) => {
  const match = String(advisory?.url ?? '').match(/GHSA-[0-9a-z-]+/i);
  return match?.[0] ?? null;
};

const collectReportedAdvisories = (vulnerabilities) => {
  const reported = new Set();
  for (const vulnerability of Object.values(vulnerabilities)) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via === 'string') continue;
      const id = advisoryId(via);
      if (id) reported.add(id);
    }
  }
  return reported;
};

const resolveRootAdvisories = (name, vulnerabilities, visiting = new Set()) => {
  if (visiting.has(name)) return new Set();
  const vulnerability = vulnerabilities[name];
  if (!vulnerability) return new Set([`unresolved:${name}`]);

  const nextVisiting = new Set(visiting).add(name);
  const roots = new Set();
  for (const via of vulnerability.via ?? []) {
    if (typeof via === 'string') {
      for (const root of resolveRootAdvisories(via, vulnerabilities, nextVisiting)) {
        roots.add(root);
      }
      continue;
    }
    roots.add(advisoryId(via) ?? `unidentified:${via.source ?? name}`);
  }
  return roots;
};

export const evaluateAuditReport = (report, now = new Date()) => {
  const today = now.toISOString().slice(0, 10);
  if (today > EXPIRES_AFTER) {
    throw new Error(`Dependency audit exceptions expired after ${EXPIRES_AFTER}.`);
  }

  if (!report || typeof report !== 'object' || report.error) {
    throw new Error(`npm audit did not return a usable report${report?.error?.summary ? `: ${report.error.summary}` : '.'}`);
  }
  const vulnerabilities = report.vulnerabilities ?? {};
  const reportedAdvisories = collectReportedAdvisories(vulnerabilities);
  const missingAllowed = [...ALLOWED_ADVISORIES.keys()]
    .filter((id) => !reportedAdvisories.has(id));
  if (missingAllowed.length > 0) {
    throw new Error(`Remove stale dependency audit exception(s): ${missingAllowed.join(', ')}.`);
  }

  const minimumRank = SEVERITY_RANK[AUDIT_LEVEL];
  const rejected = [];
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    const rank = SEVERITY_RANK[vulnerability.severity] ?? Number.POSITIVE_INFINITY;
    if (rank < minimumRank) continue;
    const roots = resolveRootAdvisories(name, vulnerabilities);
    if (roots.size === 0) {
      rejected.push(`${name}: no root advisory could be resolved`);
      continue;
    }
    const unapproved = [...roots].filter((id) => !ALLOWED_ADVISORIES.has(id));
    if (unapproved.length > 0) {
      rejected.push(`${name}: ${unapproved.join(', ')}`);
    }
  }
  if (rejected.length > 0) {
    throw new Error(`Unapproved production dependency vulnerabilities:\n${rejected.join('\n')}`);
  }

  return {
    expiresAfter: EXPIRES_AFTER,
    allowedAdvisories: [...ALLOWED_ADVISORIES.entries()].map(([id, reason]) => ({ id, reason })),
  };
};

const auditFixture = () => ({
  vulnerabilities: {
    'image-size': {
      severity: 'high',
      via: [
        { source: 1, url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr' },
        { source: 2, url: 'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq' },
      ],
    },
    metro: { severity: 'high', via: ['image-size'] },
  },
});

const expectFailure = (callback, expectedText) => {
  try {
    callback();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedText)) return;
    throw error;
  }
  throw new Error(`Expected dependency audit evaluation to fail with: ${expectedText}`);
};

const runSelfTest = () => {
  const currentDate = new Date('2026-08-08T00:00:00.000Z');
  evaluateAuditReport(auditFixture(), currentDate);

  const unapproved = auditFixture();
  unapproved.vulnerabilities['js-yaml'] = {
    severity: 'high',
    via: [{ source: 3, url: 'https://github.com/advisories/GHSA-0000-0000-0000' }],
  };
  expectFailure(
    () => evaluateAuditReport(unapproved, currentDate),
    'GHSA-0000-0000-0000',
  );

  const stale = auditFixture();
  stale.vulnerabilities['image-size'].via.pop();
  expectFailure(
    () => evaluateAuditReport(stale, currentDate),
    'Remove stale dependency audit exception',
  );
  expectFailure(
    () => evaluateAuditReport(auditFixture(), new Date('2026-11-09T00:00:00.000Z')),
    'expired after 2026-11-08',
  );
  console.log('Production dependency audit self-test passed.');
};

const runAudit = () => {
  const npmCli = process.env.npm_execpath;
  const npm = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const auditArguments = ['audit', '--omit=dev', `--audit-level=${AUDIT_LEVEL}`, '--json'];
  const result = spawnSync(
    npm,
    npmCli ? [npmCli, ...auditArguments] : auditArguments,
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: !npmCli && process.platform === 'win32',
    },
  );
  if (result.error) throw result.error;
  if (result.stderr) process.stderr.write(result.stderr);

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit returned invalid JSON (exit ${result.status ?? 'unknown'}).`);
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`npm audit failed to execute successfully (exit ${result.status ?? 'unknown'}).`);
  }
  const accepted = evaluateAuditReport(report);
  console.log(
    `Production dependency audit passed with ${accepted.allowedAdvisories.length} temporary build-time exception(s), expiring after ${accepted.expiresAfter}.`,
  );
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
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
}
