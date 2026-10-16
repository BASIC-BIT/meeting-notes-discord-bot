# Code quality checks

Run `yarn check:quality` before committing. It compares the working tree, including eligible untracked files, with the merge base of `origin/master`. Pass `--base <ref>` for another target.

The checks prevent new debt. Existing violations may remain unchanged or improve. Once an improvement merges, its new value becomes the baseline. A reduction elsewhere cannot pay for a regression.

| Check       | Rule                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Complexity  | New touched functions above 15 cyclomatic or cognitive complexity fail. Existing offenders fail if either measure increases.                |
| File size   | New files must have fewer than 1,000 physical lines. Existing files at or above that limit may not grow.                                    |
| Duplication | New repeated blocks of at least 8 lines and 50 tokens fail. Copies of unchanged source are included; matching old copies are grandfathered. |

Use `yarn check:duplication`, `yarn check:complexity`, or `yarn check:file-size` for an individual check. Each accepts `--base`, `--repo`, and `--json`. `yarn test:quality` runs the checker regression suites.

## Scope and outcomes

All authored JavaScript/TypeScript files are included, including tests, fixtures, mocks, stories, scripts, and root configuration. Module variants `.mjs`, `.cjs`, `.mts`, and `.cts` are included.

Dependencies, generated declarations/code, build output, coverage, Tauri generated/target output, Git metadata, and nested worktrees are excluded. Rust, Terraform, CSS, shell, and prose are outside this initial scope. External directory symlinks are not followed. Tracked source remains eligible even when it matches `.gitignore`; ignored untracked scratch files do not participate in duplication scans.

Exit codes are 0 for clean, 1 for a regression, and 2 for an operational failure. The combined command runs all three scanners. An unavailable scanner, parser error, missing baseline, or malformed report is not clean.

Function matching uses lexical owners, names, and callback ordinals within a file. If the count of indistinguishable same-name functions changes, touched offenders are conservatively treated as new. Renaming a complex function or inserting callbacks can make it appear new. Recognized file renames retain their baseline. Consider these limits when interpreting a finding.

## PR exceptions

The dedicated `Code quality ratchet` check analyzes the proposed merge with the live target branch. It also verifies current PR metadata before accepting the result. Findings appear in the Actions summary and report artifacts.

For a deliberate exception, add a reason under this exact heading in the PR description:

```markdown
## Quality exception

Explain why the current regressions should be accepted.
```

A maintainer then applies `quality-exception`. Agents need explicit user authorization before applying the label. The exception covers all three checks and remains active across pushes, with current findings shown on each run. A comment-only template section is insufficient.

Removing the label restores strict enforcement. Keeping the label while removing the reason fails the policy, even when the scanners are clean. Scanner, checker-test, preparation, and unrelated CI failures remain blocking.

Local commands remain strict and do not fetch exemptions. An intentionally exempt PR can fail `yarn check:quality` locally. Report that failure accurately rather than claiming a clean result.

If an exempt regression merges, it becomes the ordinary Git baseline for later PRs. The label does not schedule cleanup or preserve an earlier limit.

## CI and deployment

The required check must be activated in the default branch rules with up-to-date enforcement. A workflow definition alone does not guarantee merge blocking. Branches may need rebasing after another PR lands.

`yarn code:stats` retains scc and unsuppressed Lizard diagnostics. Lizard warnings do not block deployment; tool execution failures still do. Production and Sandbox retain their existing operational checks and do not reapply a strict PR-relative check after an exception has merged.

Do not suppress a finding through source comments, a growing allowlist, threshold flags, or a checked-in debt inventory. Simplify or share the implementation, or use the reviewed PR exception. Small functions and files still need sensible interfaces; extracting a helper solely to lower a score can make the code worse.
