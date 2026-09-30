# BiasClear

**See how a text is built to move you.** BiasClear is a free persuasion checker. It marks the moves a text makes on its reader and names each one. It points at structure, never at people.

This is the Python engine. The same rules run in your browser at [biasclear.github.io/biasclear](https://biasclear.github.io/biasclear/), and nothing you type there is sent anywhere.

## Use

It needs Python 3.10 or later and nothing else.

```python
from biasclear import scan

result = scan("Everyone knows this kettle is the best. Top groups agree. Only a fool would wait. Act now.")
for move in result["moves"]:
    print(move["tier"], move["rule_id"], repr(move["match"]))
```

```text
1 CONSENSUS_AS_EVIDENCE 'Everyone knows'
3 VAGUE_INSTITUTIONAL_APPEAL 'Top groups agree'
2 SHAME_LEVER 'Only a fool'
2 FEAR_URGENCY 'Act now'
```

From a shell, it reads UTF-8 text on stdin and prints the result as JSON:

```bash
echo "Studies show this works." | python -m biasclear
python -m biasclear --domain all < draft.txt
```

Each move has a `rule_id`, a `name`, a `tier`, a `domain`, a `severity` (a hand-set label carried over from v1, not a score) and `start` and `end` offsets into the text. `result["rules_version"]` and `result["rules_hash"]` say exactly which rules ran.

## What it is not

- **Not a fact-checker.** It checks the shape of the wording, not the facts. A marked sentence can be true, and an unmarked one can be false.
- **No truth score, no verdict.** It names moves and counts them by tier.
- **Not an AI model.** The rules are fixed patterns, and nothing is learned from what you scan.
- **Not complete.** It misses persuasion put in other words, tone and insinuation. It is designed for English; coverage in other languages has not been evaluated.

The rules are an alpha and will change. How often they are right on new text has not been measured yet.

## More

- Source, tests and the rule pack: [github.com/biasclear/biasclear](https://github.com/biasclear/biasclear)
- What each move is and what the rules miss: [the Field Guide](https://biasclear.github.io/biasclear/guide/) and [the Method page](https://biasclear.github.io/biasclear/method.html)
- Every rule change and why: [rules/RULE_CHANGES.md](https://github.com/biasclear/biasclear/blob/main/rules/RULE_CHANGES.md)
- Changes by version: [CHANGELOG.md](https://github.com/biasclear/biasclear/blob/main/CHANGELOG.md)

The code is licensed under the Apache License 2.0, and the rule pack under CC BY 4.0. Contact: hello@biasclear.com
