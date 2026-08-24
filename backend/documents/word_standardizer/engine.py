"""Nghị định 30 structural audit and conservative OOXML normalization.

The module deliberately edits OOXML properties in place. It never rewrites
business text, merges/splits runs, or replaces BiddingFlow's template engine.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from functools import lru_cache
import hashlib
from importlib import resources
from io import BytesIO
import json
import re
import unicodedata
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree

from backend.documents.archive_validation import validate_ooxml_archive
from backend.documents.template_security import validate_docx_template_statements


ENGINE_VERSION = "biddingflow-word-standardizer.v1.2"
REPORT_SCHEMA_VERSION = 1
SUPPORTED_MODES = frozenset({"audit", "preview_fix", "apply_fix"})
SUPPORTED_PROFILES = frozenset({
    "n30_strict",
    "sector_template",
    "reference_only",
})
MAX_REPORT_FIELDS = 256
MAX_REPORT_ISSUES = 256
MAX_ISSUE_SAMPLES = 20
MAX_REPORT_BYTES = 768 * 1024

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_W = f"{{{_W_NS}}}"
_NS = {"w": _W_NS}
_XML_TEXT_PART = re.compile(
    r"^word/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$",
    re.IGNORECASE,
)
_OPC_SIGNATURE_PART = re.compile(r"^_xmlsignatures/", re.IGNORECASE)
_OPC_SIGNATURE_RELATIONSHIP = b"digital-signature"
_PLACEHOLDER_PATTERNS = (
    re.compile(r"\{\{.*?\}\}", re.DOTALL),
    re.compile(r"\{%.*?%\}", re.DOTALL),
    re.compile(r"\[\[[^\]\r\n]+\]\]"),
    re.compile(r"\$\{[^}\r\n]+\}"),
    re.compile(r"<<[^>\r\n]+>>"),
)
_SIGNING_AUTHORITY = re.compile(
    r"^(?:"
    r"(?:TM\.|Q\.|KT\.|TL\.|TUQ\.)"
    r"|(?:PHÓ\s+)?(?:CHỦ TỊCH|GIÁM ĐỐC|TỔNG GIÁM ĐỐC|BỘ TRƯỞNG|"
    r"THỨ TRƯỞNG|CỤC TRƯỞNG|VỤ TRƯỞNG|CHÁNH VĂN PHÒNG|HIỆU TRƯỞNG)\s*$"
    r"|(?:PHÓ\s+)?TRƯỞNG\s+(?:BAN|PHÒNG|BỘ PHẬN)\s*$"
    r"|ĐẠI DIỆN(?:\s+(?:BÊN\s+[AB]|CHỦ ĐẦU TƯ|NHÀ THẦU|ĐƠN VỊ))?\s*$"
    r"|NGƯỜI\s+(?:KÝ|LẬP|KIỂM TRA|PHÊ DUYỆT)\s*$"
    r"|KẾ TOÁN TRƯỞNG\s*$"
    r")",
    re.IGNORECASE,
)
_ISSUE_DATE = re.compile(
    r"\bngày\s+\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+\d{4}\b",
    re.IGNORECASE,
)
_ADMINISTRATIVE_HEADING = re.compile(
    r"^(?:"
    r"phần(?:\s+thứ)?\s+(?:[ivxlcdm]+|\d+|[a-zđ])"
    r"|chương\s+(?:[ivxlcdm]+|\d+)"
    r"|mục\s+\d+(?:\.\d+)*"
    r"|tiểu\s+mục\s+\d+(?:\.\d+)*"
    r"|điều\s+\d+(?:\.\d+)*"
    r")\b",
    re.IGNORECASE,
)
_NAMED_DOCUMENT_TYPES = {
    "CHỈ THỊ": "chi_thi",
    "QUY CHẾ": "quy_che",
    "QUY ĐỊNH": "quy_dinh",
    "THÔNG CÁO": "thong_cao",
    "THÔNG BÁO": "thong_bao",
    "HƯỚNG DẪN": "huong_dan",
    "CHƯƠNG TRÌNH": "chuong_trinh",
    "KẾ HOẠCH": "ke_hoach",
    "PHƯƠNG ÁN": "phuong_an",
    "ĐỀ ÁN": "de_an",
    "DỰ ÁN": "du_an",
    "BÁO CÁO": "bao_cao",
    "TỜ TRÌNH": "to_trinh",
    "GIẤY ỦY QUYỀN": "giay_uy_quyen",
    "PHIẾU GỬI": "phieu_gui",
    "PHIẾU CHUYỂN": "phieu_chuyen",
    "PHIẾU BÁO": "phieu_bao",
}
_SHELL_SEMANTICS = frozenset({
    "document.national_header",
    "document.motto",
    "document.number",
    "document.symbol",
    "document.location",
    "document.issue_date",
    "document.type",
    "document.subject",
    "document.office_letter_subject",
    "document.primary_addressees",
    "document.signing_authority",
    "document.recipients",
    "appendix.index",
    "appendix.title",
})

# ECMA-376 CT_RPr/CT_PPr child order. The engine only adds a subset of these
# properties, but ranking against the complete common sequence keeps inserted
# nodes valid when a template already contains unrelated properties.
_RPR_ORDER = (
    "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps",
    "strike", "dstrike", "outline", "shadow", "emboss", "imprint",
    "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing",
    "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect",
    "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang",
    "eastAsianLayout", "specVanish", "oMath", "rPrChange",
)
_PPR_ORDER = (
    "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr",
    "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs",
    "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct",
    "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd",
    "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents",
    "suppressOverlap", "jc", "textDirection", "textAlignment",
    "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr",
    "pPrChange",
)
_PROPERTY_ORDER = {
    _qn_name: {name: index for index, name in enumerate(sequence)}
    for _qn_name, sequence in (("rPr", _RPR_ORDER), ("pPr", _PPR_ORDER))
}


class WordStandardizationError(ValueError):
    """Raised when a requested profile/mode or invariant is invalid."""


@dataclass(frozen=True)
class WordStandardizationResult:
    report: dict
    content: bytes | None = None


class _BoundedInventory:
    def __init__(self, limit: int):
        self.limit = int(limit)
        self.items = []
        self.count = 0
        self._digest = hashlib.sha256()

    def add(self, value) -> None:
        encoded = _canonical(value).encode("utf-8")
        self._digest.update(len(encoded).to_bytes(8, "big"))
        self._digest.update(encoded)
        self.count += 1
        if len(self.items) < self.limit:
            self.items.append(value)

    def metadata(self) -> dict:
        return {
            "totalCount": self.count,
            "sampleCount": len(self.items),
            "digest": self._digest.hexdigest(),
            "truncated": self.count > len(self.items),
        }


class _IssueInventory(_BoundedInventory):
    def __init__(self, rules: dict, *, signed_package=False):
        super().__init__(MAX_REPORT_ISSUES)
        self.rules = rules
        self.signed_package = bool(signed_package)
        self.rule_ids = defaultdict(set)
        self.affected_counts = Counter()

    def add(self, value) -> None:
        issue = dict(value)
        issue.setdefault(
            "citations", _issue_citations(issue["ruleId"], self.rules)
        )
        if self.signed_package and issue.get("fixPolicy") != "MANUAL_REVIEW":
            issue["fixPolicy"] = "MANUAL_REVIEW"
        policy = str(issue.get("fixPolicy") or "MANUAL_REVIEW")
        self.rule_ids[policy].add(str(issue.get("ruleId") or "UNKNOWN"))
        self.affected_counts[policy] += int(issue.get("affectedCount") or 0)
        super().add(issue)

    append = add


class _Samples:
    def __init__(self, limit=MAX_ISSUE_SAMPLES):
        self.limit = int(limit)
        self.items = []
        self.count = 0

    def add(self, value) -> None:
        self.count += 1
        if len(self.items) < self.limit:
            self.items.append(value)


@dataclass
class _Paragraph:
    part: str
    index: int
    element: object
    text: str
    runs: list
    semantic: str | None = None
    confidence: float = 0.0
    zone: str = "main_body"
    structural_candidate: bool = False
    sector_safe: bool = False


def _qn(local: str) -> str:
    return f"{_W}{local}"


def _canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash_json(value) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _normalized(value: str) -> str:
    return re.sub(
        r"\s+",
        " ",
        unicodedata.normalize("NFKC", str(value or "")).strip(),
    ).casefold()


def _mm_to_twips(value: float) -> int:
    return round(float(value) / 25.4 * 1440)


def _twips_to_mm(value) -> float | None:
    try:
        return round(int(value) * 25.4 / 1440, 2)
    except (TypeError, ValueError):
        return None


def _half_points(value) -> float | None:
    try:
        return int(value) / 2
    except (TypeError, ValueError):
        return None


def _validate_rule_bundle(rule_set: dict, semantic_fields: dict) -> None:
    try:
        metadata = rule_set["rule_set"]
        profiles = rule_set["profiles"]
        contract = rule_set["engine_contract"]
        page = rule_set["page"]
        global_text = rule_set["global_text"]
        fields = semantic_fields["fields"]
    except (KeyError, TypeError) as error:
        raise RuntimeError("Word standardizer rule bundle is incomplete.") from error
    if (
        rule_set.get("schema_version") != "1.0"
        or semantic_fields.get("schema_version") != "1.0"
        or not re.fullmatch(r"[a-z0-9_.-]+", str(metadata.get("id") or ""))
        or not re.fullmatch(r"\d+\.\d+\.\d+", str(metadata.get("version") or ""))
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(metadata.get("effective_from") or ""))
        or not str(metadata.get("official_source") or "").startswith("https://")
    ):
        raise RuntimeError("Word standardizer rule metadata is invalid.")
    expected_profiles = {
        "n30_strict": True,
        "sector_template": "base_rules_only",
        "reference_only": False,
    }
    if set(profiles) != SUPPORTED_PROFILES or any(
        profiles[name].get("auto_fix") != expected
        for name, expected in expected_profiles.items()
    ):
        raise RuntimeError("Word standardizer profile policy is invalid.")
    if contract != {
        "version": 1,
        "default_profile": "sector_template",
        "geometry_fix": "audit_only",
        "signed_package_apply": False,
        "sector_semantic_mutation": "structural_zone_only",
    }:
        raise RuntimeError("Word standardizer engine contract is invalid.")
    if (
        global_text.get("font") != "Times New Roman"
        or global_text.get("color") != "000000"
        or page.get("paper") != {"width_mm": 210, "height_mm": 297}
    ):
        raise RuntimeError("Word standardizer base rules are invalid.")
    semantic_ids = [str(item.get("id") or "") for item in fields]
    if (
        len(semantic_ids) != len(set(semantic_ids))
        or not _SHELL_SEMANTICS.issubset(semantic_ids)
        or any(not item.get("zone") or not isinstance(item.get("labels"), list)
               for item in fields)
    ):
        raise RuntimeError("Word standardizer semantic schema is invalid.")
    citations = rule_set.get("citations")
    if not isinstance(citations, dict) or not all(
        isinstance(citations.get(key), list) and citations[key]
        for key in ("page", "text", "components", "opc_signature")
    ):
        raise RuntimeError("Word standardizer citations are invalid.")


@lru_cache(maxsize=1)
def _rules() -> tuple[dict, dict, str]:
    package = resources.files(__package__).joinpath("rules")
    rules_bytes = package.joinpath("n30_2020_rules.json").read_bytes()
    fields_bytes = package.joinpath("semantic_fields.json").read_bytes()
    try:
        rule_set = json.loads(rules_bytes.decode("utf-8"))
        semantic_fields = json.loads(fields_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("Word standardizer rules are invalid.") from error
    _validate_rule_bundle(rule_set, semantic_fields)
    digest = hashlib.sha256(rules_bytes + b"\0" + fields_bytes).hexdigest()
    return rule_set, semantic_fields, digest


def standardization_rule_set_sha256() -> str:
    """Return the immutable digest used to invalidate prepared-template caches."""

    return _rules()[2]


def _parse_xml(content: bytes):
    if b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
        raise WordStandardizationError("DOCX XML declarations are not supported.")
    parser = etree.XMLParser(
        resolve_entities=False,
        no_network=True,
        remove_blank_text=False,
        recover=False,
        huge_tree=False,
    )
    try:
        return etree.fromstring(content, parser=parser)
    except etree.XMLSyntaxError as error:
        raise WordStandardizationError("DOCX XML is invalid.") from error


class _Package:
    def __init__(self, content: bytes):
        validate_ooxml_archive(content, "docx")
        validate_docx_template_statements(content)
        self.content = content
        self.infos = []
        self.parts = {}
        self.trees = {}
        self.dirty = set()
        with ZipFile(BytesIO(content)) as archive:
            self.infos = list(archive.infolist())
            for info in self.infos:
                self.parts[info.filename] = archive.read(info.filename)
        for name, part in self.parts.items():
            if _XML_TEXT_PART.fullmatch(name) or name == "word/styles.xml":
                self.trees[name] = _parse_xml(part)

    def serialize(self) -> bytes:
        if not self.dirty:
            return self.content
        output = BytesIO()
        with ZipFile(output, "w", ZIP_DEFLATED) as destination:
            for info in self.infos:
                value = self.parts[info.filename]
                if info.filename in self.dirty:
                    original = value
                    value = etree.tostring(
                        self.trees[info.filename],
                        encoding="UTF-8",
                        xml_declaration=original.lstrip().startswith(b"<?xml"),
                        standalone=None,
                    )
                destination.writestr(info, value)
        result = output.getvalue()
        # The caller immediately constructs `_Package(result)`, which performs
        # both archive and template-statement validation before publication.
        # Avoid opening the same ZIP twice in the same trusted pass.
        return result


def _read_on_off(element) -> bool | None:
    if element is None:
        return None
    value = str(element.get(_qn("val"), "true")).strip().casefold()
    return value not in {"0", "false", "off", "no"}


def _font_summary(slots: dict) -> str | None:
    if not slots:
        return None
    values = set(slots.values())
    if len(slots) == 4 and len(values) == 1:
        return next(iter(values))
    return "mixed:" + ",".join(
        f"{key}={value}" for key, value in sorted(slots.items())
    )


def _merge_run_properties(*properties: dict) -> dict:
    result = {}
    font_slots = {}
    for value in properties:
        if not value:
            continue
        result.update({
            key: child for key, child in value.items() if key != "fontSlots"
        })
        font_slots.update(value.get("fontSlots") or {})
    if font_slots:
        result["fontSlots"] = font_slots
        result["font"] = _font_summary(font_slots)
    return result


def _read_run_properties(container) -> dict:
    if container is None:
        return {}
    result = {}
    fonts = container.find(_qn("rFonts"))
    if fonts is not None:
        slots = {
            key: fonts.get(_qn(key))
            for key in ("ascii", "hAnsi", "eastAsia", "cs")
            if fonts.get(_qn(key))
        }
        for attribute, slot in (
            ("asciiTheme", "ascii"),
            ("hAnsiTheme", "hAnsi"),
            ("eastAsiaTheme", "eastAsia"),
            ("cstheme", "cs"),
        ):
            if theme_value := fonts.get(_qn(attribute)):
                slots[slot] = f"theme:{theme_value}"
        if slots:
            result["fontSlots"] = slots
    size = container.find(_qn("sz"))
    if size is not None and size.get(_qn("val")) is not None:
        result["size"] = _half_points(size.get(_qn("val")))
    color = container.find(_qn("color"))
    if color is not None and color.get(_qn("themeColor")) is not None:
        result["color"] = f"theme:{color.get(_qn('themeColor'))}"
    elif color is not None and color.get(_qn("val")) is not None:
        result["color"] = str(color.get(_qn("val"))).upper()
    for key in ("bold", "italic"):
        element = container.find(_qn("b" if key == "bold" else "i"))
        value = _read_on_off(element)
        if value is not None:
            result[key] = value
    return result


def _read_paragraph_properties(container) -> dict:
    if container is None:
        return {}
    result = {}
    alignment = container.find(_qn("jc"))
    if alignment is not None and alignment.get(_qn("val")) is not None:
        result["alignment"] = alignment.get(_qn("val"))
    spacing = container.find(_qn("spacing"))
    if spacing is not None:
        for key in (
            "before", "beforeLines", "beforeAutospacing", "after",
            "afterLines", "afterAutospacing", "line", "lineRule",
        ):
            if spacing.get(_qn(key)) is not None:
                result[key] = spacing.get(_qn(key))
    indent = container.find(_qn("ind"))
    if indent is not None:
        for key in ("firstLine", "firstLineChars", "hanging", "hangingChars"):
            if indent.get(_qn(key)) is not None:
                result[key] = indent.get(_qn(key))
    contextual = container.find(_qn("contextualSpacing"))
    contextual_value = _read_on_off(contextual)
    if contextual_value is not None:
        result["contextualSpacing"] = contextual_value
    if container.find(_qn("numPr")) is not None:
        result["numPr"] = True
    return result


class _StyleResolver:
    def __init__(self, styles_root):
        self.styles = {}
        self._resolved = {}
        self.default_run = {}
        self.default_paragraph = {}
        self.default_paragraph_style_id = None
        if styles_root is None:
            return
        default_run = styles_root.find(
            ".//w:docDefaults/w:rPrDefault/w:rPr", namespaces=_NS
        )
        default_paragraph = styles_root.find(
            ".//w:docDefaults/w:pPrDefault/w:pPr", namespaces=_NS
        )
        self.default_run = _read_run_properties(default_run)
        self.default_paragraph = _read_paragraph_properties(default_paragraph)
        for style in styles_root.findall("w:style", namespaces=_NS):
            style_id = style.get(_qn("styleId"))
            if not style_id:
                continue
            default_value = str(style.get(_qn("default")) or "").strip().casefold()
            if (
                self.default_paragraph_style_id is None
                and style.get(_qn("type")) == "paragraph"
                and default_value not in {"", "0", "false", "off", "no"}
            ):
                self.default_paragraph_style_id = style_id
            based_on = style.find(_qn("basedOn"))
            self.styles[style_id] = {
                "basedOn": based_on.get(_qn("val")) if based_on is not None else None,
                "run": _read_run_properties(style.find(_qn("rPr"))),
                "paragraph": _read_paragraph_properties(style.find(_qn("pPr"))),
            }

    def resolve(self, style_id: str | None, seen=None) -> tuple[dict, dict]:
        if not style_id or style_id not in self.styles:
            return {}, {}
        if style_id in self._resolved:
            return self._resolved[style_id]
        seen = set(seen or ())
        if style_id in seen:
            return {}, {}
        seen.add(style_id)
        style = self.styles[style_id]
        parent_run, parent_paragraph = self.resolve(style["basedOn"], seen)
        run = _merge_run_properties(parent_run, style["run"])
        paragraph = {**parent_paragraph, **style["paragraph"]}
        self._resolved[style_id] = (run, paragraph)
        return run, paragraph

    def paragraph_style_id(self, paragraph) -> str | None:
        ppr = paragraph.find(_qn("pPr"))
        style_element = ppr.find(_qn("pStyle")) if ppr is not None else None
        explicit_style_id = (
            style_element.get(_qn("val")) if style_element is not None else None
        )
        return explicit_style_id or self.default_paragraph_style_id

    def paragraph(self, paragraph) -> dict:
        ppr = paragraph.find(_qn("pPr"))
        style_id = self.paragraph_style_id(paragraph)
        _run, inherited = self.resolve(style_id)
        return {
            **self.default_paragraph,
            **inherited,
            **_read_paragraph_properties(ppr),
            "styleId": style_id,
        }

    def run(self, paragraph, run) -> dict:
        paragraph_style_id = self.paragraph_style_id(paragraph)
        paragraph_run, _paragraph_properties = self.resolve(paragraph_style_id)
        rpr = run.find(_qn("rPr"))
        run_style = rpr.find(_qn("rStyle")) if rpr is not None else None
        run_style_id = run_style.get(_qn("val")) if run_style is not None else None
        character_run, _character_paragraph = self.resolve(run_style_id)
        return _merge_run_properties(
            self.default_run,
            paragraph_run,
            character_run,
            _read_run_properties(rpr),
        )


def _paragraphs(package: _Package) -> list[_Paragraph]:
    result = []
    for part, root in sorted(package.trees.items()):
        if not _XML_TEXT_PART.fullmatch(part):
            continue
        for index, paragraph in enumerate(root.findall(".//w:p", namespaces=_NS)):
            text_nodes = paragraph.findall(".//w:t", namespaces=_NS)
            text = "".join(node.text or "" for node in text_nodes)
            runs = [
                run for run in paragraph.findall(".//w:r", namespaces=_NS)
                if run.findall(".//w:t", namespaces=_NS)
            ]
            result.append(_Paragraph(part, index, paragraph, text, runs))
    return result


def _detect_document_type(paragraphs: list[_Paragraph]) -> dict:
    document_paragraphs = [
        item for item in paragraphs
        if item.part == "word/document.xml" and item.text.strip()
    ]
    candidates = document_paragraphs or [
        item for item in paragraphs if item.text.strip()
    ]
    texts = [_normalized(item.text) for item in candidates]
    header_limit = min(len(texts), max(20, min(60, len(texts) // 4 or 20)))
    joined = "\n".join(texts[:header_limit])
    signals = []

    title_candidates = {
        "NGHỊ QUYẾT": "nghi_quyet",
        "QUYẾT ĐỊNH": "quyet_dinh",
        "NGHỊ ĐỊNH": "nghi_dinh",
        "CÔNG ĐIỆN": "cong_dien",
        "GIẤY MỜI": "giay_moi",
        "GIẤY GIỚI THIỆU": "giay_gioi_thieu",
        "BIÊN BẢN": "bien_ban",
        "GIẤY NGHỈ PHÉP": "giay_nghi_phep",
        "PHỤ LỤC": "phu_luc",
        "BẢN SAO Y": "ban_sao",
        "HỢP ĐỒNG": "hop_dong",
        **_NAMED_DOCUMENT_TYPES,
    }
    strong_candidates = set()
    for text in texts[:20]:
        for marker, value in title_candidates.items():
            normalized_marker = _normalized(marker)
            if text == normalized_marker:
                strong_candidates.add(value)

    def decision(value, confidence, detected_signals):
        family = (
            "quyet_dinh" if str(value).startswith("quyet_dinh_")
            else "nghi_quyet" if str(value).startswith("nghi_quyet_")
            else value
        )
        return {
            "value": value,
            "confidence": confidence,
            "signals": detected_signals,
            "conflicts": sorted(
                candidate for candidate in strong_candidates
                if candidate != family
            ),
        }

    def present(marker):
        return _normalized(marker) in joined

    if any(text.startswith(_normalized("PHỤ LỤC")) for text in texts[:10]):
        return decision("phu_luc", 0.97, ["PHỤ LỤC"])

    if "nghi_quyet" in strong_candidates and present("QUYẾT NGHỊ:"):
        return decision(
            "nghi_quyet_ca_biet", 0.98,
            ["NGHỊ QUYẾT", "QUYẾT NGHỊ:"],
        )
    if "quyet_dinh" in strong_candidates:
        signals.append("QUYẾT ĐỊNH")
        if present("Ban hành") or present("Phê duyệt"):
            signals.append("Ban hành/Phê duyệt")
            return decision("quyet_dinh_gian_tiep", 0.94, signals)
        if present("QUYẾT ĐỊNH:") or present("Điều 1"):
            signals.append("QUYẾT ĐỊNH:/Điều 1")
            return decision("quyet_dinh_truc_tiep", 0.96, signals)
    specific = (
        ("NGHỊ ĐỊNH", "nghi_dinh", 0.96),
        ("CÔNG ĐIỆN", "cong_dien", 0.97),
        ("GIẤY MỜI", "giay_moi", 0.97),
        ("GIẤY GIỚI THIỆU", "giay_gioi_thieu", 0.97),
        ("BIÊN BẢN", "bien_ban", 0.95),
        ("GIẤY NGHỈ PHÉP", "giay_nghi_phep", 0.97),
        ("PHỤ LỤC", "phu_luc", 0.93),
        ("BẢN SAO Y", "ban_sao", 0.95),
        ("HỢP ĐỒNG", "hop_dong", 0.90),
    )
    for marker, value, confidence in specific:
        if value in strong_candidates:
            return decision(value, confidence, [marker])
    if present("V/v") and present("Kính gửi"):
        return decision("cong_van", 0.97, ["V/v", "Kính gửi"])
    for marker, value in _NAMED_DOCUMENT_TYPES.items():
        if value in strong_candidates:
            return decision(value, 0.94, [marker])
    return decision("unknown", 0.35, [])


def _placeholders(package: _Package, paragraphs: list[_Paragraph]) -> dict:
    count = 0
    samples = []
    samples_truncated = False
    digest = hashlib.sha256()
    formats = Counter()

    def add(value, format_name):
        nonlocal count, samples_truncated
        token = str(value or "")
        encoded = token.encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
        count += 1
        formats[format_name] += 1
        if len(samples) < 200:
            samples.append(token[:240])
            samples_truncated = samples_truncated or len(token) > 240
        else:
            samples_truncated = True

    for paragraph in paragraphs:
        for pattern in _PLACEHOLDER_PATTERNS:
            for match in pattern.findall(paragraph.text):
                add(match, pattern.pattern)
    for root in package.trees.values():
        for instruction in root.findall(".//w:instrText", namespaces=_NS):
            value = str(instruction.text or "").strip()
            if re.search(r"\b(?:MERGEFIELD|DOCVARIABLE|DOCPROPERTY)\b", value, re.I):
                add(value, "field_code")
        for control in root.findall(".//w:sdtPr", namespaces=_NS):
            for local in ("tag", "alias"):
                element = control.find(_qn(local))
                if element is not None and element.get(_qn("val")):
                    add(
                        f"SDT:{local}:{element.get(_qn('val'))}",
                        "content_control",
                    )
    return {
        "count": count,
        "digest": digest.hexdigest(),
        "formats": dict(sorted(formats.items())),
        "tokens": samples,
        "truncated": samples_truncated,
        "sampleTokenMaxChars": 240,
    }


def _table_cell_context(paragraph) -> dict | None:
    ancestor = paragraph.getparent()
    while ancestor is not None and ancestor.tag != _qn("tc"):
        ancestor = ancestor.getparent()
    if ancestor is None:
        return None
    row = ancestor.getparent()
    cells = row.findall(_qn("tc")) if row is not None else []
    if ancestor not in cells:
        return None
    return {"index": cells.index(ancestor), "count": len(cells)}


def _has_ancestor(element, local_name: str) -> bool:
    ancestor = element.getparent()
    tag = _qn(local_name)
    while ancestor is not None:
        if ancestor.tag == tag:
            return True
        ancestor = ancestor.getparent()
    return False


_PROTECTED_PARAGRAPH_NODES = frozenset({
    "altChunk",
    "bookmarkEnd",
    "bookmarkStart",
    "del",
    "drawing",
    "fldChar",
    "fldSimple",
    "imagedata",
    "ins",
    "instrText",
    "moveFrom",
    "moveTo",
    "object",
    "pPrChange",
    "pict",
    "rPrChange",
    "sdt",
    "signatureLine",
    "tblPrChange",
    "tcPrChange",
    "trPrChange",
    "txbxContent",
})


def _local_name(element) -> str:
    try:
        return etree.QName(element).localname
    except (TypeError, ValueError):
        return ""


def _paragraph_protection_reasons(
    paragraph: _Paragraph,
    resolver: _StyleResolver,
) -> frozenset[str]:
    """Return hard exclusions for any automatic formatting mutation.

    The allowlist deliberately protects a whole paragraph/container when its
    formatting cannot be changed independently of template logic, numbering,
    signatures/seals or layout-sensitive OOXML.
    """

    reasons = set()
    element = paragraph.element
    if _table_cell_context(element) is not None:
        reasons.add("table")
    if _has_ancestor(element, "txbxContent"):
        reasons.add("textbox")
    if paragraph.semantic == "document.signing_authority" or paragraph.zone == "signature_right":
        reasons.add("signature")
    if resolver.paragraph(element).get("numPr"):
        reasons.add("numbering")
    if any(pattern.search(paragraph.text) for pattern in _PLACEHOLDER_PATTERNS):
        reasons.add("placeholder")

    local_names = {_local_name(node) for node in element.iter()}
    ancestor = element.getparent()
    while ancestor is not None:
        local_names.add(_local_name(ancestor))
        ancestor = ancestor.getparent()
    if "sectPr" in local_names:
        reasons.add("section")
    if local_names & {"fldChar", "fldSimple", "instrText"}:
        reasons.add("field")
    if local_names & {"sdt", "sdtPr"}:
        reasons.add("content_control")
    if local_names & {"drawing", "imagedata", "object", "pict", "signatureLine"}:
        reasons.add("drawing_or_seal")
    if (
        local_names & {"ins", "del", "moveFrom", "moveTo"}
        or any(name.endswith("Change") for name in local_names)
    ):
        reasons.add("tracked_change")
    if local_names & {"bookmarkStart", "bookmarkEnd"}:
        reasons.add("bookmark")
    if local_names & _PROTECTED_PARAGRAPH_NODES:
        reasons.add("unsupported_container")
    return frozenset(reasons)


def _automatic_mutation_safe(
    paragraph: _Paragraph,
    resolver: _StyleResolver,
) -> bool:
    return not _paragraph_protection_reasons(paragraph, resolver)


def _zone_matches_cell(zone: str, cell: dict | None) -> bool:
    if cell is None or cell["count"] <= 1:
        return True
    index = cell["index"]
    count = cell["count"]
    if zone in {"header_left", "footer_left"}:
        return index < (count + 1) // 2
    if zone in {"header_right", "signature_right"}:
        return index >= count // 2
    return False


def _sector_mutation_safe(
    paragraph: _Paragraph, semantic: str, position: int, part_count: int,
) -> bool:
    if not _zone_matches_cell(
        paragraph.zone, _table_cell_context(paragraph.element)
    ):
        return False
    part = paragraph.part.casefold()
    early_semantics = {
        "document.national_header", "document.motto", "document.number",
        "document.symbol", "document.location", "document.issue_date",
        "document.type", "document.subject", "document.office_letter_subject",
        "document.primary_addressees", "appendix.index", "appendix.title",
    }
    trailing_semantics = {
        "document.signing_authority", "document.recipients",
    }
    if re.fullmatch(r"word/header\d+\.xml", part):
        return semantic in early_semantics and position < min(12, part_count)
    if re.fullmatch(r"word/footer\d+\.xml", part):
        return semantic in trailing_semantics and position < min(12, part_count)
    if part != "word/document.xml":
        return False
    early_window = min(24, max(8, (part_count + 9) // 10))
    trailing_window = min(16, max(4, (part_count + 9) // 10))
    if semantic in early_semantics:
        return position < min(early_window, part_count)
    if semantic in trailing_semantics:
        return position >= max(0, part_count - trailing_window)
    return False


def _calibrate_sector_safety(
    paragraphs: list[_Paragraph], document_type: dict,
) -> None:
    accepted = [
        item for item in paragraphs
        if item.part == "word/document.xml" and item.sector_safe
    ]
    semantics = {item.semantic for item in accepted}
    positions = defaultdict(list)
    for position, paragraph in enumerate(accepted):
        positions[paragraph.semantic].append(position)
    national_shell = (
        {"document.national_header", "document.motto"}.issubset(semantics)
        and min(positions["document.national_header"])
        < min(positions["document.motto"])
    )
    typed_shell = (
        "document.type" in semantics
        and bool(semantics & {
            "document.number", "document.national_header", "document.motto",
            "document.issue_date", "document.office_letter_subject",
            "document.primary_addressees",
        })
    )
    appendix_shell = (
        document_type.get("value") == "phu_luc"
        and {"appendix.index", "appendix.title"}.issubset(semantics)
        and min(positions["appendix.index"]) < min(positions["appendix.title"])
    )
    coherent = (
        float(document_type.get("confidence") or 0) >= 0.90
        and (national_shell or typed_shell or appendix_shell)
    )
    if not coherent:
        for paragraph in paragraphs:
            paragraph.sector_safe = False


def _assign_semantics(
    paragraphs: list[_Paragraph], document_type: dict, semantic_fields: dict,
) -> _BoundedInventory:
    non_empty = [item for item in paragraphs if item.text.strip()]
    by_part = defaultdict(list)
    for paragraph in non_empty:
        by_part[paragraph.part].append(paragraph)
    positions = {
        id(paragraph.element): position
        for items in by_part.values()
        for position, paragraph in enumerate(items)
    }
    zones = {
        str(item.get("id")): str(item.get("zone") or "main_body")
        for item in semantic_fields.get("fields", [])
    }
    title_markers = {
        _normalized(marker): value for marker, value in _NAMED_DOCUMENT_TYPES.items()
    }
    title_markers.update({
        _normalized("NGHỊ QUYẾT"): "nghi_quyet_ca_biet",
        _normalized("QUYẾT ĐỊNH"): "quyet_dinh_truc_tiep",
        _normalized("NGHỊ ĐỊNH"): "nghi_dinh",
        _normalized("CÔNG ĐIỆN"): "cong_dien",
        _normalized("GIẤY MỜI"): "giay_moi",
        _normalized("GIẤY GIỚI THIỆU"): "giay_gioi_thieu",
        _normalized("BIÊN BẢN"): "bien_ban",
        _normalized("GIẤY NGHỈ PHÉP"): "giay_nghi_phep",
        _normalized("BẢN SAO Y"): "ban_sao",
        _normalized("HỢP ĐỒNG"): "hop_dong",
    })
    title_paragraph = None
    fields = _BoundedInventory(MAX_REPORT_FIELDS)
    for paragraph in non_empty:
        position = positions[id(paragraph.element)]
        part_count = len(by_part[paragraph.part])
        value = _normalized(paragraph.text)
        semantic = None
        confidence = 0.0
        zone = "main_body"
        if "cộng hòa xã hội chủ nghĩa việt nam" in value:
            semantic, confidence, zone = "document.national_header", 0.99, "header_right"
        elif "độc lập - tự do - hạnh phúc" in value:
            semantic, confidence, zone = "document.motto", 0.99, "header_right"
        elif value.startswith("số:"):
            semantic, confidence, zone = "document.number", 0.97, "header_left"
        elif value.startswith("v/v"):
            semantic, confidence, zone = "document.office_letter_subject", 0.98, "header_left"
        elif value.startswith("kính gửi"):
            semantic, confidence, zone = "document.primary_addressees", 0.98, "primary_addressee"
        elif value.startswith("nơi nhận"):
            semantic, confidence, zone = "document.recipients", 0.99, "footer_left"
        elif value.startswith("căn cứ"):
            semantic, confidence, zone = "document.legal_bases", 0.95, "main_body"
        elif _SIGNING_AUTHORITY.match(paragraph.text.strip()):
            semantic, confidence, zone = "document.signing_authority", 0.96, "signature_right"
        elif value.startswith("phụ lục"):
            semantic, confidence, zone = "appendix.index", 0.94, "center_title"
        elif value in title_markers:
            semantic, confidence, zone = "document.type", 0.97, "center_title"
        elif _ISSUE_DATE.search(paragraph.text) and position < max(20, len(non_empty) // 5):
            semantic, confidence, zone = "document.issue_date", 0.94, "header_right"
        if semantic:
            paragraph.semantic = semantic
            paragraph.confidence = confidence
            paragraph.zone = zones.get(semantic, zone)
            paragraph.structural_candidate = _sector_mutation_safe(
                paragraph, semantic, position, part_count
            )
            paragraph.sector_safe = paragraph.structural_candidate
            if (
                semantic in {"document.type", "appendix.index"}
                and paragraph.part == "word/document.xml"
                and paragraph.sector_safe
                and title_paragraph is None
            ):
                title_paragraph = paragraph
            placeholder = next(
                (match for pattern in _PLACEHOLDER_PATTERNS
                 for match in pattern.findall(paragraph.text)),
                None,
            )
            cell = _table_cell_context(paragraph.element)
            fields.add({
                "semantic": semantic,
                "source": (placeholder or paragraph.text.strip())[:160],
                "confidence": confidence,
                "mutationSafe": paragraph.sector_safe,
                "location": {
                    "part": paragraph.part,
                    "container": "table_cell" if cell else "paragraph",
                    "index": paragraph.index,
                    "zone": paragraph.zone,
                    **({"tableCell": cell} if cell else {}),
                },
            })
    if title_paragraph is not None:
        document_items = by_part[title_paragraph.part]
        title_position = document_items.index(title_paragraph)
        for paragraph in document_items[title_position + 1:title_position + 4]:
            if paragraph.semantic or paragraph.text.strip().endswith(":"):
                continue
            paragraph.semantic = (
                "appendix.title"
                if title_paragraph.semantic == "appendix.index"
                else "document.subject"
            )
            paragraph.confidence = 0.90
            paragraph.zone = zones.get(paragraph.semantic, "center_title")
            paragraph.structural_candidate = _sector_mutation_safe(
                paragraph,
                paragraph.semantic,
                positions[id(paragraph.element)],
                len(document_items),
            )
            paragraph.sector_safe = paragraph.structural_candidate
            fields.add({
                "semantic": paragraph.semantic,
                "source": paragraph.text.strip()[:160],
                "confidence": paragraph.confidence,
                "mutationSafe": paragraph.sector_safe,
                "location": {
                    "part": paragraph.part,
                    "container": "paragraph",
                    "index": paragraph.index,
                    "zone": paragraph.zone,
                },
            })
            break
    _calibrate_sector_safety(paragraphs, document_type)
    calibrated = _BoundedInventory(MAX_REPORT_FIELDS)
    for paragraph in non_empty:
        if not paragraph.semantic:
            continue
        placeholder = next(
            (
                match
                for pattern in _PLACEHOLDER_PATTERNS
                for match in pattern.findall(paragraph.text)
            ),
            None,
        )
        cell = _table_cell_context(paragraph.element)
        calibrated.add({
            "semantic": paragraph.semantic,
            "source": (placeholder or paragraph.text.strip())[:160],
            "confidence": paragraph.confidence,
            "mutationSafe": paragraph.sector_safe,
            "location": {
                "part": paragraph.part,
                "container": "table_cell" if cell else "paragraph",
                "index": paragraph.index,
                "zone": paragraph.zone,
                **({"tableCell": cell} if cell else {}),
            },
        })
    return calibrated


def _body_paragraphs(
    paragraphs: list[_Paragraph], document_type: dict, resolver: _StyleResolver,
) -> list[_Paragraph]:
    document = [
        item for item in paragraphs
        if item.part == "word/document.xml" and item.text.strip()
    ]
    if document_type["confidence"] < 0.90:
        return []

    def boundary(item):
        return item.sector_safe or item.structural_candidate
    start = 0
    for index, item in enumerate(document):
        if boundary(item) and item.semantic in {
            "document.subject", "document.office_letter_subject",
            "document.primary_addressees", "document.type",
            "appendix.index", "appendix.title",
        }:
            start = index + 1
    end = len(document)
    for index in range(start, len(document)):
        if boundary(document[index]) and document[index].semantic in {
            "document.recipients", "document.signing_authority",
        }:
            end = index
            break
    body = []
    heading_title_pending = False
    for item in document[start:end]:
        if (
            item.semantic in _SHELL_SEMANTICS and boundary(item)
        ) or not item.runs:
            continue
        if _table_cell_context(item.element) is not None:
            item.zone = "table_cell_layout"
            continue
        if _has_ancestor(item.element, "txbxContent"):
            item.zone = "textbox_layout"
            continue
        if resolver.paragraph(item.element).get("numPr"):
            item.zone = "numbered_layout"
            continue
        if not _automatic_mutation_safe(item, resolver):
            item.zone = "protected_layout"
            continue
        if _ADMINISTRATIVE_HEADING.match(_normalized(item.text)):
            item.zone = "administrative_heading"
            heading_title_pending = True
            continue
        if heading_title_pending:
            item.zone = "administrative_heading"
            heading_title_pending = False
            continue
        item.zone = "main_body"
        body.append(item)
    return body


def _policy(
    profile: str, rules: dict, *, sector_safe=False, strict_safe=True,
) -> str:
    auto_fix = rules["profiles"][profile]["auto_fix"]
    if auto_fix is False:
        return "PREVIEW_ONLY"
    if auto_fix == "base_rules_only":
        return "SAFE_AUTO_FIX" if sector_safe else "PREVIEW_ONLY"
    if auto_fix is True:
        return "SAFE_AUTO_FIX" if strict_safe else "PREVIEW_ONLY"
    raise RuntimeError("Word standardizer profile policy is invalid.")


def _issue(
    rule_id, severity, target, current, expected, fix_policy, message,
    *, confidence=1.0, affected_count=1,
):
    return {
        "ruleId": rule_id,
        "severity": severity,
        "target": target,
        "current": current,
        "expected": expected,
        "fixPolicy": fix_policy,
        "message": message,
        "confidence": round(float(confidence), 2),
        "affectedCount": int(affected_count),
    }


def _issue_citations(rule_id: str, rules: dict) -> list[str]:
    if rule_id == "OOXML-PACKAGE-SIGNATURE":
        key = "opc_signature"
    elif rule_id.startswith("N30-PAGE"):
        key = "page"
    elif any(token in rule_id for token in ("BODY", "SHELL", "OTHER")):
        key = "text"
    else:
        key = "components"
    return list(rules["citations"][key])


def _add_issue(inventory: _IssueInventory, issue: dict, rules: dict) -> None:
    value = dict(issue)
    value["citations"] = _issue_citations(value["ruleId"], rules)
    inventory.add(value)


def _component_key(semantic: str) -> str | None:
    return {
        "document.national_header": "national_header",
        "document.motto": "motto",
        "document.type": "document_type",
        "document.subject": "subject_named_document",
        "document.office_letter_subject": "office_letter_subject",
        "document.legal_bases": "legal_basis",
        "document.signing_authority": "signing_authority",
        "document.primary_addressees": "primary_addressee",
        "document.recipients": "recipient_label",
        "appendix.index": "appendix_index",
        "appendix.title": "appendix_title",
    }.get(semantic)


def _dominant_size(paragraphs: list[_Paragraph], resolver: _StyleResolver) -> str:
    sizes = []
    for paragraph in paragraphs:
        for run in paragraph.runs:
            size = resolver.run(paragraph.element, run).get("size")
            if size is not None and 11 <= size <= 16:
                sizes.append(round(size))
    if not sizes:
        return "body_13"
    dominant = Counter(sizes).most_common(1)[0][0]
    return "body_14" if dominant >= 14 else "body_13"


def _page_issues(
    package: _Package, profile: str, rules: dict, issues: _IssueInventory,
) -> None:
    root = package.trees.get("word/document.xml")
    if root is None:
        return
    size_bad = _Samples()
    margin_bad = _Samples()
    landscape = _Samples()
    margin_rules = rules["page"]["margins_mm"]
    for index, section in enumerate(root.findall(".//w:sectPr", namespaces=_NS)):
        page_size = section.find(_qn("pgSz"))
        width = _twips_to_mm(page_size.get(_qn("w"))) if page_size is not None else None
        height = _twips_to_mm(page_size.get(_qn("h"))) if page_size is not None else None
        if width is None or height is None or not (
            abs(width - 210) <= 1 and abs(height - 297) <= 1
            or abs(width - 297) <= 1 and abs(height - 210) <= 1
        ):
            size_bad.add({"section": index, "widthMm": width, "heightMm": height})
        orientation = (
            page_size.get(_qn("orient")) if page_size is not None else "portrait"
        )
        if orientation == "landscape" or (width and height and width > height):
            landscape.add(index)
        page_margin = section.find(_qn("pgMar"))
        values = {}
        for side in ("top", "bottom", "left", "right"):
            current = _twips_to_mm(
                page_margin.get(_qn(side)) if page_margin is not None else None
            )
            values[side] = current
            allowed = margin_rules[side]
            if current is None or not (allowed["min"] <= current <= allowed["max"]):
                margin_bad.add({"section": index, "side": side, "valueMm": current})
    if size_bad.count:
        issues.append(_issue(
            "N30-PAGE-SIZE", "ERROR", "document.sections", size_bad.items,
            "A4 210 x 297 mm", "PREVIEW_ONLY",
            "Khổ giấy chưa khớp A4; chỉ audit cho tới khi có visual renderer gate.",
            affected_count=size_bad.count,
        ))
    if margin_bad.count:
        issues.append(_issue(
            "N30-PAGE-MARGINS", "ERROR", "document.sections", margin_bad.items,
            margin_rules, "PREVIEW_ONLY",
            "Lề trang nằm ngoài khoảng cho phép; cần visual QA trước khi sửa.",
            affected_count=margin_bad.count,
        ))
    if landscape.count:
        issues.append(_issue(
            "N30-PAGE-ORIENTATION", "WARNING", "document.sections", landscape.items,
            "Portrait; landscape requires section-local table/chart justification",
            "PREVIEW_ONLY",
            "Mỗi section trang ngang cần được người dùng xác nhận theo nội dung cục bộ.",
            affected_count=landscape.count,
        ))
    page_field_parts = [
        part
        for part, tree in package.trees.items()
        if re.fullmatch(r"word/header\d+\.xml", part, re.I)
        for node in tree.findall(".//w:instrText", namespaces=_NS)
        if re.search(r"\bPAGE\b", str(node.text or ""), re.I)
    ]
    if not page_field_parts:
        issues.append(_issue(
            "N30-PAGE-NUMBER", "WARNING", "document.page_number", "not detected",
            "Arabic page field in top margin; first page hidden", "MANUAL_REVIEW",
            "Không phát hiện field số trang; cần kiểm tra sau khi render.",
            confidence=0.75,
        ))
    elif any(
        section.find(_qn("titlePg")) is None
        for section in root.findall(".//w:sectPr", namespaces=_NS)
    ):
        issues.append(_issue(
            "N30-PAGE-NUMBER-FIRST-PAGE", "WARNING", "document.page_number",
            "first-page suppression not detected", "First page hidden",
            "MANUAL_REVIEW",
            "Có field số trang trong header nhưng chưa xác minh ẩn ở trang đầu.",
            confidence=0.75,
        ))


def _format_issues(
    paragraphs: list[_Paragraph], body: list[_Paragraph], resolver: _StyleResolver,
    profile: str, rules: dict, size_profile: str, issues: _IssueInventory,
) -> None:
    safe_shell = [
        item for item in paragraphs
        if (
            item.semantic in _SHELL_SEMANTICS
            and item.sector_safe
            and _automatic_mutation_safe(item, resolver)
        )
    ]
    shell_candidates = [
        item for item in paragraphs
        if (
            item.semantic in _SHELL_SEMANTICS
            and item not in safe_shell
        )
    ]
    body_set = {id(item.element) for item in body}
    candidate_only = [
        item for item in shell_candidates if id(item.element) not in body_set
    ]
    other = [
        item for item in paragraphs
        if item.runs
        and id(item.element) not in body_set
        and item not in safe_shell
        and item not in shell_candidates
    ]

    def mismatched_runs(items, property_name, predicate):
        mismatches = _Samples()
        for paragraph in items:
            for run in paragraph.runs:
                value = resolver.run(paragraph.element, run).get(property_name)
                if not predicate(value):
                    mismatches.add({
                        "part": paragraph.part,
                        "paragraph": paragraph.index,
                        "value": value,
                    })
        return mismatches

    for scope, items, sector_safe, strict_safe in (
        ("SHELL", safe_shell, True, True),
        ("SHELL-CANDIDATE", candidate_only, False, False),
        ("BODY", body, False, True),
        ("OTHER", other, False, False),
    ):
        fonts = mismatched_runs(
            items, "font", lambda value: _normalized(value) == _normalized("Times New Roman")
        )
        if fonts.count:
            issues.append(_issue(
                f"N30-{scope}-FONT", "ERROR", scope.casefold(), fonts.items,
                "Times New Roman", _policy(
                    profile, rules,
                    sector_safe=sector_safe,
                    strict_safe=strict_safe,
                ),
                "Phông chữ chưa theo Times New Roman.",
                affected_count=fonts.count,
            ))
        colors = mismatched_runs(
            items, "color", lambda value: str(value or "").upper() == "000000"
        )
        if colors.count:
            issues.append(_issue(
                f"N30-{scope}-COLOR", "ERROR", scope.casefold(), colors.items,
                "000000", _policy(
                    profile, rules,
                    sector_safe=sector_safe,
                    strict_safe=strict_safe,
                ),
                "Màu chữ chưa được xác định là màu đen.",
                affected_count=colors.count,
            ))

    component_rules = rules["components"]
    sizes = rules["size_profiles"][size_profile]
    for paragraph in paragraphs:
        key = _component_key(paragraph.semantic or "")
        if not key or key not in component_rules or not paragraph.runs:
            continue
        expected = component_rules[key]
        mutation_safe = (
            paragraph.sector_safe
            and _automatic_mutation_safe(paragraph, resolver)
        )
        component_policy = _policy(
            profile,
            rules,
            sector_safe=mutation_safe,
            strict_safe=mutation_safe,
        )
        size_key = {
            "national_header": "national_header",
            "motto": "motto",
            "document_type": "document_type",
            "subject_named_document": "subject",
            "office_letter_subject": "subject",
            "signing_authority": "signature",
        }.get(key)
        desired_size = sizes.get(size_key) if size_key else None
        if desired_size is None:
            configured = expected.get("size_pt")
            desired_size = configured[0] if configured else None
        run_values = [resolver.run(paragraph.element, run) for run in paragraph.runs]
        if desired_size is not None and any(
            value.get("size") is None
            or not expected.get("size_pt", [desired_size, desired_size])[0]
            <= value.get("size")
            <= expected.get("size_pt", [desired_size, desired_size])[-1]
            for value in run_values
        ):
            issues.append(_issue(
                f"N30-{key.upper().replace('_', '-')}-SIZE", "ERROR",
                paragraph.semantic,
                [value.get("size") for value in run_values[:MAX_ISSUE_SAMPLES]],
                expected.get("size_pt", desired_size),
                component_policy,
                "Cỡ chữ thành phần chưa nằm trong khoảng quy định.",
                confidence=paragraph.confidence,
                affected_count=len(run_values),
            ))
        for prop in ("bold", "italic"):
            if prop not in expected:
                continue
            if any(value.get(prop) is not bool(expected[prop]) for value in run_values):
                issues.append(_issue(
                    f"N30-{key.upper().replace('_', '-')}-{prop.upper()}",
                    "ERROR", paragraph.semantic,
                    [value.get(prop) for value in run_values[:MAX_ISSUE_SAMPLES]],
                    bool(expected[prop]), component_policy,
                    f"Thuộc tính {prop} của thành phần chưa đúng quy định.",
                    confidence=paragraph.confidence,
                    affected_count=len(run_values),
                ))
        if expected.get("alignment"):
            current = resolver.paragraph(paragraph.element).get("alignment")
            desired = "both" if expected["alignment"] == "justify" else expected["alignment"]
            if current != desired:
                issues.append(_issue(
                    f"N30-{key.upper().replace('_', '-')}-ALIGN", "ERROR",
                    paragraph.semantic, current, desired,
                    component_policy,
                    "Căn lề thành phần chưa đúng quy định.",
                    confidence=paragraph.confidence,
                ))

    if body:
        body_size = sizes["body"]
        bad_size = _Samples()
        bad_alignment = _Samples()
        bad_indent = _Samples()
        bad_after = _Samples()
        automatic_spacing = _Samples()
        bad_line = _Samples()
        non_auto_line = _Samples()
        next_by_location = {
            (item.part, item.index): next_item
            for item, next_item in zip(paragraphs, paragraphs[1:])
            if item.part == next_item.part
        }
        for paragraph in body:
            run_values = [resolver.run(paragraph.element, run) for run in paragraph.runs]
            for value in run_values:
                if value.get("size") not in {13.0, 14.0}:
                    bad_size.add({
                        "paragraph": paragraph.index,
                        "value": value.get("size"),
                    })
            props = resolver.paragraph(paragraph.element)
            if props.get("alignment") != "both":
                bad_alignment.add(paragraph.index)
            first_line_mm = _twips_to_mm(props.get("firstLine"))
            if (
                props.get("firstLineChars") is not None
                or props.get("hanging") is not None
                or props.get("hangingChars") is not None
                or first_line_mm is None
                or not 10.0 <= first_line_mm <= 12.7
            ):
                bad_indent.add({
                    "paragraph": paragraph.index,
                    "valueCm": (
                        round(first_line_mm / 10, 2)
                        if first_line_mm is not None else None
                    ),
                    "firstLineChars": props.get("firstLineChars"),
                    "hanging": props.get("hanging"),
                    "hangingChars": props.get("hangingChars"),
                })
            next_paragraph = next_by_location.get(
                (paragraph.part, paragraph.index)
            )
            next_props = (
                resolver.paragraph(next_paragraph.element)
                if next_paragraph is not None else {}
            )
            spacing_overrides = {
                key: props.get(key)
                for key in ("afterLines", "afterAutospacing")
                if props.get(key) is not None
            }
            spacing_overrides.update({
                f"next{key[0].upper()}{key[1:]}": next_props.get(key)
                for key in ("beforeLines", "beforeAutospacing")
                if next_props.get(key) is not None
            })
            if (
                (props.get("contextualSpacing") or next_props.get("contextualSpacing"))
                and props.get("styleId") == next_props.get("styleId")
            ):
                spacing_overrides["contextualSpacing"] = True
            if spacing_overrides:
                automatic_spacing.add({
                    "paragraph": paragraph.index,
                    **spacing_overrides,
                })
                after = None
                next_before = None
            else:
                try:
                    after = int(props.get("after")) / 20
                except (TypeError, ValueError):
                    after = None
                try:
                    next_before = int(next_props.get("before")) / 20
                except (TypeError, ValueError):
                    next_before = None
            effective_gap = max(after or 0, next_before or 0)
            if not spacing_overrides and effective_gap < 6:
                bad_after.add({"paragraph": paragraph.index, "valuePt": after})
            line_rule = str(props.get("lineRule") or "auto").casefold()
            if line_rule != "auto":
                try:
                    line_points = int(props.get("line")) / 20
                except (TypeError, ValueError):
                    line_points = None
                non_auto_line.add({
                    "paragraph": paragraph.index,
                    "lineRule": line_rule,
                    "valuePt": line_points,
                })
            else:
                try:
                    line = int(props.get("line")) / 240
                except (TypeError, ValueError):
                    line = None
                if line is None or not 1 <= line <= 1.5:
                    bad_line.add({"paragraph": paragraph.index, "value": line})
        body_policy = _policy(
            profile, rules, sector_safe=False, strict_safe=True
        )
        for rule_id, current, expected, message in (
            ("N30-BODY-SIZE", bad_size, f"{body_size} pt (13-14 allowed)", "Cỡ chữ nội dung chưa đúng."),
            ("N30-BODY-ALIGN", bad_alignment, "justify", "Nội dung chưa canh đều hai lề."),
            ("N30-BODY-INDENT", bad_indent, "1-1.27 cm", "Thụt đầu dòng nội dung chưa đúng."),
            ("N30-BODY-SPACING", bad_after, ">= 6 pt", "Khoảng cách sau đoạn chưa đủ."),
            ("N30-BODY-LINE-SPACING", bad_line, "1-1.5 lines", "Giãn dòng nội dung chưa đúng."),
        ):
            if current.count:
                issues.append(_issue(
                    rule_id, "ERROR", "document.body", current.items, expected,
                    body_policy, message, affected_count=current.count,
                ))
        if non_auto_line.count:
            issues.append(_issue(
                "N30-BODY-LINE-RULE", "WARNING", "document.body",
                non_auto_line.items, "lineRule=auto", "PREVIEW_ONLY",
                "Giãn dòng exact/atLeast cần visual QA, không tự quy đổi sang số dòng.",
                affected_count=non_auto_line.count,
            ))
        if automatic_spacing.count:
            issues.append(_issue(
                "N30-BODY-SPACING-AUTOMATIC", "WARNING", "document.body",
                automatic_spacing.items, "Deterministic point spacing",
                "PREVIEW_ONLY",
                "Line/auto/contextual spacing cần visual QA; không tự ghi đè.",
                affected_count=automatic_spacing.count,
            ))
    for zone, rule_id, message in (
        (
            "administrative_heading",
            "N30-HEADING-LAYOUT",
            "Heading Phần/Chương/Mục/Tiểu mục/Điều cần rule riêng; không áp body auto-fix.",
        ),
        (
            "table_cell_layout",
            "N30-TABLE-CELL-LAYOUT",
            "Đoạn trong ô bảng cần layout riêng; không áp body auto-fix.",
        ),
        (
            "textbox_layout",
            "N30-TEXTBOX-LAYOUT",
            "Đoạn trong text box cần visual QA; không áp body auto-fix.",
        ),
        (
            "numbered_layout",
            "N30-NUMBERED-LAYOUT",
            "Đoạn đánh số/danh sách cần giữ cấu trúc numbering và kiểm tra thủ công; không áp body auto-fix.",
        ),
        (
            "protected_layout",
            "N30-PROTECTED-LAYOUT",
            "Đoạn chứa placeholder, field, content control, section, tracked change hoặc đối tượng ký/đóng dấu được giữ nguyên.",
        ),
    ):
        candidates = [item for item in paragraphs if item.zone == zone]
        if candidates:
            issues.append(_issue(
                rule_id,
                "WARNING",
                zone,
                [
                    {"part": item.part, "paragraph": item.index}
                    for item in candidates[:MAX_ISSUE_SAMPLES]
                ],
                "Dedicated component rules and visual QA",
                "MANUAL_REVIEW",
                message,
                affected_count=len(candidates),
            ))


def _package_signature(package: _Package) -> dict:
    parts = sorted(
        name for name in package.parts if _OPC_SIGNATURE_PART.match(name)
    )
    relationship_parts = sorted(
        name
        for name, content in package.parts.items()
        if name.casefold().endswith(".rels")
        and _OPC_SIGNATURE_RELATIONSHIP in content.lower()
    )
    detected = bool(parts or relationship_parts)
    return {
        "detected": detected,
        "validityVerified": False,
        "parts": parts[:20],
        "relationshipParts": relationship_parts[:20],
        "truncated": len(parts) > 20 or len(relationship_parts) > 20,
    }


def _formatting_insensitive_clone(root):
    clone = etree.fromstring(etree.tostring(root))
    owned = {
        "rPr": {
            "rFonts": (
                "ascii", "hAnsi", "eastAsia", "cs", "asciiTheme",
                "hAnsiTheme", "eastAsiaTheme", "cstheme",
            ),
            "b": ("val",),
            "i": ("val",),
            "color": ("val", "themeColor", "themeTint", "themeShade"),
            "sz": ("val",),
            "szCs": ("val",),
        },
        "pPr": {
            "jc": ("val",),
            "spacing": ("after", "line", "lineRule"),
            "ind": ("firstLine", "firstLineChars", "hanging", "hangingChars"),
        },
    }
    for parent_name, children in owned.items():
        parents = clone.findall(f".//w:{parent_name}", namespaces=_NS)
        for parent in parents:
            for child_name, attributes in children.items():
                for child in parent.findall(_qn(child_name)):
                    for attribute in attributes:
                        child.attrib.pop(_qn(attribute), None)
                    if not child.attrib and len(child) == 0 and not child.text:
                        parent.remove(child)
            if not parent.attrib and len(parent) == 0 and not parent.text:
                container = parent.getparent()
                if container is not None:
                    container.remove(parent)
    return clone


def _fingerprint(package: _Package) -> dict:
    texts = []
    numeric_tokens = []
    placeholder_records = _BoundedInventory(0)
    field_records = _BoundedInventory(0)
    content_control_records = _BoundedInventory(0)
    bookmark_records = _BoundedInventory(0)
    story_records = _BoundedInventory(0)
    table_records = _BoundedInventory(0)
    exact_table_records = _BoundedInventory(0)
    protected_paragraph_records = _BoundedInventory(0)
    section_records = _BoundedInventory(0)
    counts = Counter()
    for part, root in sorted(package.trees.items()):
        if not _XML_TEXT_PART.fullmatch(part):
            continue
        for node in root.findall(".//w:t", namespaces=_NS):
            value = node.text or ""
            texts.append(f"{part}\0{value}")
            numeric_tokens.extend(
                f"{part}\0{token}"
                for token in re.findall(r"[+-]?\d+(?:[.,:/-]\d+)*", value)
            )
        structural_root = _formatting_insensitive_clone(root)
        structural_bytes = etree.tostring(
            structural_root, method="c14n", with_comments=True
        )
        story_records.add(
            f"{part}\0{hashlib.sha256(structural_bytes).hexdigest()}"
        )
        for index, table in enumerate(
            structural_root.findall(".//w:tbl", namespaces=_NS)
        ):
            table_records.add(
                f"{part}\0{index}\0"
                f"{hashlib.sha256(etree.tostring(table, method='c14n')).hexdigest()}"
            )
        for index, table in enumerate(root.findall(".//w:tbl", namespaces=_NS)):
            exact_table_records.add(
                f"{part}\0{index}\0"
                f"{hashlib.sha256(etree.tostring(table, method='c14n')).hexdigest()}"
            )
        for index, section in enumerate(root.findall(".//w:sectPr", namespaces=_NS)):
            section_records.add(
                f"{part}\0{index}\0"
                f"{hashlib.sha256(etree.tostring(section, method='c14n')).hexdigest()}"
            )
        for paragraph_index, paragraph in enumerate(
            root.findall(".//w:p", namespaces=_NS)
        ):
            combined = "".join(
                node.text or "" for node in paragraph.findall(".//w:t", namespaces=_NS)
            )
            for pattern_index, pattern in enumerate(_PLACEHOLDER_PATTERNS):
                for match in pattern.finditer(combined):
                    placeholder_records.add(
                        f"{part}\0{paragraph_index}\0{pattern_index}\0"
                        f"{match.start()}:{match.end()}\0{match.group(0)}"
                    )
            local_names = {_local_name(node) for node in paragraph.iter()}
            ancestor = paragraph.getparent()
            while ancestor is not None:
                local_names.add(_local_name(ancestor))
                ancestor = ancestor.getparent()
            protected = (
                bool(local_names & (_PROTECTED_PARAGRAPH_NODES | {
                    "sdtPr", "sectPr", "tc",
                }))
                or any(name.endswith("Change") for name in local_names)
                or any(pattern.search(combined) for pattern in _PLACEHOLDER_PATTERNS)
                or bool(_SIGNING_AUTHORITY.match(combined.strip()))
            )
            if protected:
                protected_paragraph_records.add(
                    f"{part}\0{paragraph_index}\0"
                    f"{hashlib.sha256(etree.tostring(paragraph, method='c14n')).hexdigest()}"
                )
        for index, instruction in enumerate(
            root.findall(".//w:instrText", namespaces=_NS)
        ):
            texts.append(f"{part}\0INSTR\0{instruction.text or ''}")
            field_records.add(
                f"{part}\0instrText\0{index}\0{instruction.text or ''}"
            )
            if re.search(r"\b(?:MERGEFIELD|DOCVARIABLE|DOCPROPERTY)\b", str(instruction.text or ""), re.I):
                placeholder_records.add(
                    f"{part}\0field\0{index}\0{instruction.text or ''}"
                )
        for index, field_char in enumerate(
            root.findall(".//w:fldChar", namespaces=_NS)
        ):
            field_records.add(
                f"{part}\0fldChar\0{index}\0"
                f"{field_char.get(_qn('fldCharType')) or ''}"
            )
        for index, simple_field in enumerate(
            root.findall(".//w:fldSimple", namespaces=_NS)
        ):
            field_records.add(
                f"{part}\0fldSimple\0{index}\0"
                f"{simple_field.get(_qn('instr')) or ''}"
            )
        for index, control in enumerate(root.findall(".//w:sdtPr", namespaces=_NS)):
            content_control_records.add(
                f"{part}\0{index}\0"
                f"{hashlib.sha256(etree.tostring(control, method='c14n')).hexdigest()}"
            )
        for kind, query in (
            ("start", ".//w:bookmarkStart"),
            ("end", ".//w:bookmarkEnd"),
        ):
            for index, bookmark in enumerate(root.findall(query, namespaces=_NS)):
                bookmark_records.add(
                    f"{part}\0{kind}\0{index}\0"
                    f"{hashlib.sha256(etree.tostring(bookmark, method='c14n')).hexdigest()}"
                )
        for name, query in (
            ("tables", ".//w:tbl"),
            ("sections", ".//w:sectPr"),
            ("contentControls", ".//w:sdt"),
            ("bookmarks", ".//w:bookmarkStart"),
            ("fields", ".//w:fldSimple"),
        ):
            counts[name] += len(root.findall(query, namespaces=_NS))
    entries = sorted(package.parts)
    immutable_parts = [
        f"{name}\0{len(package.parts[name])}\0"
        f"{hashlib.sha256(package.parts[name]).hexdigest()}"
        for name in entries if not _XML_TEXT_PART.fullmatch(name)
    ]
    relationship_parts = [
        item for item in immutable_parts
        if item.split("\0", 1)[0].casefold().endswith(".rels")
    ]
    media_parts = [
        item for item in immutable_parts
        if item.split("\0", 1)[0].casefold().startswith("word/media/")
    ]
    signature_parts = [
        item for item in immutable_parts
        if _OPC_SIGNATURE_PART.match(item.split("\0", 1)[0])
    ]
    counts["media"] = len(media_parts)
    counts["headers"] = sum(re.fullmatch(r"word/header\d+\.xml", name, re.I) is not None for name in entries)
    counts["footers"] = sum(re.fullmatch(r"word/footer\d+\.xml", name, re.I) is not None for name in entries)
    return {
        "entryDigest": hashlib.sha256("\x1e".join(entries).encode()).hexdigest(),
        "textDigest": hashlib.sha256("\x1e".join(texts).encode("utf-8")).hexdigest(),
        "numericTokenDigest": hashlib.sha256(
            "\x1e".join(numeric_tokens).encode("utf-8")
        ).hexdigest(),
        "placeholderDigest": placeholder_records.metadata()["digest"],
        "placeholderCount": placeholder_records.count,
        "fieldDigest": field_records.metadata()["digest"],
        "contentControlDigest": content_control_records.metadata()["digest"],
        "bookmarkDigest": bookmark_records.metadata()["digest"],
        "storyStructureDigest": story_records.metadata()["digest"],
        "tableStructureDigest": table_records.metadata()["digest"],
        "exactTableDigest": exact_table_records.metadata()["digest"],
        "protectedParagraphDigest": protected_paragraph_records.metadata()["digest"],
        "sectionDigest": section_records.metadata()["digest"],
        "immutablePartsDigest": hashlib.sha256(
            "\x1e".join(immutable_parts).encode("utf-8")
        ).hexdigest(),
        "relationshipDigest": hashlib.sha256(
            "\x1e".join(relationship_parts).encode("utf-8")
        ).hexdigest(),
        "mediaDigest": hashlib.sha256(
            "\x1e".join(media_parts).encode("utf-8")
        ).hexdigest(),
        "signatureDigest": hashlib.sha256(
            "\x1e".join(signature_parts).encode("utf-8")
        ).hexdigest(),
        **dict(sorted(counts.items())),
    }


def _ensure_first(parent, tag):
    element = parent.find(tag)
    if element is None:
        element = etree.Element(tag)
        parent.insert(0, element)
    return element


def _ensure_child(parent, tag):
    element = parent.find(tag)
    if element is None:
        element = etree.Element(tag)
        parent_name = etree.QName(parent).localname
        child_name = etree.QName(tag).localname
        ranks = _PROPERTY_ORDER.get(parent_name, {})
        child_rank = ranks.get(child_name)
        inserted = False
        if child_rank is not None:
            for index, sibling in enumerate(parent):
                sibling_rank = ranks.get(etree.QName(sibling).localname)
                if sibling_rank is not None and sibling_rank > child_rank:
                    parent.insert(index, element)
                    inserted = True
                    break
        if not inserted:
            parent.append(element)
    return element


def _set_run_property(run, prop, value) -> bool:
    rpr = _ensure_first(run, _qn("rPr"))
    if prop == "font":
        element = _ensure_child(rpr, _qn("rFonts"))
        attrs = ("ascii", "hAnsi", "eastAsia", "cs")
        if all(element.get(_qn(key)) == value for key in attrs):
            return False
        for key in attrs:
            element.set(_qn(key), str(value))
        for key in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
            element.attrib.pop(_qn(key), None)
        return True
    if prop == "color":
        element = _ensure_child(rpr, _qn("color"))
        theme_attributes = ("themeColor", "themeTint", "themeShade")
        if (
            element.get(_qn("val")) == value
            and not any(element.get(_qn(name)) for name in theme_attributes)
        ):
            return False
        element.set(_qn("val"), str(value))
        for name in theme_attributes:
            element.attrib.pop(_qn(name), None)
        return True
    if prop == "size":
        changed = False
        half_points = str(round(float(value) * 2))
        for tag in ("sz", "szCs"):
            element = _ensure_child(rpr, _qn(tag))
            if element.get(_qn("val")) != half_points:
                element.set(_qn("val"), half_points)
                changed = True
        return changed
    if prop in {"bold", "italic"}:
        tag = _qn("b" if prop == "bold" else "i")
        element = rpr.find(tag)
        created = element is None
        if created:
            element = _ensure_child(rpr, tag)
        desired = "1" if value else "0"
        if not created and element.get(_qn("val"), "1") == desired:
            return False
        element.set(_qn("val"), desired)
        return True
    raise KeyError(prop)


def _set_paragraph_property(paragraph, prop, value) -> bool:
    ppr = _ensure_first(paragraph, _qn("pPr"))
    if prop == "alignment":
        element = _ensure_child(ppr, _qn("jc"))
        if element.get(_qn("val")) == value:
            return False
        element.set(_qn("val"), str(value))
        return True
    if prop in {"after", "line", "lineRule"}:
        element = _ensure_child(ppr, _qn("spacing"))
        if element.get(_qn(prop)) == str(value):
            return False
        element.set(_qn(prop), str(value))
        return True
    if prop == "firstLine":
        element = _ensure_child(ppr, _qn("ind"))
        overrides = ("firstLineChars", "hanging", "hangingChars")
        if (
            element.get(_qn("firstLine")) == str(value)
            and not any(element.get(_qn(name)) is not None for name in overrides)
        ):
            return False
        element.set(_qn("firstLine"), str(value))
        for name in overrides:
            element.attrib.pop(_qn(name), None)
        return True
    raise KeyError(prop)


def _apply_fixes(
    package: _Package, paragraphs: list[_Paragraph], body: list[_Paragraph],
    resolver: _StyleResolver, profile: str, rules: dict, size_profile: str,
) -> list[dict]:
    if profile == "reference_only":
        return []
    changes = defaultdict(lambda: {"affectedCount": 0, "targets": []})

    def changed(rule_id, paragraph=None):
        entry = changes[rule_id]
        entry["affectedCount"] += 1
        if paragraph is not None and len(entry["targets"]) < 10:
            entry["targets"].append({
                "part": paragraph.part,
                "paragraph": paragraph.index,
                "semantic": paragraph.semantic,
            })
            package.dirty.add(paragraph.part)

    strict = profile == "n30_strict"
    safe_shell = [
        item for item in paragraphs
        if (
            item.semantic in _SHELL_SEMANTICS
            and item.sector_safe
            and _automatic_mutation_safe(item, resolver)
        )
    ]
    shell_ids = {id(item.element) for item in safe_shell}
    target_paragraphs = (
        safe_shell + [
            item for item in body
            if id(item.element) not in shell_ids
        ]
        if strict else safe_shell
    )
    body_ids = {id(item.element) for item in body}
    for paragraph in target_paragraphs:
        scope = "SHELL" if paragraph.semantic in _SHELL_SEMANTICS else (
            "BODY" if id(paragraph.element) in body_ids else "OTHER"
        )
        for run in paragraph.runs:
            effective = resolver.run(paragraph.element, run)
            if _normalized(effective.get("font")) != _normalized("Times New Roman"):
                if _set_run_property(run, "font", "Times New Roman"):
                    changed(f"N30-{scope}-FONT", paragraph)
            if str(effective.get("color") or "").upper() != "000000":
                if _set_run_property(run, "color", "000000"):
                    changed(f"N30-{scope}-COLOR", paragraph)

    component_rules = rules["components"]
    sizes = rules["size_profiles"][size_profile]
    for paragraph in paragraphs:
        key = _component_key(paragraph.semantic or "")
        if (
            not key
            or key not in component_rules
            or paragraph.confidence < 0.90
            or not paragraph.sector_safe
            or not _automatic_mutation_safe(paragraph, resolver)
        ):
            continue
        expected = component_rules[key]
        size_key = {
            "national_header": "national_header",
            "motto": "motto",
            "document_type": "document_type",
            "subject_named_document": "subject",
            "office_letter_subject": "subject",
            "signing_authority": "signature",
        }.get(key)
        desired_size = sizes.get(size_key) if size_key else None
        if desired_size is None and expected.get("size_pt"):
            desired_size = expected["size_pt"][0]
        for run in paragraph.runs:
            effective = resolver.run(paragraph.element, run)
            if desired_size is not None:
                allowed_sizes = expected.get("size_pt", [desired_size, desired_size])
                current = effective.get("size")
                if current is None or not allowed_sizes[0] <= current <= allowed_sizes[-1]:
                    if _set_run_property(run, "size", desired_size):
                        changed(f"N30-{key.upper().replace('_', '-')}-SIZE", paragraph)
            for prop in ("bold", "italic"):
                if prop in expected and effective.get(prop) is not bool(expected[prop]):
                    if _set_run_property(run, prop, bool(expected[prop])):
                        changed(
                            f"N30-{key.upper().replace('_', '-')}-{prop.upper()}",
                            paragraph,
                        )
        if expected.get("alignment"):
            desired = "both" if expected["alignment"] == "justify" else expected["alignment"]
            if resolver.paragraph(paragraph.element).get("alignment") != desired:
                if _set_paragraph_property(paragraph.element, "alignment", desired):
                    changed(f"N30-{key.upper().replace('_', '-')}-ALIGN", paragraph)

    if strict:
        body_size = sizes["body"]
        paragraph_lookup = {
            (item.part, item.index): item for item in paragraphs
        }
        for paragraph in body:
            for run in paragraph.runs:
                current = resolver.run(paragraph.element, run).get("size")
                if current not in {13.0, 14.0}:
                    if _set_run_property(run, "size", body_size):
                        changed("N30-BODY-SIZE", paragraph)
            props = resolver.paragraph(paragraph.element)
            if props.get("alignment") != "both" and _set_paragraph_property(
                paragraph.element, "alignment", "both"
            ):
                changed("N30-BODY-ALIGN", paragraph)
            first_line_mm = _twips_to_mm(props.get("firstLine"))
            if (
                props.get("firstLineChars") is not None
                or props.get("hanging") is not None
                or props.get("hangingChars") is not None
                or first_line_mm is None
                or not 10.0 <= first_line_mm <= 12.7
            ) and _set_paragraph_property(
                paragraph.element, "firstLine", _mm_to_twips(10)
            ):
                changed("N30-BODY-INDENT", paragraph)
            try:
                after = int(props.get("after"))
            except (TypeError, ValueError):
                after = 0
            next_paragraph = paragraph_lookup.get(
                (paragraph.part, paragraph.index + 1)
            )
            next_props = (
                resolver.paragraph(next_paragraph.element)
                if next_paragraph is not None else {}
            )
            spacing_is_automatic = any(
                props.get(key) is not None
                for key in ("afterLines", "afterAutospacing")
            ) or any(
                next_props.get(key) is not None
                for key in ("beforeLines", "beforeAutospacing")
            )
            spacing_is_automatic = spacing_is_automatic or (
                (props.get("contextualSpacing") or next_props.get("contextualSpacing"))
                and props.get("styleId") == next_props.get("styleId")
            )
            try:
                next_before = int(next_props.get("before"))
            except (TypeError, ValueError):
                next_before = 0
            if not spacing_is_automatic and max(after, next_before) < 120 and _set_paragraph_property(
                paragraph.element, "after", 120
            ):
                changed("N30-BODY-SPACING", paragraph)
            try:
                line = int(props.get("line"))
            except (TypeError, ValueError):
                line = 0
            line_rule = str(props.get("lineRule") or "auto").casefold()
            if line_rule == "auto" and not 240 <= line <= 360:
                if _set_paragraph_property(paragraph.element, "line", 276):
                    changed("N30-BODY-LINE-SPACING", paragraph)
                _set_paragraph_property(paragraph.element, "lineRule", "auto")

    return [
        {
            "ruleId": rule_id,
            "affectedCount": value["affectedCount"],
            "targets": value["targets"],
            "reason": "Nghị định 30/2020/NĐ-CP, Phụ lục I",
        }
        for rule_id, value in sorted(changes.items())
    ]


def _analyze(package: _Package, profile: str) -> dict:
    rule_set, semantic_fields, rule_hash = _rules()
    paragraphs = _paragraphs(package)
    document_type = _detect_document_type(paragraphs)
    fields = _assign_semantics(paragraphs, document_type, semantic_fields)
    styles = _StyleResolver(package.trees.get("word/styles.xml"))
    body = _body_paragraphs(paragraphs, document_type, styles)
    size_profile = _dominant_size(body or paragraphs, styles)
    package_signature = _package_signature(package)
    issues = _IssueInventory(
        rule_set, signed_package=package_signature["detected"]
    )
    _page_issues(package, profile, rule_set, issues)
    _format_issues(
        paragraphs, body, styles, profile, rule_set, size_profile, issues,
    )
    if document_type["value"] == "unknown":
        issues.append(_issue(
            "N30-DOCUMENT-TYPE", "WARNING", "document.type", "unknown",
            "Recognized administrative document type", "MANUAL_REVIEW",
            "Không đủ tín hiệu để nhận diện loại văn bản.",
            confidence=document_type["confidence"],
        ))
    if document_type["value"] == "hop_dong":
        issues.append(_issue(
            "N30-SECTOR-CONFLICT", "WARNING", "document.type", "hop_dong",
            "Specialized contract profile", "MANUAL_REVIEW",
            "Hợp đồng cần giữ cấu trúc chuyên ngành và chỉ áp dụng quy tắc nền.",
            confidence=document_type["confidence"],
        ))
    if package_signature["detected"]:
        issues.append(_issue(
            "OOXML-PACKAGE-SIGNATURE", "ERROR", "package.signature",
            package_signature, "Unsigned editable template", "MANUAL_REVIEW",
            "Phát hiện artifact chữ ký OPC; chưa kiểm tra hiệu lực mật mã và mọi rewrite có thể làm chữ ký mất hiệu lực.",
        ))
    placeholders = _placeholders(package, paragraphs)
    safe_rule_ids = issues.rule_ids["SAFE_AUTO_FIX"]
    preview_rule_ids = issues.rule_ids["PREVIEW_ONLY"]
    manual_rule_ids = issues.rule_ids["MANUAL_REVIEW"]
    summary = {
        "checkedRules": max(12, 12 + fields.count),
        "violations": issues.count,
        "safeFixes": len(safe_rule_ids),
        "safeFixTargets": issues.affected_counts["SAFE_AUTO_FIX"],
        "previewOnly": len(preview_rule_ids),
        "manualReview": len(manual_rule_ids),
    }
    summary["compliant"] = max(0, summary["checkedRules"] - summary["violations"])
    result = (
        "COMPLIANT" if issues.count == 0
        else "CHANGES_AVAILABLE" if safe_rule_ids
        else "REVIEW_REQUIRED"
    )
    analysis = {
        "schemaVersion": REPORT_SCHEMA_VERSION,
        "engineVersion": ENGINE_VERSION,
        "profile": profile,
        "ruleSet": {
            "id": rule_set["rule_set"]["id"],
            "name": rule_set["rule_set"]["name"],
            "version": rule_set["rule_set"].get("version", "1.0.0"),
            "effectiveFrom": rule_set["rule_set"]["effective_from"],
            "officialSource": rule_set["rule_set"]["official_source"],
            "sha256": rule_hash,
        },
        "ruleContract": rule_set["engine_contract"],
        "semanticSchemaVersion": semantic_fields.get("schema_version", "1.0"),
        "templateSha256": hashlib.sha256(package.content).hexdigest(),
        "documentType": document_type,
        "sizeProfile": size_profile,
        "fields": fields.items,
        "fieldInventory": fields.metadata(),
        "placeholders": placeholders,
        "issues": issues.items,
        "issueInventory": issues.metadata(),
        "summary": summary,
        "result": result,
        "packageSignature": package_signature,
        "structuralFingerprint": _fingerprint(package),
    }
    hash_payload = dict(analysis)
    analysis["analysisHash"] = _hash_json(hash_payload)
    return {
        "analysis": analysis,
        "paragraphs": paragraphs,
        "body": body,
        "resolver": styles,
        "rules": rule_set,
    }


def process_docx(
    content: bytes,
    *,
    profile: str = "sector_template",
    mode: str = "audit",
    expected_analysis_hash: str | None = None,
    _trusted_automatic_pass: bool = False,
) -> WordStandardizationResult:
    """Audit or safely normalize one DOCX without changing its text/template logic.

    `preview_fix` returns a deterministic change plan without output bytes.
    `apply_fix` returns new DOCX bytes and always requires the exact accepted
    analysis hash, refusing rule/source drift.
    """

    normalized_profile = str(profile or "").strip().casefold()
    normalized_mode = str(mode or "").strip().casefold()
    if normalized_profile not in SUPPORTED_PROFILES:
        raise WordStandardizationError("Unsupported Word standardization profile.")
    if normalized_mode not in SUPPORTED_MODES:
        raise WordStandardizationError("Unsupported Word standardization mode.")
    if normalized_mode == "apply_fix" and normalized_profile == "reference_only":
        raise WordStandardizationError(
            "The reference_only profile does not allow automatic fixes."
        )
    if (
        normalized_mode == "apply_fix"
        and not _trusted_automatic_pass
        and not re.fullmatch(
        r"[0-9a-f]{64}", str(expected_analysis_hash or "").strip().casefold()
        )
    ):
        raise WordStandardizationError(
            "apply_fix requires an accepted Word standardization analysis hash."
        )
    package = _Package(content)
    analyzed = _analyze(package, normalized_profile)
    analysis = analyzed["analysis"]
    # `_analyze` already computed the complete structural fingerprint. Reuse
    # it instead of walking every OOXML part a second time.
    before = analysis["structuralFingerprint"]
    if expected_analysis_hash is not None:
        expected = str(expected_analysis_hash).strip().casefold()
        if not re.fullmatch(r"[0-9a-f]{64}", expected) or expected != analysis["analysisHash"]:
            raise WordStandardizationError(
                "The accepted Word standardization analysis is stale."
            )
    if (
        normalized_mode == "apply_fix"
        and analysis["packageSignature"]["detected"]
        and not _trusted_automatic_pass
    ):
        raise WordStandardizationError(
            "A digitally signed OPC package cannot be standardized automatically."
        )
    changes = []
    output = None
    post_summary = None
    invariants = {"status": "NOT_RUN", "before": before}
    if normalized_mode in {"preview_fix", "apply_fix"}:
        if not analysis["packageSignature"]["detected"]:
            changes = _apply_fixes(
                package,
                analyzed["paragraphs"],
                analyzed["body"],
                analyzed["resolver"],
                normalized_profile,
                analyzed["rules"],
                analysis["sizeProfile"],
            )
        after = _fingerprint(package)
        if before != after:
            raise WordStandardizationError(
                "Word template content or structural invariants changed."
            )
        invariants = {"status": "PASS", "before": before, "after": after}
        post_summary = _analyze(package, normalized_profile)["analysis"]["summary"]
        if normalized_mode == "apply_fix":
            if analysis["packageSignature"]["detected"]:
                output = content
            else:
                output = package.serialize()
            output_package = _Package(output)
            if _fingerprint(output_package) != before:
                raise WordStandardizationError(
                    "Serialized Word template failed structural verification."
                )
    report = dict(analysis)
    report.update({
        "mode": normalized_mode,
        "plannedChanges": changes,
        "changed": bool(changes),
        "invariants": invariants,
    })
    if post_summary is not None:
        report["postFixSummary"] = post_summary
    if output is not None:
        report["outputSha256"] = hashlib.sha256(output).hexdigest()
    report["reportHash"] = _hash_json({
        key: value for key, value in report.items() if key != "reportHash"
    })
    if len(_canonical(report).encode("utf-8")) > MAX_REPORT_BYTES:
        raise WordStandardizationError(
            "Word standardization report exceeds the supported size."
        )
    return WordStandardizationResult(report=report, content=output)
