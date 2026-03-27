#!/usr/bin/env python3
import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("STT_PORT", "18777"))
WORKDIR = os.path.dirname(os.path.dirname(__file__))
VENV_PY = "/root/.openclaw/workspace/.venv-stt/bin/python"
STT_SCRIPT = os.path.join(WORKDIR, "scripts", "stt_transcribe_auto.py")


def _extract_multipart_file(content_type: str, body: bytes):
    if "boundary=" not in content_type:
        raise ValueError("missing boundary")
    boundary = content_type.split("boundary=", 1)[1].strip().strip('"')
    marker = ("--" + boundary).encode()

    parts = body.split(marker)
    for p in parts:
      if b"Content-Disposition" not in p:
        continue
      header_end = p.find(b"\r\n\r\n")
      if header_end == -1:
        continue
      headers = p[:header_end].decode("utf-8", errors="ignore")
      if 'name="file"' not in headers:
        continue
      data = p[header_end + 4:]
      # trim CRLF + final boundary trailer fragments
      data = data.rstrip(b"\r\n")
      return data

    raise ValueError("file field not found")


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
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

        ctype = self.headers.get("content-type", "")
        if "multipart/form-data" not in ctype:
            return self._json(400, {"ok": False, "error": "expected_multipart_form_data"})

        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            return self._json(400, {"ok": False, "error": "bad_content_length"})

        body = self.rfile.read(length)

        try:
            file_bytes = _extract_multipart_file(ctype, body)
        except Exception as e:
            return self._json(400, {"ok": False, "error": "multipart_parse_failed", "details": str(e)})

        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tf:
            tf.write(file_bytes)
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
