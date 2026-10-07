"""BiasClear: a rule-based persuasion linter built on Persistent Influence Theory.

It names the structural moves a text makes. It points at structure, never at
people, and it is not a fact-checker.

    >>> from biasclear import scan
    >>> [m["rule_id"] for m in scan("Everyone agrees this is right.")["moves"]]
    ['CONSENSUS_AS_EVIDENCE']
"""

from ._engine import DOMAINS, MAX_INPUT_CHARS, rule_pack, scan

__version__ = "2.0.0a1"

__all__ = ["DOMAINS", "MAX_INPUT_CHARS", "__version__", "rule_pack", "scan"]
