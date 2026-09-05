"""Remove redundant AI/lookup overrides without exposing their values.

Dry-run by default. Each file is checked independently against the real readers.
No provider calls, database writes, credential rotation or service restart.
"""
from __future__ import annotations

import argparse
from io import StringIO
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import dotenv_values
from backend.ai.configuration import get_ai_config
from backend.procurement_lookup.config import ProcurementLookupSettings

OPTIONAL_KEYS = frozenset({
    "AI_BASE_URL", "AI_PROVIDER_ALLOWED_HOSTS", "AI_KNOWLEDGE_ENABLED",
    "AI_PROVIDER_STORE_RESPONSES", "AI_DAILY_REQUEST_LIMIT", "AI_DAILY_TOKEN_LIMIT",
    "AI_WEB_SEARCH_PROVIDER", "AI_WEB_SEARCH_API_KEY", "AI_WEB_SEARCH_MODEL",
    "AI_WEB_SEARCH_ALLOWED_DOMAINS", "PROCUREMENT_BROWSER_MODE",
    "RESEARCH_STEALTH_ENABLED", "RESEARCH_STEALTH_ALLOWED_TARGET_HOSTS",
})
RETIRED_KEYS = frozenset({"WORD_EXPORT_STANDARDIZATION_MODE"})
ASSIGNMENT = re.compile(r"^([A-Z][A-Z0-9_]*)=")


def configuration(values):
    return get_ai_config(values), ProcurementLookupSettings.from_environ(values)


def simplify(text, process_environment=None):
    """Return new text and removed key names; retain non-equivalent overrides."""
    process_environment = dict(process_environment or {})
    values = dict(dotenv_values(stream=StringIO(text)))
    baseline = configuration(values)
    effective_baseline = configuration({**values, **process_environment})
    removed = set(RETIRED_KEYS & values.keys())
    # Incremental checks also protect interactions between fallback variables.
    for key in sorted(OPTIONAL_KEYS & values.keys()):
        candidate = {k: v for k, v in values.items() if k not in removed | {key}}
        try:
            same = (configuration(candidate) == baseline
                    and configuration({**candidate, **process_environment}) == effective_baseline)
        except ValueError:
            same = False
        if same:
            removed.add(key)
    lines = text.splitlines(keepends=True)
    output = []
    for line in lines:
        match = ASSIGNMENT.match(line)
        if match and match[1] in removed:
            # Remove only the adjacent variable description, not section headings.
            if output and output[-1].startswith('# ') and not re.match(r'# (?:\d+\.|=)', output[-1]):
                output.pop()
            continue
        output.append(line)
    result = ''.join(output)
    parsed = dict(dotenv_values(stream=StringIO(result)))
    if parsed != {k: v for k, v in values.items() if k not in removed}:
        raise ValueError('Remaining configuration changed; refusing rewrite')
    if configuration(parsed) != baseline or configuration({**parsed, **process_environment}) != effective_baseline:
        raise ValueError('Configuration parity failed; refusing rewrite')
    return result, sorted(removed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    prepared = []
    for name in ('.env', '.env.example'):
        path = ROOT / name
        raw = path.read_bytes()
        bom = b'\xef\xbb\xbf' if raw.startswith(b'\xef\xbb\xbf') else b''
        result, removed = simplify(raw.decode('utf-8-sig'), os.environ)
        prepared.append((path, raw, bom + result.encode('utf-8'), removed))
    for path, raw, result, removed in prepared:
        if path.read_bytes() != raw:
            raise RuntimeError('Concurrent edit detected; refusing rewrite')
        if args.apply:
            path.write_bytes(result)
        print(f'{path.name}: {len(removed)} keys; ' + ', '.join(removed))
    print('Applied' if args.apply else 'Dry run; use --apply to write')


if __name__ == '__main__':
    main()
