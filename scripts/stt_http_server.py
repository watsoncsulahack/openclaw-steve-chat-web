#!/usr/bin/env python3
import json
import os
import subprocess
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get("STT_PORT", "18777"))
WORKDIR = os.path.dirname(os.path.dirname(__file__))
VENV_PY = "/root/.openclaw/workspace/.venv-stt/bin/python"
STT_SCRIPT = os.path.join(WORKDIR, "scripts", "stt_transcribe_auto.py")
CONFIG_PATH = os.environ.get(
    "STT_CONFIG_PATH",
    os.path.join(WORKDIR, "data", "stt_config.json"),
)
MODEL_DIR = os.environ.get(
    "STT_MODEL_DIR",
    os.path.join(WORKDIR, "data", "stt_models"),
)
RECORDINGS_DIR = os.environ.get(
    "STT_RECORDINGS_DIR",
    os.path.join(WORKDIR, "data", "recordings"),
)

STT_MODELS = [
    {
        "id": "small.en",
        "name": "Whisper small.en",
        "sizeMb": 465,
        "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
        "downloadFile": "ggml-small.en.bin",
    },
    {
        "id": "medium.en",
        "name": "Whisper medium.en",
        "sizeMb": 1463,
        "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
        "downloadFile": "ggml-medium.en.bin",
    },
    {
        "id": "large-v3",
        "name": "Whisper large-v3",
        "sizeMb": 3100,
        "downloadUrl": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
        "downloadFile": "ggml-large-v3.bin",
    },
]
DEFAULT_MODEL = os.environ.get("STT_MODEL", "small.en")


def _model_ids():
    return {m["id"] for m in STT_MODELS}


def _load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}

    model = str(data.get("model") or DEFAULT_MODEL)
    if model not in _model_ids():
        model = DEFAULT_MODEL
    model_dir = str(data.get("modelDir") or MODEL_DIR)
    return {"model": model, "modelDir": model_dir}


def _save_config(data):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    current = _load_config()
    current.update(data)
    if current["model"] not in _model_ids():
        current["model"] = DEFAULT_MODEL
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2, sort_keys=True)
    return current


def _model_dir_has_files(path):
    try:
        return os.path.isdir(path) and bool(os.listdir(path))
    except Exception:
        return False


def _extract_multipart(content_type: str, body: bytes):
    if "boundary=" not in content_type:
        raise ValueError("missing boundary")
    boundary = content_type.split("boundary=", 1)[1].strip().strip('"')
    marker = ("--" + boundary).encode()

    parts = body.split(marker)
    fields = {}
    file_data = None
    filename = "recording.webm"
    for p in parts:
        if b"Content-Disposition" not in p:
            continue
        header_end = p.find(b"\r\n\r\n")
        if header_end == -1:
            continue
        headers = p[:header_end].decode("utf-8", errors="ignore")
        data = p[header_end + 4:].rstrip(b"\r\n")
        field_name = ""
        for line in headers.split("\r\n"):
            if "Content-Disposition" in line and "name=" in line:
                for chunk in line.split(";"):
                    chunk = chunk.strip()
                    if chunk.startswith("name="):
                        field_name = chunk.split("=", 1)[1].strip().strip('"')
                        break

        if field_name == "file":
            for line in headers.split("\r\n"):
                if "Content-Disposition" in line and "filename=" in line:
                    try:
                        filename = line.split("filename=", 1)[1].strip().strip('"')
                    except Exception:
                        pass
            file_data = data
        elif field_name:
            fields[field_name] = data.decode("utf-8", errors="ignore").strip()

    if file_data is None:
        raise ValueError("file field not found")
    return file_data, filename, fields


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
        path = urlparse(self.path).path
        if path == "/health":
            config = _load_config()
            return self._json(200, {
                "ok": True,
                "service": "stt_http_server",
                "configuredModel": config["model"],
                "modelDir": config["modelDir"],
                "modelReady": _model_dir_has_files(config["modelDir"]),
            })
        if path == "/stt/models":
            config = _load_config()
            return self._json(200, {
                "ok": True,
                "models": STT_MODELS,
                "configuredModel": config["model"],
                "modelDir": config["modelDir"],
            })
        if path == "/stt/config":
            config = _load_config()
            return self._json(200, {"ok": True, **config})
        return self._json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/stt/config":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length)
                payload = json.loads(body.decode("utf-8") or "{}")
                model = str(payload.get("model") or "")
                model_dir = str(payload.get("modelDir") or "")
                data = {}
                if model:
                    if model not in _model_ids():
                        return self._json(400, {"ok": False, "error": "unknown_model"})
                    data["model"] = model
                if model_dir:
                    data["modelDir"] = model_dir
                return self._json(200, {"ok": True, **_save_config(data)})
            except Exception as e:
                return self._json(400, {"ok": False, "error": "bad_config", "details": str(e)})

        if path == "/stt/models/install":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length)
                payload = json.loads(body.decode("utf-8") or "{}")
                model = str(payload.get("model") or _load_config()["model"])
                model_dir = str(payload.get("modelDir") or _load_config()["modelDir"] or MODEL_DIR)
                if model not in _model_ids():
                    return self._json(400, {"ok": False, "error": "unknown_model"})
                config = _save_config({"model": model, "modelDir": model_dir})
                os.makedirs(config["modelDir"], exist_ok=True)
                subprocess.check_output(
                    [VENV_PY, STT_SCRIPT, "--help"],
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=30,
                )
                # Instantiating faster-whisper downloads the model into modelDir.
                subprocess.check_output(
                    [
                        VENV_PY,
                        "-c",
                        "import sys; from faster_whisper import WhisperModel; WhisperModel(sys.argv[1], device='cpu', compute_type='int8', download_root=sys.argv[2]); print('ok')",
                        model,
                        config["modelDir"],
                    ],
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=1800,
                )
                return self._json(200, {"ok": True, **config})
            except subprocess.CalledProcessError as e:
                return self._json(500, {"ok": False, "error": "model_install_failed", "details": (e.output or "")[-800:]})
            except Exception as e:
                return self._json(500, {"ok": False, "error": "model_install_error", "details": str(e)})

        if path != "/stt/transcribe":
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
            file_bytes, original_name, fields = _extract_multipart(ctype, body)
        except Exception as e:
            return self._json(400, {"ok": False, "error": "multipart_parse_failed", "details": str(e)})

        config = _load_config()
        requested_model = str(fields.get("model") or config["model"])
        if requested_model not in _model_ids():
            return self._json(400, {"ok": False, "error": "unknown_model"})
        requested_model_dir = str(fields.get("modelDir") or "").strip()
        updates = {}
        if requested_model != config["model"]:
            updates["model"] = requested_model
        if requested_model_dir:
            updates["modelDir"] = requested_model_dir
        if updates:
            config = _save_config(updates)

        os.makedirs(RECORDINGS_DIR, exist_ok=True)
        safe_ext = os.path.splitext(original_name or "recording.webm")[1].lower()
        if not safe_ext or len(safe_ext) > 10:
            safe_ext = ".webm"
        stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        base = f"rec_{stamp}_{os.getpid()}"
        saved_path = os.path.join(RECORDINGS_DIR, f"{base}{safe_ext}")
        input_path = os.path.join(RECORDINGS_DIR, f"{base}.webm")

        with open(saved_path, "wb") as sf:
            sf.write(file_bytes)

        if saved_path != input_path:
            with open(input_path, "wb") as inf:
                inf.write(file_bytes)
        else:
            input_path = saved_path

        try:
            out = subprocess.check_output(
                [VENV_PY, STT_SCRIPT, input_path, "--json", "--model", config["model"], "--model-dir", config["modelDir"]],
                stderr=subprocess.STDOUT,
                text=True,
                timeout=180,
            )
            data = json.loads(out.strip().splitlines()[-1])
            return self._json(200, {"ok": True, "savedPath": saved_path, **data})
        except subprocess.CalledProcessError as e:
            return self._json(500, {"ok": False, "error": "stt_failed", "savedPath": saved_path, "details": (e.output or "")[-800:]})
        except Exception as e:
            return self._json(500, {"ok": False, "error": "server_error", "savedPath": saved_path, "details": str(e)})
        finally:
            try:
                if input_path != saved_path:
                    os.unlink(input_path)
            except Exception:
                pass


if __name__ == "__main__":
    print(f"STT server listening on 127.0.0.1:{PORT}")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
