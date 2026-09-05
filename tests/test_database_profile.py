import json

import pytest

from backend.shared.database_profile import make_profile, expand_profile, read_profile, save_profile_environment


def fixture():
    return {
        'DATABASE_URL': 'postgresql://admin:main@localhost:5432/main?sslmode=disable',
        'APP_ENV': 'development',
        'DATABASE_RUNTIME_PASSWORD': 'different@secret',
        'DATABASE_RUNTIME_ROLE': 'app',
        'RUNTIME_DATABASE_URL': 'postgresql://app:different%40secret@localhost:5432/main?sslmode=disable',
        'RESTORE_DRILL_DATABASE_URL': 'postgresql://admin:main@localhost:5432/restore?sslmode=disable',
        'BACKUP_DATABASE_URL': 'postgresql://backup:separate@other:5433/safe?sslmode=require',
    }


def test_lossless_compaction_and_distinct_restore_target():
    values = fixture()
    profile = make_profile(values)
    expanded = expand_profile(profile, {'DATABASE_URL': values['DATABASE_URL']})
    assert {**values, **expanded} == values
    assert profile['connections']['RUNTIME_DATABASE_URL']['passwordRef'] == 'DATABASE_RUNTIME_PASSWORD'
    assert profile['connections']['RESTORE_DRILL_DATABASE_URL']['path'] == '/restore'
    assert profile['values']['BACKUP_DATABASE_URL'] == values['BACKUP_DATABASE_URL']
    assert 'different%40secret' not in json.dumps(profile)


def test_explicit_environment_wins_and_host_is_derived():
    profile = make_profile(fixture())
    expanded = expand_profile(profile, {
        'DATABASE_URL': 'postgresql://admin:main@newhost:5555/main?sslmode=require',
        'BACKUP_DATABASE_URL': 'explicit',
    })
    assert '@newhost:5555/main?sslmode=require' in expanded['RUNTIME_DATABASE_URL']
    assert expanded['BACKUP_DATABASE_URL'] == 'explicit'


def test_production_rejects_local_profile_and_missing_profile_is_not_ignored(tmp_path):
    with pytest.raises(ValueError, match='production'):
        read_profile(tmp_path, {'APP_ENV': 'production', 'BIDDING_DATABASE_PROFILE': 'db.json'})
    with pytest.raises(ValueError, match='Cannot load'):
        read_profile(tmp_path, {'BIDDING_DATABASE_PROFILE': 'absent.json'})


def test_setup_roundtrip_keeps_profile_compact_and_passwords_stable(tmp_path):
    values = {**fixture(), 'BIDDING_DATABASE_PROFILE': 'db.json'}
    (tmp_path / 'db.json').write_text(json.dumps(make_profile(values)), encoding='utf-8')
    lines = [f'{k}={v}' for k, v in values.items()]
    compact = save_profile_environment(tmp_path, lines)
    assert not any(line.startswith('DATABASE_RUNTIME_PASSWORD=') for line in compact)
    assert read_profile(tmp_path, values)['DATABASE_RUNTIME_PASSWORD'] == 'different@secret'


def test_profile_cannot_inject_application_settings():
    with pytest.raises(ValueError, match='Unexpected'):
        expand_profile({'version': 1, 'values': {'APP_DEBUG': 'true'}, 'connections': {}}, {})


def test_private_writer_replaces_complete_profile(tmp_path):
    from backend.shared.database_profile import write_private
    path = tmp_path / 'profile.json'
    write_private(path, '{"version": 1}')
    write_private(path, '{"version": 2}')
    assert json.loads(path.read_text()) == {'version': 2}
    assert list(tmp_path.glob('.db-profile-*')) == []


def test_malformed_profile_does_not_fallback_to_main_database(tmp_path):
    (tmp_path / 'db.json').write_text('{broken', encoding='utf-8')
    with pytest.raises(ValueError, match='Cannot load'):
        read_profile(tmp_path, {'DATABASE_URL': 'postgresql://localhost/main',
                                'BIDDING_DATABASE_PROFILE': 'db.json'})


def test_setup_reader_expands_profile_before_existing_update_logic(tmp_path, monkeypatch):
    from scripts import setup_local_postgres
    values = {**fixture(), 'BIDDING_DATABASE_PROFILE': 'db.json'}
    (tmp_path / 'db.json').write_text(json.dumps(make_profile(values)), encoding='utf-8')
    env_path = tmp_path / '.env'
    env_path.write_text('DATABASE_URL=' + values['DATABASE_URL'] + '\nBIDDING_DATABASE_PROFILE=db.json\n', encoding='utf-8')
    monkeypatch.setattr(setup_local_postgres, 'ROOT', tmp_path)
    monkeypatch.setattr(setup_local_postgres, 'ENV_FILE', env_path)
    lines, loaded = setup_local_postgres._read_env()
    assert loaded['DATABASE_RUNTIME_PASSWORD'] == values['DATABASE_RUNTIME_PASSWORD']
    assert loaded['RUNTIME_DATABASE_URL'] == values['RUNTIME_DATABASE_URL']
    assert any(line.startswith('RUNTIME_DATABASE_URL=') for line in lines)


def test_script_loader_preserves_process_overrides(tmp_path, monkeypatch):
    from scripts.env_utils import load_env
    values = fixture()
    (tmp_path / 'db.json').write_text(json.dumps(make_profile(values)), encoding='utf-8')
    (tmp_path / '.env').write_text('DATABASE_URL=' + values['DATABASE_URL'] + '\nBIDDING_DATABASE_PROFILE=db.json\n', encoding='utf-8')
    monkeypatch.setattr('os.environ', {'RUNTIME_DATABASE_URL': 'explicit'})
    load_env(tmp_path)
    import os
    assert os.environ['RUNTIME_DATABASE_URL'] == 'explicit'
    assert os.environ['RESTORE_DRILL_DATABASE_URL'] == values['RESTORE_DRILL_DATABASE_URL']
