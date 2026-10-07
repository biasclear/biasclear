#!/usr/bin/env bash
# The "Explain (AWS)" workflow's steps that hold AWS credentials
# (.github/workflows/explain.yml, job "aws"). Owner's guide: infra/aws/README.md.
#
# This is the only code that runs while the deploy role's credentials exist,
# and it runs nothing installed from npm: bash, jq, curl, the AWS CLI, and one
# dependency-free script from the checkout (deploy-params.mjs). The build job,
# which runs the build tools, never has credentials; it hands over the zip and
# the request bodies as data (RT fix round 1).
#
# Each command signs in for itself, with GitHub's OIDC token, and keeps the
# one-hour session in its own process: no later step inherits it.
#
#   ops.sh prepare                       check the stack can take a change; PREV_SWITCH to GITHUB_ENV
#   ops.sh settings none         Bedrock logging off, data retention as given
#   ops.sh deploy ZIP SMOKE_JSON [CAP]   upload, update the service, two live test calls
#   ops.sh evaluate REQUESTS_JSONL OUT   the live evaluation, one direct invoke at a time
#   ops.sh switch on|off                 pause or resume: the switch and nothing else
#   ops.sh restore on|off                put the switch back after deploy or evaluate
#   ops.sh remove                        delete the service stack
#
# Needs: ACCOUNT (12 digits), AWS_REGION, and in GitHub Actions the OIDC
# request variables. Exit 0 done, 1 stopped (with a plain-words reason).

set -euo pipefail

: "${AWS_REGION:=us-east-1}"
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION" AWS_PAGER=""
STACK="${STACK:-biasclear-explain}"
FUNCTION="biasclear-explain"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SIGNED_IN_UNTIL=0

summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >>"$GITHUB_STEP_SUMMARY"; fi; }
say() { printf '%s\n' "$*"; summary "$*"; }
fail() { say "$*"; exit 1; }
mask() { if [ -n "${1:-}" ] && [ -n "${GITHUB_ACTIONS:-}" ]; then printf '::add-mask::%s\n' "$1"; fi; }

cfn_role() { printf 'arn:aws:iam::%s:role/biasclear-explain-cloudformation' "$ACCOUNT"; }

signin() {
  if ! [[ "${ACCOUNT:-}" =~ ^[0-9]{12}$ ]]; then
    fail "Stop: the explain-aws environment needs the variable AWS_ACCOUNT_ID (the 12-digit number on the setup stack's Outputs tab)."
  fi
  local token creds
  token="$(curl -sSf -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL:-https://invalid.example}&audience=sts.amazonaws.com" | jq -r '.value // ""')" || token=""
  [ -n "$token" ] || fail "Stop: GitHub didn't give this run a sign-in token for AWS. Nothing was changed."
  mask "$token"
  creds="$(env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
    aws sts assume-role-with-web-identity \
    --role-arn "arn:aws:iam::${ACCOUNT}:role/biasclear-explain-deploy" \
    --role-session-name "explain-${GITHUB_RUN_ID:-local}" \
    --web-identity-token "$token" --duration-seconds 3600 \
    --query Credentials --output json </dev/null)" ||
    fail "Stop: AWS refused GitHub's sign-in for this run. Nothing was changed. Is AWS_ACCOUNT_ID right, and was the run started on main?"
  AWS_ACCESS_KEY_ID="$(jq -r .AccessKeyId <<<"$creds")"
  AWS_SECRET_ACCESS_KEY="$(jq -r .SecretAccessKey <<<"$creds")"
  AWS_SESSION_TOKEN="$(jq -r .SessionToken <<<"$creds")"
  mask "$AWS_ACCESS_KEY_ID"
  mask "$AWS_SECRET_ACCESS_KEY"
  mask "$AWS_SESSION_TOKEN"
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  # Sign in again ten minutes before the hour is up (the evaluation is long).
  SIGNED_IN_UNTIL=$(($(date +%s) + 3000))
}

ensure_signed_in() { if [ "$(date +%s)" -ge "$SIGNED_IN_UNTIL" ]; then signin; fi; }

# The stack's status, or NONE if there is no stack. Returns 1 on any other failure.
stack_status() {
  local out
  if out="$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackStatus' --output text </dev/null 2>&1)"; then
    printf '%s\n' "$out"
  elif grep -q "does not exist" <<<"$out"; then
    echo NONE
  else
    printf '%s\n' "$out" >&2
    return 1
  fi
}

# Writes the switch's current value to GITHUB_ENV as PREV_SWITCH, so the
# workflow's last step can put it back whatever happens in between.
record_prev_switch() {
  local prev="$1"
  [ "$prev" = on ] || prev=off
  if [ -n "${GITHUB_ENV:-}" ]; then echo "PREV_SWITCH=$prev" >>"$GITHUB_ENV"; fi
  echo "PREV_SWITCH=$prev"
}

param_value() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Parameters[?ParameterKey=='$1'].ParameterValue" --output text
}

# Change the switch (and the evaluation key) and nothing else: every other
# parameter keeps its previous value, with the deployed template.
set_params() {
  local switch="$1" key="$2" out
  aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Parameters[].ParameterKey' --output json |
    jq --arg switch "$switch" --arg key "$key" '[.[] |
      if . == "Explain" then {ParameterKey: ., ParameterValue: $switch}
      elif . == "EvaluationKey" then {ParameterKey: ., ParameterValue: $key}
      else {ParameterKey: ., UsePreviousValue: true} end]' >"$TMP/params.json"
  if out="$(aws cloudformation update-stack --stack-name "$STACK" --use-previous-template \
    --role-arn "$(cfn_role)" --parameters "file://$TMP/params.json" 2>&1)"; then
    aws cloudformation wait stack-update-complete --stack-name "$STACK"
  elif grep -q "No updates are to be performed" <<<"$out"; then
    :
  else
    printf '%s\n' "$out" >&2
    return 1
  fi
}

new_key() { openssl rand -hex 32; }

# One direct invoke of the function. $1: payload file, $2: where the reply goes.
invoke() {
  ensure_signed_in
  local meta
  if ! meta="$(AWS_MAX_ATTEMPTS=1 aws lambda invoke --function-name "$FUNCTION" \
    --cli-binary-format raw-in-base64-out --payload "file://$1" \
    --cli-read-timeout 70 --cli-connect-timeout 10 "$2" --output json </dev/null 2>"$TMP/invoke.err")"; then
    return 1
  fi
  jq -e '.StatusCode == 200 and (has("FunctionError") | not)' <<<"$meta" >/dev/null
}

# What a failed test call means, in plain words.
explain_code() {
  case "$1" in
    E_MODEL_RETENTION) echo "Amazon refused zero data retention for this model. Stop and report to Brad; no default or review retention fallback is permitted." ;;
    E_MODEL_ROUTE) echo "Amazon refused the way Explain calls the model (the inference profile). Nothing is wrong with your settings. Tell the PM." ;;
    E_MODEL_DENIED) echo "Amazon denied Explain the model: the budget's automatic stop may have fired, or the model isn't switched on yet (setup step 3)." ;;
    E_MODEL_NOT_FOUND) echo "Amazon says the model isn't available to this account in this Region. Check setup step 3, then tell the PM." ;;
    E_MODEL_THROTTLED | E_MODEL_QUOTA) echo "The model was busy. Run deploy again in a few minutes." ;;
    E_SETTINGS_LOGGING_ON | E_SETTINGS_RETENTION | E_SETTINGS_READ) echo "An account privacy setting doesn't match what Explain expects (Bedrock > Settings)." ;;
    E_HEADROOM | E_RESERVE_MONTH | E_RESERVE_DAY | E_PAUSE_FLAG) echo "A spend limit is reached, or the function paused itself for a few minutes." ;;
    E_SWITCH_OFF) echo "The switch is off." ;;
    E_OUT_*) echo "The model's answer didn't pass the checks this time." ;;
    "") echo "The call failed without a reason code." ;;
    *) echo "The function stopped with the code $1." ;;
  esac
}

cmd_prepare() {
  signin
  local status prev
  status="$(stack_status)" || fail "Stop: could not read Explain's stack in AWS. Nothing was changed."
  case "$status" in
    NONE | REVIEW_IN_PROGRESS)
      prev=off
      say "This is the first deploy: the service will be created, switched on for the test calls, then switched off."
      ;;
    ROLLBACK_COMPLETE)
      say "The last first deploy failed and left an empty stack. It holds nothing (the counters live in the setup), so this run deletes it and creates the service again."
      aws cloudformation delete-stack --stack-name "$STACK" --role-arn "$(cfn_role)"
      aws cloudformation wait stack-delete-complete --stack-name "$STACK"
      prev=off
      ;;
    *_IN_PROGRESS)
      fail "Stop: another change to Explain is still running in AWS ($status). Nothing was changed. Wait ten minutes and run it again."
      ;;
    *_FAILED)
      fail "Stop: Explain's service is stuck in AWS ($status). Nothing was changed. Tell the PM; don't change it in the console."
      ;;
    *)
      prev="$(param_value Explain)"
      [ "$prev" = on ] || prev=off
      ;;
  esac
  record_prev_switch "$prev"
}

cmd_settings() {
  local want="${1:-}" logging retention on mode ok=0
  [ "$want" = none ] || fail "Stop: zero data retention is required. No retention fallback is permitted."
  signin
  logging="$(aws bedrock get-model-invocation-logging-configuration --output json </dev/null)" ||
    fail "Stop: could not read the account's Bedrock logging setting. Nothing was changed."
  if aws bedrock get-account-data-retention --generate-cli-skeleton input >/dev/null 2>&1; then
    retention="$(aws bedrock get-account-data-retention --output json </dev/null)" ||
      fail "Stop: could not read the account's Bedrock data-retention setting. Nothing was changed."
  else
    # An AWS CLI older than the setting: the same signed GET with curl.
    retention="$(curl -sS --fail --max-time 10 --aws-sigv4 "aws:amz:${AWS_REGION}:bedrock" \
      -K <(printf 'user = "%s:%s"\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY") \
      -H "x-amz-security-token: ${AWS_SESSION_TOKEN}" \
      "https://bedrock.${AWS_REGION}.amazonaws.com/data-retention")" ||
      fail "Stop: could not read the account's Bedrock data-retention setting. Nothing was changed."
  fi
  on="$(jq -r 'if .loggingConfig == null then "off" elif (.loggingConfig | type) != "object" then "on" elif (.loggingConfig | length) > 0 then "on" else "off" end' <<<"$logging")"
  mode="$(jq -r '.mode // ""' <<<"$retention")"
  if [ "$on" = on ]; then
    say "Stop: Bedrock model invocation logging is ON in this account. It must be off (Bedrock > Settings)."
    ok=1
  else
    say "Bedrock model invocation logging is off."
  fi
  if [ "$mode" != "$want" ]; then
    say "Stop: the account's Bedrock data-retention mode is \"$mode\", but Explain is set up for \"$want\" (RetentionMode in infra/aws/explain.yaml)."
    ok=1
  else
    say "The account's Bedrock data-retention mode is \"$want\", as expected."
  fi
  return "$ok"
}

valid_answer() { # $1: reply body file, $2: rule
  jq -e --arg rule "$2" '(keys | sort) == ["how","model","plainer","rule","rules","v"] and .v == 1 and .rule == $rule
    and (.how | type) == "string" and (.how | length) > 0 and (.plainer == null or (.plainer | type) == "string")
    and (.model | type) == "string"' "$1" >/dev/null 2>&1
}

post() { # $1: request body file; prints the HTTP status; the reply lands in $TMP/body, headers in $TMP/headers
  local code
  : >"$TMP/body"
  : >"$TMP/headers"
  code="$(curl -sS --max-time 35 -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}' -X POST "$API_URL/v1/explain" \
    -H "origin: $ORIGIN" -H "content-type: application/json" --data-binary "@$1")" || true
  echo "${code:-000}"
}

# The deploy's live test calls. $1: smoke.json from the build, $2: this run's evaluation key.
smoke() {
  local smoke_file="$1" key="$2" rule status code cors
  rule="$(jq -r .rule "$smoke_file")"
  jq -c .notAMark "$smoke_file" >"$TMP/req.json"
  status="$(post "$TMP/req.json")"
  [ "$status" = 422 ] || fail "Stop: a sentence that isn't a mark should be refused with 422, but the service answered $status."
  say "A sentence that isn't a mark was refused, as it should be."

  # The marked sentence, first straight to the function, which says why if it fails.
  jq -c --arg key "$key" '{explainEvaluation: 1, key: $key, request: .marked}' "$smoke_file" >"$TMP/payload.json"
  invoke "$TMP/payload.json" "$TMP/direct.json" || fail "Stop: the direct test call to the function failed. Tell the PM."
  status="$(jq -r .status "$TMP/direct.json")"
  if [ "$status" != 200 ]; then
    code="$(jq -r '.evaluation.code // ""' "$TMP/direct.json")"
    fail "Stop: the made-up marked sentence got no answer ($status, $code). $(explain_code "$code")"
  fi
  jq .body "$TMP/direct.json" >"$TMP/direct-body.json"
  valid_answer "$TMP/direct-body.json" "$rule" || fail "Stop: the function's answer isn't in the expected shape. Tell the PM."

  # Then through the public address, as a visitor's page would call it.
  jq -c .marked "$smoke_file" >"$TMP/req.json"
  status="$(post "$TMP/req.json")"
  cors="$(tr -d '\r' <"$TMP/headers" | awk -F': ' 'tolower($1) == "access-control-allow-origin" {print $2}')"
  if [ "$status" = 200 ] && valid_answer "$TMP/body" "$rule" && [ "$cors" = "$ORIGIN" ]; then
    say "A made-up marked sentence got a valid, checked answer through the public address. Explain works end to end."
    return 0
  fi
  fail "Stop: the public test got status $status. No retry was made; report the failed check."
}

cmd_deploy() {
  local zip="$1" smoke_file="$2" cap="${3:-}" sha key status
  [ -f "$zip" ] && [ -f "$smoke_file" ] || fail "Usage: ops.sh deploy ZIP SMOKE_JSON [CAP]"
  if [ -n "$cap" ] && ! [[ "$cap" =~ ^([1-9]|1[0-9]|2[0-5])$ ]]; then fail "Stop: the monthly cap must be a whole number from 1 to 25, or blank."; fi
  local model="${MODEL:-grok47}"
  node "$HERE/model-table.mjs" --check-key "$model" >/dev/null || fail "Stop: unknown model key; no AWS sign-in."
  signin
  sha="$(sha256sum "$zip" | cut -d' ' -f1)"
  aws s3 cp "$zip" "s3://biasclear-explain-build-${ACCOUNT}/explain/${sha}.zip" --only-show-errors
  key="$(new_key)"
  mask "$key"
  local -a overrides
  local override
  while IFS= read -r override; do overrides+=("$override"); done < <(node "$HERE/deploy-params.mjs")
  [ "${#overrides[@]}" -gt 0 ] || fail "Stop: could not read the service's settings from infra/aws/explain.yaml."
  overrides+=("CodeKey=explain/${sha}.zip" "EvaluationKey=${key}" "Explain=on" "Model=${model}")
  if [ -n "$cap" ]; then overrides+=("MonthlyCapUsd=${cap}"); fi
  aws cloudformation deploy --stack-name "$STACK" \
    --template-file "$HERE/explain.yaml" \
    --role-arn "$(cfn_role)" \
    --parameter-overrides "${overrides[@]}" \
    --tags project=biasclear feature=explain \
    --no-fail-on-empty-changeset
  say "The service is updated with build ${sha:0:12}."
  API_URL="$(aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)"
  # The address stays out of the public logs and summary until the site names it.
  mask "$API_URL"
  mask "${API_URL#https://}"
  mask "$(cut -d. -f1 <<<"${API_URL#https://}")"
  ORIGIN="$(node "$HERE/deploy-params.mjs" --get AllowedOrigins | cut -d, -f1)"
  smoke "$smoke_file" "$key"
}

cmd_evaluate() {
  local requests="$1" out="$2" key planned n=0 line
  [ -f "$requests" ] || fail "Usage: ops.sh evaluate REQUESTS_JSONL OUT"
  node "$HERE/model-table.mjs" --check-key "${MODEL:-grok47}" >/dev/null || fail "Stop: unknown model key; no AWS sign-in."
  signin
  case "$(stack_status || echo UNREADABLE)" in
    NONE | ROLLBACK_COMPLETE | REVIEW_IN_PROGRESS) fail "Stop: there is no Explain service to evaluate. Run deploy first." ;;
    UNREADABLE) fail "Stop: could not read Explain's stack in AWS. Nothing was asked." ;;
    *_IN_PROGRESS) fail "Stop: another change to Explain is still running in AWS. Wait ten minutes and run it again." ;;
    *_FAILED) fail "Stop: Explain's service is stuck in AWS. Tell the PM." ;;
  esac
  local selected
  selected="$(param_value Model)"
  [ "$selected" = "${MODEL:-grok47}" ] || fail "Stop: evaluation model differs from the active stack parameter. No model switch or call was made."
  record_prev_switch "$(param_value Explain)"
  key="$(new_key)"
  mask "$key"
  set_params on "$key" || fail "Stop: could not switch Explain on for the evaluation. Nothing was asked."
  : >"$out"
  planned="$(grep -c . "$requests" || true)"
  while IFS= read -r line <&3; do
    [ -n "$line" ] || continue
    jq -c --arg key "$key" '{explainEvaluation: 1, key: $key, request: .request}' <<<"$line" >"$TMP/payload.json"
    if ! invoke "$TMP/payload.json" "$TMP/reply.json"; then
      jq -c '{id, part, sample, invokeFailed: 1}' <<<"$line" >>"$out"
      fail "Stop: direct call $((n + 1)) of $planned to the function failed. The calls after it were not made, and the report says so. Run evaluate again."
    fi
    jq -c --argjson meta "$line" '{id: $meta.id, part: $meta.part, sample: $meta.sample, status, body, evaluation}' "$TMP/reply.json" >>"$out"
    n=$((n + 1))
    if jq -e '.status == 503 and .body.error == "paused"' "$TMP/reply.json" >/dev/null; then
      say "Stopped after $n of $planned calls: the service answered \"paused\" (a spend limit). Run evaluate again after the next UTC day."
      return 0
    fi
  done 3<"$requests"
  say "All $n of $planned calls ran."
}

cmd_switch() {
  local value="${1:-}"
  [ "$value" = on ] || [ "$value" = off ] || fail "Usage: ops.sh switch on|off"
  if [ "$value" = on ]; then
    node "$HERE/model-table.mjs" --check-key "${MODEL:-grok47}" >/dev/null || fail "Stop: unknown model key; no AWS sign-in."
  fi
  signin
  local status
  status="$(stack_status)" || fail "Stop: could not read Explain's stack in AWS. Nothing was changed."
  case "$status" in
    NONE | ROLLBACK_COMPLETE | REVIEW_IN_PROGRESS) fail "Stop: there is no Explain service to switch. Run deploy first." ;;
    *_IN_PROGRESS) fail "Stop: another change to Explain is still running in AWS ($status). Wait ten minutes and run it again." ;;
    *_FAILED) fail "Stop: Explain's service is stuck in AWS ($status). Tell the PM. For an emergency stop, use the Lambda console's Throttle (README)." ;;
  esac
  if [ "$value" = on ]; then
    [ "$(param_value Model)" = "${MODEL:-grok47}" ] || fail "Stop: resume model differs from the active stack parameter. Nothing was changed."
  fi
  set_params "$value" "" || fail "Stop: the switch could not be changed. Tell the PM."
  say "Explain is now **$value**."
}

# Puts the switch back and clears the evaluation key. If a change is still
# running in AWS (the run was cancelled or timed out while CloudFormation was
# switching Explain on), it waits for that change to finish first, for up to
# RESTORE_POLLS x RESTORE_POLL_SECONDS (25 minutes). It fails the run, in
# plain words, whenever it can't be sure the switch is back: an unreadable or
# stuck stack, a change that doesn't finish, or an update that fails (RT2).
cmd_restore() {
  local value="${1:-off}" status polls="${RESTORE_POLLS:-100}" wait="${RESTORE_POLL_SECONDS:-15}" i
  [ "$value" = on ] || value=off
  local again
  again="$([ "$value" = on ] && echo resume || echo pause)"
  signin
  status="$(stack_status)" || status=UNREADABLE
  for ((i = 0; i < polls; i++)); do
    case "$status" in
      REVIEW_IN_PROGRESS) break ;;
      *_IN_PROGRESS)
        [ "$i" -gt 0 ] || say "A change to Explain is still running in AWS ($status). Waiting for it to finish before switching back."
        sleep "$wait"
        ensure_signed_in
        status="$(stack_status)" || status=UNREADABLE
        ;;
      *) break ;;
    esac
  done
  case "$status" in
    NONE | ROLLBACK_COMPLETE | REVIEW_IN_PROGRESS | DELETE_COMPLETE)
      say "Nothing to switch back: there is no running Explain service (the stack is $status)."
      return 0
      ;;
    *_IN_PROGRESS)
      say "Stop: a change to Explain was still running in AWS after 25 minutes, so Explain may still be on. Run \"$again\" now."
      return 1
      ;;
    UNREADABLE)
      say "Stop: could not read Explain's stack in AWS, so Explain may still be on. Run \"$again\" now."
      return 1
      ;;
    *_FAILED)
      say "Stop: Explain's service is stuck in AWS ($status), so Explain may still be on. Tell the PM. For an emergency stop, use the Lambda console's Throttle (README)."
      return 1
      ;;
  esac
  if set_params "$value" ""; then
    say "Explain is **$value**, as it was before this run."
  else
    say "Stop: could not switch Explain back to $value. Run \"$again\" now."
    return 1
  fi
}

cmd_remove() {
  signin
  local status
  status="$(stack_status)" || fail "Stop: could not read Explain's stack in AWS. Nothing was changed."
  if [ "$status" = NONE ]; then
    say "There is no Explain service to delete."
    return 0
  fi
  aws cloudformation delete-stack --stack-name "$STACK" --role-arn "$(cfn_role)"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK"
  say "The Explain service is deleted. The month's spending count stays in the setup, so the \$25 stop still holds if you deploy again this month. See infra/aws/README.md to remove the setup too."
}

main() {
  local command="${1:-}"
  shift || true
  case "$command" in
    prepare) cmd_prepare "$@" ;;
    settings) cmd_settings "$@" ;;
    deploy) cmd_deploy "$@" ;;
    evaluate) cmd_evaluate "$@" ;;
    switch) cmd_switch "$@" ;;
    restore) cmd_restore "$@" ;;
    remove) cmd_remove "$@" ;;
    *) fail "Usage: ops.sh prepare|settings|deploy|evaluate|switch|restore|remove [arguments]" ;;
  esac
}

main "$@"
