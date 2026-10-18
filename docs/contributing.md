# Contributing

gh-actions takes bug reports and fixes for its actions and its reusable workflow. To set up the repo and run its checks, see the [development guide](development.md).

## Issues

- A bug report names the action, the ref it runs at (`@main` or a SHA) and the inputs it gets, and links the failed run or pastes its log.
- A new action, or a change to an action's inputs, outputs or modes, starts as an issue before any pull request.

## Pull requests

1. Branch from `main` with a prefix: `feat/`, `fix/`, `docs/`, `ci/`, `chore/` or `test/`.
2. Write commits as [Conventional Commits](https://www.conventionalcommits.org), with the action as the scope when the change is in one, such as `docs(railway-redeploy): drop the Bun requirement`. The pull request title takes the same form, because it becomes the squash commit.
3. A change to an action's `src/` commits the rebuilt `dist/` with it, because callers run `dist/`.
4. Run `mise run check`, `mise run test` and `mise run check-dist` before you push. Once installed, the git hooks run them too.

CI has to pass, and a maintainer squash-merges.

A merge to `main` is the release. Callers that use `@main` run the new code on their next run, and callers that pin an action to a SHA keep theirs. `preview-comment.yml` runs the actions at `@main`, so pinning the workflow to a SHA doesn't pin the comment code.
