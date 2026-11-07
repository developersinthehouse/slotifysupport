#!/usr/bin/env python3
"""Serve this folder on your own computer:  python tools/serve.py [port] [--lan]

Why not "python -m http.server"? On some Windows computers Python reads the type of .js files from the
registry and gets text/plain, and browsers refuse ES modules sent that way, so the 3D page would not start.
This script states the file types itself. It listens on this computer only (127.0.0.1) unless you add --lan,
which lets a phone on the same Wi-Fi open it too."""
import functools
import http.server
import mimetypes
import os
import sys

TYPES = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}
for ext, kind in TYPES.items():
    mimetypes.add_type(kind, ext)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')          # always show the files as they are on disk
        super().end_headers()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    try:
        port = int(args[0]) if args else 8081
    except ValueError:
        print('Usage: python tools/serve.py [port] [--lan]')
        return 2
    host = '' if '--lan' in sys.argv else '127.0.0.1'
    root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    handler = functools.partial(Handler, directory=root)
    try:
        server = http.server.ThreadingHTTPServer((host, port), handler)
    except OSError:
        print(f'Port {port} is already in use. Close the other window that serves on it, or pick another port: python tools/serve.py {port + 1}')
        return 1
    with server:
        print(f'Slotify website: http://localhost:{port}   (press Ctrl+C to stop)')
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
