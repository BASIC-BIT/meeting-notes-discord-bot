---
description: End-to-end AI review workflow, including triage, fixes, checks, replies, reactions, commit, push, and repeat until ready.
argument-hint:
---

You are in charge of handling PR review cycles end-to-end across multiple AI reviewers. Start work as soon as any actionable review comments arrive, then re-check for new comments before committing and pushing to avoid triggering another review cycle prematurely.

Workflow

1. Understand the current changeset by comparing the branch to `master`.
2. Collect review comments and issue comments from all reviewers.
3. Triage each comment as valid or reject as erroneous.
4. Implement fixes for valid comments.
5. Run the full check suite so the PR goes green.
6. Before committing and pushing, refresh comments again. If new comments arrived, return to triage and handle them first.
7. Respond, react, and resolve comments based on policy.
8. Commit and push.
9. Wait for the next review cycle, then repeat until ready to merge.

Multiple reviewer strategy

- Start work as soon as any actionable comments arrive, even if other AI reviewers are still pending.
- Before commit and push, refresh review and issue comments to catch anything new.
- Only push after all actionable comments are addressed and the refresh shows nothing new.
- After push, wait for new review cycles and repeat the workflow until clean.

Reaction and reply policy

- If you resolve a comment without a written reply, add a 👍 reaction on that comment.
- If you resolve a comment and write a reply, do not add a 👍 reaction.
- If you reject a comment, reply with the rationale and do not add a 👍 reaction.
- If a comment is still pending, leave it unresolved and do not add a 👍 reaction.

GitHub command playbook
Prefer GitHub MCP when available. Until then, use these CLI patterns.

Setup

- Identify owner and repo: `gh repo view --json nameWithOwner`
- Identify PR number: `gh pr view --json number`
- Optional shell vars:
  - `OWNER=Chronote-gg`
  - `REPO=Chronote`
  - `PR=74`

Review comments and issue comments

- Review comments (inline):
  - `gh api repos/$OWNER/$REPO/pulls/$PR/comments`
- Issue comments (PR level):
  - `gh api repos/$OWNER/$REPO/issues/$PR/comments`

Review threads and resolution

- List review threads with IDs and comment database IDs:
  - `gh api graphql -F query='query($owner:String!, $name:String!, $number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved comments(first:50){nodes{databaseId nodeId}}}}}}}' -F owner="$OWNER" -F name="$REPO" -F number=$PR`
- Resolve a review thread by ID:
  - `gh api graphql -F query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}' -F id='THREAD_ID'`

Replies

- Inline reply to a review comment using GraphQL (requires permissions):
  - `gh api graphql -F query='mutation($body:String!, $inReplyTo:ID!){addPullRequestReviewComment(input:{body:$body,inReplyTo:$inReplyTo}){comment{id}}}' -F body='REPLY' -F inReplyTo='NODE_ID'`
- If inline reply is blocked or lacks permissions, post a PR level comment:
  - `gh pr comment $PR -b "REPLY"`

Reactions

- 👍 on a review comment:
  - `gh api -X POST repos/$OWNER/$REPO/pulls/comments/COMMENT_ID/reactions -f content='+1'`
- 👍 on an issue comment:
  - `gh api -X POST repos/$OWNER/$REPO/issues/comments/COMMENT_ID/reactions -f content='+1'`

Checks

- Watch checks:
  - `gh pr checks --watch`
- Quick status snapshot:
  - `gh pr checks`

Execution checklist

- Read diff: `git diff --stat master...HEAD` and inspect relevant files.
- Fetch review and issue comments.
- Triage each comment:
  - Valid: fix in code.
  - Erroneous: prepare a reply explaining why.
- Implement fixes.
- Run checks (local full gate if required by repo).
- Refresh review and issue comments again before commit and push. If new comments appear, loop back to triage.
- Respond and resolve:
  - Valid and fixed: resolve thread, add 👍 only if there is no written reply.
  - Rejected: reply with rationale, resolve if appropriate, no 👍.
  - Pending: leave open, no 👍.
- Commit with a clear message and push.
- Wait for new reviews and repeat until all comments are handled and checks pass.

Final report format

- Summary of changes and checks run.
- For each reviewer comment, list one of:
  - Resolved with 👍
  - Resolved with reply
  - Rejected with reply
  - Still pending
- Note any permission failures for replies or reactions.
- Suggest resolving threads with GitHub CLI if any remain open.
