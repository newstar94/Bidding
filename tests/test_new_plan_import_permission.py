from types import SimpleNamespace

import pytest

from backend.procurement_import import routes
from backend.shared.access_policy import BatchWriteAuthorizationContext, authorize_record_write_from_context


@pytest.mark.parametrize('kind,exists,expected', [('PLAN',False,True),('PLAN',True,False),('PACKAGE',False,False)])
def test_session_new_plan_uses_view_only(kind, exists, expected, monkeypatch):
    class Cursor:
        def execute(self, query, params):
            assert params == ('org', 'PL2600146586')
            return self
        def fetchone(self):
            return ('existing',) if exists else None
    monkeypatch.setattr(routes, 'has_module_permission', lambda *args: args[-1] == 'view')
    assert routes._import_session_permission(Cursor(), SimpleNamespace(user_id='employee'), 'org',
        {'kind': kind, 'familyNo': 'PL2600146586'}) is expected


def test_new_plan_draft_does_not_grant_edit_or_unrelated_creation():
    context = BatchWriteAuthorizationContext(role_str='employee', user_id='employee',
        organization_id='org', organization_manager=False, personal_workspace_owner=False,
        active_membership=True, inherited_specialist_access=False, membership_role='employee',
        permissions={'kehoach':'view'}, new_plan_draft_records={('ke_hoach_lcnt','new')})
    def check(record_id):
        return authorize_record_write_from_context(context,'kehoach','ke_hoach_lcnt',{'id':record_id}).allowed
    assert check('new')
    assert not check('existing')
    assert not check('unrelated-new')
    context.permissions = {}
    assert not check('new')


def test_revoked_view_cannot_continue_new_import(monkeypatch):
    cursor = SimpleNamespace(execute=lambda *args: SimpleNamespace(fetchone=lambda: None))
    monkeypatch.setattr(routes, 'has_module_permission', lambda *args: False)
    assert not routes._import_session_permission(cursor, SimpleNamespace(user_id='employee'), 'org',
        {'kind':'PLAN','familyNo':'PL2600146586'})
