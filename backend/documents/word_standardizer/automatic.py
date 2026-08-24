"""Server-owned, content-aware Word formatting policy for generated exports.

The policy operates on template bytes before record context is merged.  It never
receives tenant data and it always returns the original template when detection,
normalization or preservation verification is not safe.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from io import BytesIO
import json
import os
import re
from zipfile import ZipFile

from lxml import etree

from .engine import (
    ENGINE_VERSION,
    WordStandardizationError,
    process_docx,
    standardization_rule_set_sha256,
)


AUTOMATIC_POLICY_ID = "biddingflow-word-export-auto"
AUTOMATIC_POLICY_VERSION = "1.0.0"
AUTOMATIC_MODES = frozenset({"off", "shadow", "apply_safe"})
MAX_AUTOMATIC_STORY_PARTS = 64
MAX_AUTOMATIC_STORY_XML_BYTES = 8 * 1024 * 1024
MAX_AUTOMATIC_STYLES_XML_BYTES = 4 * 1024 * 1024
MAX_AUTOMATIC_PARAGRAPHS = 5_000
MAX_AUTOMATIC_RUNS = 20_000
MAX_AUTOMATIC_STYLES = 5_000

_STORY_PART = re.compile(
    r"^word/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$",
    re.IGNORECASE,
)
_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_PARAGRAPH_TAG = f"{{{_W_NS}}}p"
_RUN_TAG = f"{{{_W_NS}}}r"
_STYLE_TAG = f"{{{_W_NS}}}style"

_STRICT_DOCUMENT_TYPES = frozenset({
    "cong_dien",
    "cong_van",
    "nghi_dinh",
    "nghi_quyet_ca_biet",
    "quyet_dinh_truc_tiep",
})
_CONSERVATIVE_CONTEXT_HINTS = frozenset({
    "contract",
    "evaluation",
    "hsmt",
    "liquidation",
    "opening",
})


@dataclass(frozen=True)
class AutomaticWordStandardizationResult:
    content: bytes
    metadata: dict


def _canonical(value) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _sha256_json(value) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


_POLICY_SHA256 = _sha256_json({
    "id": AUTOMATIC_POLICY_ID,
    "version": AUTOMATIC_POLICY_VERSION,
    "modes": sorted(AUTOMATIC_MODES),
    "strictDocumentTypes": sorted(_STRICT_DOCUMENT_TYPES),
    "strictRequiresTypeEvidence": True,
    "complexityLimits": {
        "storyParts": MAX_AUTOMATIC_STORY_PARTS,
        "storyXmlBytes": MAX_AUTOMATIC_STORY_XML_BYTES,
        "stylesXmlBytes": MAX_AUTOMATIC_STYLES_XML_BYTES,
        "paragraphs": MAX_AUTOMATIC_PARAGRAPHS,
        "runs": MAX_AUTOMATIC_RUNS,
        "styles": MAX_AUTOMATIC_STYLES,
    },
    "conservativeContextHints": sorted(_CONSERVATIVE_CONTEXT_HINTS),
    "unknown": "reference_only",
    "signed": "skip",
    "failure": "original_template",
})


def automatic_standardization_mode(value: str | None = None) -> str:
    configured = (
        os.environ.get("WORD_EXPORT_STANDARDIZATION_MODE", "apply_safe")
        if value is None else value
    )
    normalized = str(configured or "").strip().casefold()
    return normalized if normalized in AUTOMATIC_MODES else "off"


def automatic_standardization_cache_identity(
    *, document_type_hint: str | None = None, mode: str | None = None,
) -> dict[str, str]:
    """Version identity for an immutable prepared-template cache entry."""

    return {
        "policyId": AUTOMATIC_POLICY_ID,
        "policyVersion": AUTOMATIC_POLICY_VERSION,
        "policySha256": _POLICY_SHA256,
        "engineVersion": ENGINE_VERSION,
        "ruleSetSha256": standardization_rule_set_sha256(),
        "validatorVersion": "docx-archive-and-template-statements.v1",
        "mode": automatic_standardization_mode(mode),
        "documentTypeHint": str(document_type_hint or "").strip().casefold()[:64],
    }


def _base_metadata(content: bytes, mode: str, hint: str) -> dict:
    return {
        "policyId": AUTOMATIC_POLICY_ID,
        "policyVersion": AUTOMATIC_POLICY_VERSION,
        "policySha256": _POLICY_SHA256,
        "mode": mode,
        "status": "OFF",
        "sourceSha256": hashlib.sha256(content).hexdigest(),
        "outputSha256": hashlib.sha256(content).hexdigest(),
        "documentTypeHint": hint,
        "effectiveProfile": "reference_only",
        "engineVersion": ENGINE_VERSION,
        "preservation": "NOT_RUN",
    }


def _automatic_complexity(content: bytes) -> dict:
    """Cheaply bound repeated analysis while leaving render validation intact."""

    with ZipFile(BytesIO(content)) as archive:
        story_parts = [
            info for info in archive.infolist()
            if _STORY_PART.fullmatch(info.filename)
        ]
        style_parts = [
            info for info in archive.infolist()
            if info.filename.casefold() == "word/styles.xml"
        ]
        story_bytes = sum(max(0, int(info.file_size)) for info in story_parts)
        styles_bytes = sum(max(0, int(info.file_size)) for info in style_parts)
        result = {
            "storyPartCount": len(story_parts),
            "storyXmlBytes": story_bytes,
            "stylesXmlBytes": styles_bytes,
            "paragraphCount": 0,
            "runCount": 0,
            "styleCount": 0,
        }
        if (
            len(story_parts) > MAX_AUTOMATIC_STORY_PARTS
            or story_bytes > MAX_AUTOMATIC_STORY_XML_BYTES
            or len(style_parts) > 1
            or styles_bytes > MAX_AUTOMATIC_STYLES_XML_BYTES
        ):
            result["exceeded"] = True
            return result
        for info in story_parts:
            xml = archive.read(info)
            if b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
                raise WordStandardizationError(
                    "DOCX XML declarations are not supported."
                )
            root = etree.fromstring(
                xml,
                parser=etree.XMLParser(
                    resolve_entities=False,
                    no_network=True,
                    remove_blank_text=False,
                    recover=False,
                    huge_tree=False,
                ),
            )
            for element in root.iter():
                if element.tag == _PARAGRAPH_TAG:
                    result["paragraphCount"] += 1
                elif element.tag == _RUN_TAG:
                    result["runCount"] += 1
            if (
                result["paragraphCount"] > MAX_AUTOMATIC_PARAGRAPHS
                or result["runCount"] > MAX_AUTOMATIC_RUNS
            ):
                result["exceeded"] = True
                return result
        for info in style_parts:
            xml = archive.read(info)
            if b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
                raise WordStandardizationError(
                    "DOCX XML declarations are not supported."
                )
            root = etree.fromstring(
                xml,
                parser=etree.XMLParser(
                    resolve_entities=False,
                    no_network=True,
                    remove_blank_text=False,
                    recover=False,
                    huge_tree=False,
                ),
            )
            result["styleCount"] += sum(
                1 for element in root.iter() if element.tag == _STYLE_TAG
            )
            if result["styleCount"] > MAX_AUTOMATIC_STYLES:
                result["exceeded"] = True
                return result
        result["exceeded"] = False
        return result


def _decision(report: dict, hint: str) -> tuple[str, str, list[str]]:
    detected = report.get("documentType") or {}
    detected_type = str(detected.get("value") or "unknown")
    confidence = float(detected.get("confidence") or 0)
    conflicts = detected.get("conflicts") or []
    signature = report.get("packageSignature") or {}
    safe_semantics = {
        str(field.get("semantic") or "")
        for field in (report.get("fields") or [])
        if field.get("mutationSafe")
        and field.get("semantic") != "document.signing_authority"
    }
    coherent_shell = len(safe_semantics) >= 2
    strict_type_evidence = (
        "document.type" in safe_semantics
        or (
            detected_type == "cong_van"
            and {
                "document.office_letter_subject",
                "document.primary_addressees",
            }.issubset(safe_semantics)
        )
    )

    if signature.get("detected"):
        return "reference_only", "SKIPPED_SIGNED", ["OPC_SIGNATURE"]
    if conflicts:
        return "reference_only", "BYPASSED_CONFLICT", ["TYPE_CONFLICT"]
    if detected_type == "unknown" or confidence < 0.90 or not coherent_shell:
        return "reference_only", "BYPASSED_LOW_CONFIDENCE", [
            "UNKNOWN_OR_INCOHERENT",
        ]
    if hint not in _CONSERVATIVE_CONTEXT_HINTS and (
        detected_type in _STRICT_DOCUMENT_TYPES
        and confidence >= 0.96
        and strict_type_evidence
    ):
        return "n30_strict", "READY", [
            "STRICT_TYPE_ALLOWLIST",
            "COHERENT_SHELL",
        ]
    return "sector_template", "READY", [
        "CONSERVATIVE_SECTOR_RULES",
        "COHERENT_SHELL",
    ]


def _summarize_plan(
    metadata: dict,
    report: dict,
    *,
    profile: str,
    status: str,
    reason_codes: list[str],
    fallback_from: str | None = None,
) -> dict:
    planned = report.get("plannedChanges") or []
    detected = report.get("documentType") or {}
    summarized = dict(metadata)
    summarized.update({
        "status": status,
        "effectiveProfile": profile,
        "reasonCodes": list(reason_codes),
        "detectedDocumentType": str(detected.get("value") or "unknown")[:64],
        "documentTypeConfidence": round(
            float(detected.get("confidence") or 0), 4
        ),
        "documentTypeConflictCount": len(detected.get("conflicts") or []),
        "ruleSetSha256": str(
            ((report.get("ruleSet") or {}).get("sha256") or "")
        )[:64],
        "analysisHash": str(report.get("analysisHash") or "")[:64],
        "plannedRuleCount": len(planned),
        "plannedTargetCount": sum(
            int(item.get("affectedCount") or 0) for item in planned
        ),
        "plannedChangeDigest": _sha256_json(planned),
        "fallbackFrom": fallback_from,
    })
    summarized["decisionHash"] = _sha256_json({
        key: summarized.get(key)
        for key in (
            "policySha256",
            "sourceSha256",
            "documentTypeHint",
            "effectiveProfile",
            "reasonCodes",
            "ruleSetSha256",
            "analysisHash",
            "plannedChangeDigest",
        )
    })
    return summarized


def standardize_template_for_export(
    content: bytes,
    *,
    document_type_hint: str | None = None,
    mode: str | None = None,
) -> AutomaticWordStandardizationResult:
    """Recognize and safely format a DOCX template without user input.

    `off` and `shadow` are operational rollback/canary modes, never permissions.
    In all error, signed, ambiguous and unsupported cases the source bytes are
    returned unchanged.
    """

    source = bytes(content)
    selected_mode = automatic_standardization_mode(mode)
    hint = str(document_type_hint or "").strip().casefold()[:64]
    metadata = _base_metadata(source, selected_mode, hint)
    if selected_mode == "off":
        return AutomaticWordStandardizationResult(source, metadata)

    try:
        complexity = _automatic_complexity(source)
        if complexity.pop("exceeded"):
            metadata.update({
                "status": "BYPASSED_COMPLEXITY",
                "reasonCodes": ["COMPLEXITY_BUDGET"],
                **complexity,
            })
            return AutomaticWordStandardizationResult(source, metadata)
        pass_mode = "apply_fix" if selected_mode == "apply_safe" else "preview_fix"
        sector_pass = process_docx(
            source,
            profile="sector_template",
            mode=pass_mode,
            _trusted_automatic_pass=selected_mode == "apply_safe",
        )
        sector_preview = sector_pass.report
        profile, disposition, reasons = _decision(sector_preview, hint)
        if profile == "reference_only":
            metadata = _summarize_plan(
                metadata,
                sector_preview,
                profile=profile,
                status=disposition,
                reason_codes=reasons,
            )
            metadata["preservation"] = "PASS"
            return AutomaticWordStandardizationResult(source, metadata)

        selected_pass = sector_pass
        fallback_from = None
        if profile == "n30_strict":
            try:
                selected_pass = process_docx(
                    source,
                    profile="n30_strict",
                    mode=pass_mode,
                    _trusted_automatic_pass=selected_mode == "apply_safe",
                )
            except WordStandardizationError:
                profile = "sector_template"
                selected_pass = sector_pass
                fallback_from = "n30_strict"
                reasons = ["STRICT_FALLBACK", *reasons]
        preview = selected_pass.report
        metadata = _summarize_plan(
            metadata,
            preview,
            profile=profile,
            status="SHADOW" if selected_mode == "shadow" else disposition,
            reason_codes=reasons,
            fallback_from=fallback_from,
        )
        metadata["preservation"] = str(
            (preview.get("invariants") or {}).get("status") or "NOT_RUN"
        )
        if selected_mode == "shadow":
            return AutomaticWordStandardizationResult(source, metadata)
        if not preview.get("changed"):
            metadata["status"] = "NO_CHANGE"
            return AutomaticWordStandardizationResult(source, metadata)

        candidate = selected_pass.content
        if not isinstance(candidate, bytes):
            raise WordStandardizationError(
                "Automatic Word formatting produced no DOCX bytes."
            )
        invariant_status = str(
            (selected_pass.report.get("invariants") or {}).get("status") or ""
        )
        if invariant_status != "PASS":
            raise WordStandardizationError(
                "Automatic Word formatting failed preservation checks."
            )
        metadata["status"] = "APPLIED"
        metadata["preservation"] = "PASS"
        metadata["outputSha256"] = hashlib.sha256(candidate).hexdigest()
        return AutomaticWordStandardizationResult(candidate, metadata)
    except Exception as error:  # noqa: BLE001 - export must safely keep original bytes
        metadata.update({
            "status": "BYPASSED_ERROR",
            "errorType": type(error).__name__[:96],
            "preservation": "NOT_RUN",
        })
        return AutomaticWordStandardizationResult(source, metadata)


__all__ = [
    "AUTOMATIC_MODES",
    "AUTOMATIC_POLICY_ID",
    "AUTOMATIC_POLICY_VERSION",
    "AutomaticWordStandardizationResult",
    "automatic_standardization_cache_identity",
    "automatic_standardization_mode",
    "standardize_template_for_export",
]
