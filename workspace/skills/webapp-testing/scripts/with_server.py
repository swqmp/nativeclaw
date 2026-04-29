#!/usr/bin/env python3
"""Manage server lifecycle for Playwright automation scripts.

Starts one or more servers, waits for them to be ready (port listening),
runs a child command, then tears everything down on exit.

Usage:
  python with_server.py --server "npm run dev" --port 5173 -- python test.py
  python with_server.py \
    --server "cd backend && python server.py" --port 3000 \
    --server "cd frontend && npm run dev" --port 5173 \
    -- python test.py

Options:
  --server CMD    Shell command to start a server (repeatable)
  --port PORT     Port to wait for (one per --server, same order)
  --timeout SEC   Max seconds to wait for each port (default: 30)
  --help          Show this help message
"""

import sys
import os
import time
import socket
import signal
import subprocess
import argparse
import atexit

processes = []


def cleanup():
    for proc in reversed(processes):
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


atexit.register(cleanup)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))
signal.signal(signal.SIGINT, lambda *_: sys.exit(1))


def wait_for_port(port, host="127.0.0.1", timeout=30):
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.5)
    return False


def parse_args():
    parser = argparse.ArgumentParser(
        description="Start servers, wait for ports, run a command, then clean up.",
        usage="%(prog)s --server CMD --port PORT [--server CMD --port PORT ...] [--timeout SEC] -- COMMAND [ARGS...]",
    )
    parser.add_argument("--server", action="append", default=[], help="Server command (repeatable)")
    parser.add_argument("--port", action="append", type=int, default=[], help="Port to wait for (one per --server)")
    parser.add_argument("--timeout", type=int, default=30, help="Seconds to wait per port (default: 30)")

    if "--" in sys.argv:
        split = sys.argv.index("--")
        our_args = sys.argv[1:split]
        child_args = sys.argv[split + 1:]
    else:
        our_args = sys.argv[1:]
        child_args = []

    args = parser.parse_args(our_args)
    args.child = child_args
    return args


def main():
    args = parse_args()

    if not args.server:
        print("Error: at least one --server is required.", file=sys.stderr)
        sys.exit(1)

    if len(args.server) != len(args.port):
        print(f"Error: got {len(args.server)} --server but {len(args.port)} --port. They must match.", file=sys.stderr)
        sys.exit(1)

    if not args.child:
        print("Error: no child command after '--'.", file=sys.stderr)
        sys.exit(1)

    # Start servers
    for i, (cmd, port) in enumerate(zip(args.server, args.port)):
        print(f"[with_server] Starting server {i+1}: {cmd}")
        proc = subprocess.Popen(cmd, shell=True, preexec_fn=os.setsid)
        processes.append(proc)

    # Wait for ports
    for i, port in enumerate(args.port):
        print(f"[with_server] Waiting for port {port} (timeout: {args.timeout}s)...")
        if not wait_for_port(port, timeout=args.timeout):
            print(f"[with_server] ERROR: port {port} not ready after {args.timeout}s", file=sys.stderr)
            sys.exit(1)
        print(f"[with_server] Port {port} ready.")

    # Run child command
    print(f"[with_server] Running: {' '.join(args.child)}")
    result = subprocess.run(args.child)

    # Cleanup happens via atexit
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
