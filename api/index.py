import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from tjc_core import analyze_message, public_ai_config, search_knowledge, update_ai_config, KB


def route_path(raw_path):
    path = urlparse(raw_path).path
    if path == "/api":
        return "/"
    if path.startswith("/api/"):
        return path[4:]
    return path


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = route_path(self.path)
        params = parse_qs(urlparse(self.path).query)

        if path in ("/", "/health"):
            self._json({"ok": True, "service": "tongjc-api"})
            return
        if path == "/frameworks":
            self._json({"frameworks": KB.get("frameworks", [])})
            return
        if path == "/search":
            query = params.get("q", [""])[0]
            results = search_knowledge(query, top_n=15) if query else []
            self._json({"query": query, "results": results})
            return
        if path == "/api-config":
            self._json(public_ai_config())
            return

        self._json({"error": "Not found"}, status=404)

    def do_POST(self):
        path = route_path(self.path)

        if path == "/analyze":
            data = self._read_json()
            message = str(data.get("message", ""))
            context = data.get("context", [])
            background = data.get("background", "")
            self._json(analyze_message(message, context, background))
            return

        if path == "/api-config":
            self._json(update_ai_config(self._read_json()))
            return

        self._json({"error": "Not found"}, status=404)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _read_json(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length else b"{}"
        try:
            return json.loads(body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}

    def _json(self, data, status=200):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(payload)

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def log_message(self, format, *args):
        pass
