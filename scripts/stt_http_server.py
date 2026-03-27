#!/usr/bin/env python3
import cgi
import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("STT_PORT", "18777"))
WORKDIR = os.path.dirname(os.path.dirname(__file__))
VENV_PY = "/root/.openclaw/workspace/.venv-stt/bin/python"
STT_SCRIPT = os.path.join(WORKDIR, "scripts", "stt_transcribe_auto.py")


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._json(200, {"ok": True})

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "service": "stt_http_server"})
        return self._json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        if self.path != "/stt/transcribe":
            return self._json(404, {"ok": False, "error": "not_found"})

        ctype, pdict = cgi.parse_header(self.headers.get("content-type", ""))
        if ctype != "multipart/form-data":
            return self._json(400, {"ok": False, "error": "expected_multipart_form_data"})

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("content-type"),
            },
        )

        file_item = form["file"] if "file" in form else None
        if not file_item or not getattr(file_item, "file", None):
            return self._json(400, {"ok": False, "error": "missing_file"})

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tf:
            tf.write(file_item.file.read())
            in_path = tf.name

        try:
            out = subprocess.check_output(
                [VENV_PY, STT_SCRIPT, in_path, "--json"],
                stderr=subprocess.STDOUT,
                text=True,
                timeout=180,
            )
            data = json.loads(out.strip().splitlines()[-1])
            return self._json(200, {"ok": True, **data})
        except subprocess.CalledProcessError as e:
            return self._json(500, {"ok": False, "error": "stt_failed", "details": (e.output or "")[-800:]})
        except Exception as e:
            return self._json(500, {"ok": False, "error": "server_error", "details": str(e)})
        finally:
            try:
                os.unlink(in_path)
            except Exception:
                pass


if __name__ == "__main__":
    print(f"STT server listening on 127.0.0.1:{PORT}")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
