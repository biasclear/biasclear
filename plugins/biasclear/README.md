# BiasClear for Claude

This plugin lets Claude mark common persuasion moves in English text you give it, using BiasClear's open rules, and explain each move in plain words. Examples of moves are "everyone agrees" offered in place of evidence, "act now" urgency, and an authority quoted with no source. BiasClear reads wording only. It never judges whether a claim is true, and it never judges people, parties or institutions. It misses moves made in other words.

## Install

In Claude Code, run:

```
/plugin install biasclear --marketplace biasclear/biasclear
```

On older versions of Claude Code, use two steps:

```
/plugin marketplace add biasclear/biasclear
/plugin install biasclear@biasclear
```

## How to use it

After installing the plugin, give Claude some text and ask, for example:

- "Check this article with BiasClear."
- "What persuasion moves does this ad use?"
- "Run BiasClear on this speech, using the news rules."

Claude puts the text in a temporary file and runs BiasClear's bundled script on it. It then deletes the file. Claude lists each marked phrase with the move's name and what the move does, and ends with how to read the result.

You can also run the script yourself, with Python 3.9 or newer:

```bash
python3 -I skills/biasclear/scripts/biasclear_scan.py --file my-text.txt
```

## What it runs, sends and keeps

- **Runs:** one Python script, `skills/biasclear/scripts/biasclear_scan.py`, which uses only Python's standard library.
  - It rejoins the bundled rule pack and checks the pack's fingerprint (the rules hash) before anything runs. It refuses a missing, damaged or changed pack.
  - It then runs the bundled BiasClear engine on the text, in memory.
  - In Claude Code the script runs on your computer. In the Claude app it runs in Claude's code sandbox.
- **Sends:** the script makes no network connections and fetches nothing. The text you check is part of your conversation with Claude, so it is not private the way BiasClear's browser checker is.
- **Keeps:** the script writes nothing to disk and keeps no log. To hand your text to the script, Claude writes it to a temporary file and deletes it afterwards.

## Limits

Here are some of the limits the BiasClear project publishes. The full list of misses is on the [Method page](https://github.com/biasclear/biasclear/blob/main/site/pages/method.html).

- A mark is a prompt to look closer, not a finding. Some harmless wording gets marked.
- No marks does not mean no persuasion. The rules miss persuasion put in other words, tone and insinuation.
- How often the rules are right on new text has not been measured yet.
- Some rules stay quiet when something shaped like a citation sits beside the claim. The rules check the shape of a citation, not whether the source exists.
- A quoted phrase is marked the same as one the writer uses.
- The swapped-side tests still list known gaps, where the same kind of wording is marked when it is aimed at one side and not the other. They are listed in [rules/RULE_CHANGES.md](https://github.com/biasclear/biasclear/blob/main/rules/RULE_CHANGES.md).
- The rules are written for English.

## What's inside

- `.claude-plugin/plugin.json`: the plugin's name card.
- `skills/biasclear/SKILL.md`: the instructions Claude follows.
- `skills/biasclear/scripts/biasclear_scan.py`: the script Claude runs.
- `skills/biasclear/engine/biasclear/`: a copy of BiasClear's Python engine.
- `skills/biasclear/rules/`: the rule pack, as `header.json` plus `rules-NN.json` shards of whole rules. `PACK.json` records the rules version and hash.

The pack is split only to keep each file small. The script rejoins it and refuses to run if the rejoined pack's hash doesn't match.

The engine copy, the rule pack and the plugin's version are generated from the main repository by `scripts/sync_claude_plugin.py`. The repository's tests fail if they ever differ from the source.

## License

The code is under the Apache License 2.0 (`LICENSE`). The rule pack is under CC BY 4.0 (`skills/biasclear/rules/LICENSE`). Source, method and tests: https://github.com/biasclear/biasclear
