# Local server that mimics the MV3 extension-page CSP for testing:
# script-src 'self'; object-src 'self'
import sys
import http.server
import functools


class CSPHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Security-Policy', "script-src 'self'; object-src 'self'")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8932
    handler = functools.partial(CSPHandler, directory=sys.argv[2] if len(sys.argv) > 2 else '.')
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print('serving on', port, flush=True)
        httpd.serve_forever()
