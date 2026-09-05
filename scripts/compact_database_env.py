"""Move local DB setup/service configuration into a private, derived profile.

Dry-run by default. No SQL, credential changes, service restart or secret output.
"""
from pathlib import Path
import argparse
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.shared.database_profile import (
    PROFILE_ENV, PROFILE_KEYS, make_profile, expand_profile, parse_env, write_private,
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    env_path = ROOT / '.env'
    original = env_path.read_bytes()
    text = original.decode('utf-8-sig')
    values = parse_env(text)
    if values.get(PROFILE_ENV):
        print('Already using a database profile; no changes')
        return
    if values.get('APP_ENV', '').lower() in {'production', 'prod'}:
        raise ValueError('Only local environments can be compacted')
    profile = make_profile(values)
    remaining = {k: v for k, v in values.items() if k not in PROFILE_KEYS}
    assert {**remaining, **expand_profile(profile, remaining)} == values
    output = []
    for line in text.splitlines():
        if line.split('=', 1)[0].strip() in PROFILE_KEYS:
            if output and output[-1].startswith('# ') and not output[-1].startswith('# ='):
                output.pop()
            continue
        output.append(line)
    output += ['', '# Cấu hình PostgreSQL cục bộ riêng tư: không đưa file này vào Git.',
               '# URL dịch vụ được sinh từ DATABASE_URL; tài khoản và database vẫn tách biệt.',
               PROFILE_ENV + '=.env.database.json']
    result = '\n'.join(output) + '\n'
    assert {k: v for k, v in parse_env(result).items() if k != PROFILE_ENV} == remaining
    profile_path = ROOT / '.env.database.json'
    backup_path = ROOT / '.env.database.json.backup'
    if profile_path.exists() or backup_path.exists():
        raise ValueError('Profile or backup already exists; refusing overwrite')
    print(f'Keys moved: {len(set(values) & PROFILE_KEYS)}; derived URLs: {len(profile["connections"])}; parity: OK')
    if args.apply:
        if env_path.read_bytes() != original:
            raise ValueError('Concurrent edit detected')
        # Save recoverable, private artifacts before replacing the environment file.
        write_private(backup_path, original)
        write_private(profile_path, json.dumps(profile, ensure_ascii=False, indent=2) + '\n')
        write_private(env_path, result)
        print('Applied; private rollback backup created; no database changes')
    else:
        print('Dry-run only')


if __name__ == '__main__':
    main()
