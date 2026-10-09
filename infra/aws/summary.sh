#!/usr/bin/env bash
# The "Explain (AWS)" workflow's first job: what this run will do, and what
# changed since the last deploy, in plain words above the owner's approve
# button (.github/workflows/explain.yml, job "summary"). No AWS access.
#
# The last deploy is the newest deployment to the explain-aws environment
# that GitHub marked successful, whose run was an "Explain (AWS): deploy"
# started by hand from explain.yml, whose job "aws" succeeded, and whose
# commit is on main's history. Only a run on main that the owner approved can
# make one: the environment admits main only and waits for the owner. A run
# on another branch, or a run whose "aws" job was skipped, doesn't count (RT
# fix round 1: a skipped run used to count as the last deploy).
#
# The deployment must be bound to its run (RT2): GitHub Actions itself
# (github-actions[bot]) created both the deployment and its status, and the
# deployment's commit is the run's own commit. Anyone with write access can
# create a deployment through the API for any commit and point its status at
# an older real deploy run; such a record is ignored, because its creator is
# a person and its commit isn't the run's.
#
# Needs: ACTION, CAP, REF, GH_REPO, GH_TOKEN (deployments and actions read),
# and a checkout with full history. Writes to GITHUB_STEP_SUMMARY (or stdout).

set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-explain-aws}"
WORKFLOW_PATH=".github/workflows/explain.yml"
# The account GitHub Actions acts as when a job with an environment runs.
ACTIONS_BOT="github-actions[bot]"
# The code that decides what happens to a visitor's sentence, and how Explain
# is built and deployed. The owner-policy proposal protects every one; readiness verifies adoption.
PATHS=(packages/explain infra/aws packages/engine site/js/explain.js site/data/explain.json .github/workflows/explain.yml)
# Data the function also bundles: the rule pack and the move names. The PM may
# merge these alone after the red team's review. They change which wording is
# marked and what a move is called, not what the service can do with a
# sentence (the build refuses any bundled file that names a way out).
DATA_PATHS=(rules site/data/moves.json)

out() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >>"$GITHUB_STEP_SUMMARY"; else printf '%s\n' "$*"; fi; }

# Text from git (commit subjects, file names) is shown as data: only plain
# characters, inside a code block, so it can't pose as this summary's words.
plain() { LC_ALL=C tr -c 'A-Za-z0-9 ._,:;()/+=@#%&?!\n-' '?'; }

# The commit of the last deploy, or nothing.
last_deploy() {
  local id sha creator statuses state url status_creator run_id run title event path branch head_sha aws_ok
  while IFS=$'\t' read -r id sha creator; do
    [ -n "$id" ] || continue
    [ "$creator" = "$ACTIONS_BOT" ] || continue
    statuses="$(gh api "repos/${GH_REPO}/deployments/${id}/statuses?per_page=1" \
      --jq '.[0] | [.state, (.log_url // .target_url // ""), (.creator.login // "")] | @tsv' 2>/dev/null)" || continue
    IFS=$'\t' read -r state url status_creator <<<"$statuses"
    if [ "$state" != success ] || [ "$status_creator" != "$ACTIONS_BOT" ]; then
      continue
    fi
    run_id="$(grep -oE '/actions/runs/[0-9]+' <<<"$url" | head -1 | grep -oE '[0-9]+$')" || continue
    run="$(gh api "repos/${GH_REPO}/actions/runs/${run_id}" \
      --jq '[.display_title, .event, .path, .head_branch, .head_sha] | @tsv' 2>/dev/null)" || continue
    IFS=$'\t' read -r title event path branch head_sha <<<"$run"
    if [ "$title" != "Explain (AWS): deploy" ] || [ "$event" != workflow_dispatch ]; then
      continue
    fi
    if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || [ "$head_sha" != "$sha" ]; then
      continue
    fi
    if [ "${path%%@*}" != "$WORKFLOW_PATH" ] || [ "$branch" != main ]; then
      continue
    fi
    aws_ok="$(gh api "repos/${GH_REPO}/actions/runs/${run_id}/jobs?per_page=100" \
      --jq '[.jobs[] | select(.name == "aws") | .conclusion] | if length == 1 then .[0] else "" end' 2>/dev/null)" || continue
    [ "$aws_ok" = success ] || continue
    git merge-base --is-ancestor "$sha" HEAD 2>/dev/null || continue
    printf '%s\n' "$sha"
    return 0
  done < <(gh api "repos/${GH_REPO}/deployments?environment=${ENVIRONMENT}&per_page=100" \
    --jq '.[] | [(.id | tostring), .sha, (.creator.login // "")] | @tsv' 2>/dev/null || true)
  return 0
}

changes_since_last_deploy() {
  local last files data commits
  last="$(last_deploy)"
  out "### What changed since the last deploy"
  out
  if [ -z "$last" ]; then
    out "**Could not find the last deploy, so review every change to the Explain files before approving.** (On the very first deploy this is expected.)"
    return 0
  fi
  files="$(git diff --name-only "$last" HEAD -- "${PATHS[@]}" | plain)"
  data="$(git diff --name-only "$last" HEAD -- "${DATA_PATHS[@]}" | plain)"
  if [ -z "$files" ] && [ -z "$data" ]; then
    out "No Explain files changed since the last deploy (${last:0:12})."
    return 0
  fi
  if [ -n "$files" ]; then
    out "**These files changed since the last deploy (${last:0:12}).** They are code that decides what happens to visitors' sentences. Only you can merge them, so each one should be a change you merged after the red team's review:"
    out
    out '```'
    out "$files"
    out '```'
    out
  else
    out "No Explain code changed since the last deploy (${last:0:12})."
    out
  fi
  if [ -n "$data" ]; then
    out "**These rule and move-name files changed too.** They are data, not code: they change which wording gets marked and what a move is called. The PM may have merged them without you, after the red team's review:"
    out
    out '```'
    out "$data"
    out '```'
    out
  fi
  out "The commits, as their authors described them:"
  out
  commits="$(git log --format='%h %s' "$last..HEAD" -- "${PATHS[@]}" "${DATA_PATHS[@]}" | plain)"
  out '```'
  out "$commits"
  out '```'
}

# The model this run selects, as visitors' consent must name it (306 e).
model_line() {
  local name
  if [ -z "${MODEL:-}" ]; then
    out "**The model isn't named here:** the workflow didn't pass it to this summary. Don't approve until you know which model this run selects."
    return
  fi
  if ! name="$(node "$(dirname "${BASH_SOURCE[0]}")/model-table.mjs" --name "$MODEL" 2>/dev/null)"; then
    out "**Unknown model key.** The run stops before any AWS step."
    return
  fi
  out "Model: **${name}**."
}

main() {
  if [ -n "${CAP:-}" ] && ! [[ "$CAP" =~ ^([1-9]|1[0-9]|2[0-5])$ ]]; then
    echo "::error::The monthly cap must be a whole number from 1 to 25, or blank."
    exit 1
  fi
  out "## Explain (AWS): ${ACTION}"
  out
  if [ "${REF:-}" != "refs/heads/main" ]; then
    out "**This run is not on main, so it will not be allowed to touch AWS.**"
    out
  fi
  case "$ACTION" in
    deploy)
      out "This run will build Explain from main and run its tests, check the model's price against AWS's price list, check that Bedrock logging is off and the data-retention setting is as expected, then update the service with every setting from the reviewed files. Readiness and zero-retention checks must pass before any paid call. It switches Explain on for two distinct test calls, each once, and back to its previous state: off on a first deploy."
      out
      if [ -n "${CAP:-}" ]; then out "It will set the monthly cap to **\$${CAP}**."; else out "The monthly cap stays as it is."; fi
      out
      model_line
      out "If Explain is on with a different model, or the site's published consent names a different model, this run stops before changing anything: changing makers needs a pause and consent that names the new one first."
      ;;
    pause) out "This run will switch Explain **off**. Visitors who press Explain will see \"Explain is paused\". Nothing else changes, and nothing new is shipped." ;;
    resume)
      out "This run will switch Explain back **on**. Nothing else changes, and nothing new is shipped. It stops if the running model isn't the one named below, or isn't the one the site's consent names."
      out
      model_line
      ;;
    evaluate)
      out "This run will evaluate the reviewed synthetic set on the one explicitly selected model, through the authenticated cap-backed function, save every answer for the red team, then restore the previous switch. Real costs and time come from each reply; no model is switched automatically."
      out
      model_line
      ;;
    remove) out "This run will **delete** the Explain service: the function, the web address and every log line. The month's spending count stays in the setup, so the \$25 stop still holds if you deploy again this month (see infra/aws/README.md to remove the setup too)." ;;
    *) out "Unknown action." ;;
  esac
  out
  if [ "$ACTION" = deploy ]; then
    changes_since_last_deploy
    out
  fi
  out "**Approve only a run you started yourself, just now.** If you didn't start this run, don't approve it; tell the PM."
}

main "$@"
