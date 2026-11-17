import http.server
import json
import os
import re
import socket
import subprocess
import sys
from pathlib import Path

PORT = 8000
ROOT = Path(__file__).resolve().parent
PAYLOAD_DIR = ROOT / "payloads"

def local_ip():
    try:
        output = subprocess.check_output(
            ["ipconfig"],
            text=True,
            encoding="utf-8",
            errors="ignore",
        )
        for ip in re.findall(r"IPv4[^:]*:\s*([\d.]+)", output):
            if ip.startswith("192.168.") or ip.startswith("10.") or ip.startswith("172."):
                return ip
    except Exception:
        pass
    return "127.0.0.1"

def send_elf_to_ps5(target_ip: str, payload_name: str, port: int = 9021, timeout: float = 6.0):
    safe_name = os.path.basename(payload_name)
    payload_path = PAYLOAD_DIR / safe_name
    if not payload_path.is_file():
        return False, f"Payload file '{safe_name}' not found on host."

    with open(payload_path, "rb") as f:
        data = f.read()

    if len(data) < 4 or data[:4] != b"\x7fELF":
        return False, f"File '{safe_name}' is not a valid ELF binary."

    try:
        with socket.create_connection((target_ip, port), timeout=timeout) as s:
            s.sendall(data)
        return True, f"Sent {safe_name} ({len(data):,} bytes) to {target_ip}:{port}"
    except Exception as exc:
        return False, f"Connection to elfldr at {target_ip}:{port} failed ({exc})"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, format, *args):
        sys.stdout.write(f"[{self.log_date_time_string()}] {format % args}\n")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/payloads":
            files = [f.name for f in sorted(PAYLOAD_DIR.glob("*.elf")) if f.is_file()]
            resp = json.dumps({"payloads": files}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        if self.path == "/api/probe":
            target_ip = self.client_address[0]
            if target_ip in ("127.0.0.1", "::1", "localhost"):
                target_ip = local_ip()
            alive = False
            try:
                with socket.create_connection((target_ip, 9021), timeout=1.2):
                    alive = True
            except Exception:
                alive = False
            resp = json.dumps({"online": alive, "target": target_ip}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        super().do_GET()

    def do_POST(self):
        if self.path == "/api/send-payload":
            content_length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
            try:
                body = json.loads(raw_body)
            except Exception:
                body = {}

            payload = body.get("payload", "")
            target_ip = body.get("target_ip") or self.client_address[0]
            if target_ip in ("127.0.0.1", "::1", "localhost"):
                target_ip = local_ip()

            ok, msg = send_elf_to_ps5(target_ip, payload)

            resp = json.dumps({"ok": ok, "message": msg, "target": target_ip}).encode("utf-8")
            self.send_response(200 if ok else 400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        self.send_error(404, "Endpoint not found")

if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "--send":
        target = sys.argv[2]
        file_name = sys.argv[3]
        print(f"[*] Sending '{file_name}' to {target}:9021...")
        ok, msg = send_elf_to_ps5(target, file_name)
        print(("[+] " if ok else "[-] ") + msg)
        sys.exit(0 if ok else 1)

    ip = local_ip()
    print("==================================================")
    print("      LONELY — PS5 EXPLOIT & PAYLOAD HOST         ")
    print("==================================================")
    print(f"[*] Local Host URL : http://{ip}:{PORT}/")
    print(f"[*] Payloads Dir   : {PAYLOAD_DIR}")
    payloads = [f.name for f in sorted(PAYLOAD_DIR.glob("*.elf")) if f.is_file()]
    print(f"[*] Ready Payloads : {', '.join(payloads) if payloads else 'None'}")
    print("==================================================")
    print("[*] Server is running. Press Ctrl+C to stop.\n")

    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler) as server:
        server.serve_forever()
