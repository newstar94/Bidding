"""Local PostgreSQL profile: preserve identities, derive URLs, never rotate keys.

Explicit environment variables always take precedence over profile defaults.
Production deployments must continue injecting service-scoped credentials.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit

PROFILE_ENV = "BIDDING_DATABASE_PROFILE"
KEEP_URLS = frozenset({"DATABASE_URL", "TEST_DATABASE_URL", "API_TEST_DATABASE_URL"})
PROFILE_KEYS = frozenset({
    "DATABASE_ADMIN_URL", "POSTGRES_LOCAL_ADMIN_PASSWORD", "RUNTIME_DATABASE_URL",
    "MIGRATOR_DATABASE_URL", "BACKUP_DATABASE_URL", "DOCUMENT_WORKER_DATABASE_URL",
    "MULTIWORKER_TEST_DATABASE_URL", "LOAD_TEST_DATABASE_URL", "PERFORMANCE_DATABASE_URL",
    "RESTORE_DRILL_DATABASE_URL",
    *(f"DATABASE_{role}_{field}" for role in ("RUNTIME", "MIGRATOR", "BACKUP", "DOCUMENT_WORKER")
      for field in ("ROLE", "PASSWORD")),
})


def parse_env(text):
    values = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def profile_path(root, environment):
    configured = environment.get(PROFILE_ENV, '').strip()
    if not configured:
        return None
    if environment.get('APP_ENV', 'development').strip().lower() in {'prod', 'production'}:
        raise ValueError('Local database profiles are not supported in production; inject service credentials')
    path = Path(configured)
    return path if path.is_absolute() else Path(root) / path


def expand_profile(profile, environment):
    if not isinstance(profile, dict) or profile.get('version') != 1:
        raise ValueError('Unsupported database profile version')
    values = profile.get('values', {})
    connections = profile.get('connections', {})
    if not isinstance(values, dict) or not isinstance(connections, dict):
        raise ValueError('Invalid database profile')
    if (set(values) | set(connections)) - PROFILE_KEYS or set(values) & set(connections):
        raise ValueError('Unexpected or duplicate database profile keys')
    if any(not isinstance(v, str) for v in values.values()):
        raise ValueError('Database profile values must be strings')
    result = {**values, **environment}
    for key, spec in connections.items():
        if key in environment:
            continue
        base = urlsplit(result.get('DATABASE_URL', ''))
        if base.scheme not in {'postgresql', 'postgres'} or not base.hostname:
            raise ValueError('DATABASE_URL must be a PostgreSQL connection URL')
        # Network address and transport options follow the main connection;
        # the database and account remain exact, independent identities.
        netloc = base.netloc
        if not isinstance(spec, dict) or set(spec) - {'path', 'username', 'passwordRef'}:
            raise ValueError('Invalid database connection specification')
        password_ref = spec.get('passwordRef')
        if password_ref:
            if password_ref not in PROFILE_KEYS or password_ref not in result:
                raise ValueError('Missing database profile credential')
            user = spec['username']
            netloc = quote(user, safe='') + ':' + quote(result[password_ref], safe='') + '@' + base.netloc.rsplit('@', 1)[-1]
        path = spec['path']
        if not isinstance(path, str) or not path.startswith('/'):
            raise ValueError('Invalid database profile target')
        result[key] = urlunsplit((base.scheme, netloc, path, base.query, base.fragment))
    return {k: v for k, v in result.items() if k in PROFILE_KEYS}


def read_profile(root, environment):
    path = profile_path(root, environment)
    if path is None:
        return {}
    try:
        profile = json.loads(path.read_text(encoding='utf-8-sig'))
        return expand_profile(profile, environment)
    except (OSError, ValueError, KeyError, TypeError):
        raise ValueError('Cannot load local database profile; check file and configuration') from None


def load_profile(root, environment=None):
    environment = os.environ if environment is None else environment
    for key, value in read_profile(root, environment).items():
        environment.setdefault(key, value)


def make_profile(values):
    """Derive only exactly reproducible URLs; retain all other connections verbatim."""
    profile = {'version': 1, 'values': {k: v for k, v in values.items() if k in PROFILE_KEYS}, 'connections': {}}
    base = urlsplit(values.get('DATABASE_URL', ''))
    for key, value in list(profile['values'].items()):
        if not key.endswith('_URL') or not value:
            continue
        target = urlsplit(value)
        if (target.scheme, target.netloc.rsplit('@', 1)[-1], target.query, target.fragment) != (
            base.scheme, base.netloc.rsplit('@', 1)[-1], base.query, base.fragment):
            continue
        spec = {'path': target.path}
        if target.netloc != base.netloc:
            refs = [k for k, v in values.items() if k in PROFILE_KEYS and k.endswith('_PASSWORD') and v == unquote(target.password or '')]
            if not refs:
                continue
            spec.update(username=unquote(target.username or ''), passwordRef=refs[0])
        trial = {'version': 1, 'values': dict(profile['values']), 'connections': {**profile['connections'], key: spec}}
        del trial['values'][key]
        expanded = expand_profile(trial, {k: v for k, v in values.items() if k not in PROFILE_KEYS})
        if expanded.get(key) == value:
            profile = trial
    assert expand_profile(profile, {k: v for k, v in values.items() if k not in PROFILE_KEYS}) == {k: v for k, v in values.items() if k in PROFILE_KEYS}
    return profile


def write_private(path, payload):
    """Protect a new temporary file before writing secrets, then replace atomically."""
    import subprocess
    import tempfile
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix='.db-profile-', dir=path.parent)
    os.close(descriptor)
    try:
        if os.name == 'nt':
            account = os.environ.get('USERDOMAIN', '') + '\\' + os.environ['USERNAME']
            subprocess.run(['icacls', temporary, '/inheritance:r', '/grant:r',
                            account + ':(F)', '*S-1-5-18:(F)', '*S-1-5-32-544:(F)'],
                           check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            os.chmod(temporary, 0o600)
        with open(temporary, 'wb') as handle:
            handle.write(payload if isinstance(payload, bytes) else payload.encode('utf-8'))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def save_profile_environment(root, lines):
    """Setup writer: legacy .env stays supported; compact profiles stay compact."""
    values = parse_env('\n'.join(lines))
    path = profile_path(root, values)
    if path is None:
        return lines
    payload = json.dumps(make_profile(values), ensure_ascii=False, indent=2) + '\n'
    # Existing profile must already be provisioned with private permissions.
    if not path.is_file():
        raise ValueError('Database profile must be provisioned before setup')
    write_private(path, payload)
    return [line for line in lines if line.split('=', 1)[0].strip() not in PROFILE_KEYS]
