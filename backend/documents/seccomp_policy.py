"""Linux seccomp policy for untrusted document parsers.

The filesystem and network namespace are created by Bubblewrap. This
defense-in-depth filter denies process creation, execution, networking and
kernel-management syscalls after the Python worker has started.
"""

from __future__ import annotations

import ctypes
from ctypes.util import find_library
import errno
import os


_DENIED_SYSCALLS = (
    # No child process, replacement executable or additional namespace.
    "clone",
    "clone3",
    "fork",
    "vfork",
    "execve",
    "execveat",
    "unshare",
    "setns",
    # No network or Unix-domain database/socket access.
    "socket",
    "socketpair",
    "connect",
    "bind",
    "listen",
    "accept",
    "accept4",
    "sendto",
    "sendmsg",
    "sendmmsg",
    "recvfrom",
    "recvmsg",
    "recvmmsg",
    # No mount, tracing, kernel/keyring or cross-process memory primitives.
    "mount",
    "umount2",
    "pivot_root",
    "ptrace",
    "bpf",
    "perf_event_open",
    "keyctl",
    "add_key",
    "request_key",
    "process_vm_readv",
    "process_vm_writev",
    "open_by_handle_at",
    "name_to_handle_at",
)


def seccomp_library_name() -> str | None:
    if os.name != "posix":
        return None
    return find_library("seccomp")


def apply_document_seccomp(*, required: bool) -> bool:
    """Load a fail-closed deny policy and return whether it was applied."""

    if os.name != "posix":
        if required:
            raise RuntimeError("Seccomp is only available on Linux/POSIX workers.")
        return False
    library_name = seccomp_library_name()
    if not library_name:
        if required:
            raise RuntimeError("libseccomp is required for production document workers.")
        return False

    library = ctypes.CDLL(library_name, use_errno=True)
    library.seccomp_init.argtypes = [ctypes.c_uint32]
    library.seccomp_init.restype = ctypes.c_void_p
    library.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    library.seccomp_syscall_resolve_name.restype = ctypes.c_int
    library.seccomp_rule_add.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_int,
        ctypes.c_uint,
    ]
    library.seccomp_rule_add.restype = ctypes.c_int
    library.seccomp_load.argtypes = [ctypes.c_void_p]
    library.seccomp_load.restype = ctypes.c_int
    library.seccomp_release.argtypes = [ctypes.c_void_p]
    library.seccomp_release.restype = None

    scmp_act_allow = 0x7FFF0000
    scmp_act_errno = 0x00050000 | errno.EPERM
    context = library.seccomp_init(scmp_act_allow)
    if not context:
        raise RuntimeError("Cannot initialize the document-worker seccomp policy.")
    try:
        installed = 0
        for syscall_name in _DENIED_SYSCALLS:
            syscall_number = library.seccomp_syscall_resolve_name(
                syscall_name.encode("ascii")
            )
            if syscall_number < 0:
                continue
            result = library.seccomp_rule_add(
                context, scmp_act_errno, syscall_number, 0
            )
            if result != 0:
                raise OSError(-result, f"Cannot deny syscall {syscall_name}")
            installed += 1
        if installed < 10:
            raise RuntimeError("The document-worker seccomp policy is incomplete.")
        result = library.seccomp_load(context)
        if result != 0:
            raise OSError(-result, "Cannot load document-worker seccomp policy")
    finally:
        library.seccomp_release(context)
    return True
