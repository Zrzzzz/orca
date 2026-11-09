# Fork upstream synchronization

`personal-upstream-sync.yml` runs hourly at minute 23 and supports manual dispatch.
It is restricted to `Zrzzzz/orca` and merges `stablyai/orca:main` into
`automation/upstream-main`, then opens a PR targeting the fork's `main`.
It never force-pushes. Merge conflicts fail the run and list affected files in
the Actions summary; resolve them on the synchronization branch and rerun.

## Activation

1. Keep the workflow on the fork's default branch (`main`) and enable Actions.
2. Add the repository Actions secret `UPSTREAM_SYNC_TOKEN`: a fine-grained PAT
   scoped to this fork with Contents, Pull requests, and Workflows read/write,
   plus Actions and Checks read access. Workflow write access is necessary when
   upstream changes `.github/workflows`. A classic PAT needs `repo` and `workflow`.
   The normal `GITHUB_TOKEN` cannot trigger PR checks from its own pushes/PRs.
3. Enable merge commits in repository settings. Existing branch protection
   and review requirements remain enforced; the automation does not bypass them.
4. Ensure the fork can run `.github/workflows/pr.yml`, including its Blacksmith
   runners and any required secrets. Unavailable runners leave the PR unmerged.
5. Run **Sync upstream main** from Actions once to verify the configuration.

The next hourly run merges the PR only when the latest `PR Checks` run for its
current head succeeds, the `PR checks passed` aggregate job succeeds, and
`gh pr checks` passes. Merge uses an expected head SHA to reject concurrent head
changes. Failed, missing, or pending checks prevent merging. No repository
auto-merge setting is required. Fork-only changes remain in merge history;
this workflow does not update other feature branches or local working trees.

For a conflict on the first sync, the run fails before a PR is created. Create
the synchronization branch from the fork's main, merge upstream manually,
resolve the conflicts, and push it before rerunning the workflow.
