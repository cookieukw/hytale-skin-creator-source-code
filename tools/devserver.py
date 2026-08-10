"""No-cache static development server.

Default `python3 -m http.server` allows browser caching, which causes local
development to serve stale versions of catalog.js / fitting_room.js without warning.

Usage:  python3 tools/devserver.py [port]
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Log errors only: requesting ~900 cosmetic assets pollutes console output
        if not args or not str(args[0]).startswith(("GET", "HEAD")) or \
                (len(args) > 1 and str(args[1]) != "200"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    print(f"serving on http://localhost:{port} (no cache)")
    ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
