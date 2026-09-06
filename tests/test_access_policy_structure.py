import ast
from pathlib import Path

from backend.shared import access_policy
from backend.shared import access_principals, document_access_policy


def test_chunked_keeps_configurable_size_and_default_batch_size():
    assert list(access_policy._chunked(range(5), size=2)) == [[0, 1], [2, 3], [4]]
    assert [len(chunk) for chunk in access_policy._chunked(range(501))] == [500, 1]


def test_access_policy_has_no_shadowed_top_level_definitions():
    source = Path(access_policy.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    names = [
        node.name
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    ]
    assert len(names) == len(set(names))


def test_access_policy_keeps_the_legacy_public_import_seam():
    principal_names = (
        "can_upload_workspace_assets",
        "has_active_organization_membership",
        "has_inherited_specialist_access",
        "has_module_permission",
        "is_assignment_scoped_active_role",
        "is_business_organization",
        "is_manager_role",
        "is_organization_manager",
        "is_personal_workspace_owner",
        "organization_membership_role",
    )
    document_names = (
        "DocumentExportCapabilities",
        "can_manage_word_config",
        "can_read_word_config",
        "resolve_document_export_capabilities",
    )
    for name in principal_names:
        assert getattr(access_policy, name) is getattr(access_principals, name)
    for name in document_names:
        assert getattr(access_policy, name) is getattr(document_access_policy, name)
