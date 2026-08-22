import json
from pathlib import Path
import subprocess

from backend.documents.word_publication_policy import WORD_PUBLICATION_DOCUMENTS


def test_frontend_word_publication_policy_matches_authoritative_backend_metadata():
    project_root = Path(__file__).resolve().parents[1]
    script = """
      import { WORD_PUBLICATION_DOCUMENTS } from './frontend/documents/WordPublicationPolicy.js';
      const contract = WORD_PUBLICATION_DOCUMENTS.map((item) => ({
        id: item.id,
        label: item.label,
        scope: item.exportTarget.scope,
        contextType: item.exportTarget.reportType,
        applicability: item.applicability,
        legacyActiveFallback: item.legacyActiveFallback === true,
      }));
      process.stdout.write(JSON.stringify(contract));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=project_root,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    frontend_contract = json.loads(result.stdout)
    backend_contract = [
        {
            "id": item.id,
            "label": item.label,
            "scope": item.scope,
            "contextType": item.context_type,
            "applicability": item.applicability,
            "legacyActiveFallback": item.legacy_active_fallback,
        }
        for item in WORD_PUBLICATION_DOCUMENTS
    ]

    assert frontend_contract == backend_contract
