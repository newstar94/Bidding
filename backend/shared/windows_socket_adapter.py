"""Narrow compatibility adapter for harmless Windows socket shutdown races."""

import socket
import sys


_installed = False


def install_windows_socket_shutdown_adapter():
    global _installed
    if _installed or sys.platform != "win32":
        return False
    original_shutdown = socket.socket.shutdown

    def shutdown_ignoring_already_closed(socket_instance, how):
        try:
            return original_shutdown(socket_instance, how)
        except OSError:
            return None

    socket.socket.shutdown = shutdown_ignoring_already_closed
    _installed = True
    return True
