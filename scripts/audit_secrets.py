"""Fail when detect-secrets finds a candidate in maintained source files."""

import json
import shutil
import subprocess
import sys
from pathlib import Path


EXCLUDED_PATHS = (
    r"(^|[\\/])(?:\.git|\.venv|node_modules|dist|data|requirements|sbom|scratch|tests|"
    r"test-results|playwright-report|views[\\/]vendor)(?:[\\/]|$)|"
    r"(^|[\\/])(?:package-lock\.json|\.env(?:\.example)?|.*\.lock\.txt)$"
)


def main():
    executable_name = "detect-secrets.exe" if sys.platform == "win32" else "detect-secrets"
    environment_executable = Path(sys.executable).with_name(executable_name)
    executable = (
        str(environment_executable)
        if environment_executable.is_file()
        else shutil.which("detect-secrets")
    )
    if not executable:
        print("detect-secrets is missing; install requirements/dev.lock.txt", file=sys.stderr)
        return 2
    result = subprocess.run(
        [
            executable,
            "scan",
            "--all-files",
            "--exclude-files",
            EXCLUDED_PATHS,
            "--exclude-lines",
            r"pragma: allowlist secret|\"audit:secrets\"",
        ],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        print(result.stderr.strip() or "detect-secrets failed", file=sys.stderr)
        return result.returncode
    report = json.loads(result.stdout)
    findings = report.get("results", {})
    if findings:
        for filename, candidates in sorted(findings.items()):
            for candidate in candidates:
                print(
                    f"{filename}:{candidate.get('line_number')}: {candidate.get('type')}",
                    file=sys.stderr,
                )
        print(
            "Potential secrets detected. Remove them or annotate reviewed test data with "
            "'# pragma: allowlist secret'.",
            file=sys.stderr,
        )
        return 1
    print("Secret scan passed (no candidates in maintained source files).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
