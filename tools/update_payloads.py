#!/usr/bin/env python3
"""Payload updater for Relapse-Exploit host.

Fetches the latest PS5 ELF payloads from GitHub releases and stores them
under payloads/ with stable names.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.request

API = "https://api.github.com"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAYLOAD_DIR = os.path.join(ROOT, "payloads")
MANIFEST = os.path.join(PAYLOAD_DIR, "manifest.json")

SOURCES = [
    {
        "file": "zftpd-ps5.elf",
        "repo": "seregonwar/zftpd",
        "match": re.compile(r"^zftpd-ps5-v[0-9][\w.-]*\.elf$"),
        "exclude": "-zhttp",
        "desc": "zftpd FTP server (Port 21 / 1337)",
    },
    {
        "file": "MemDBG-ps5.elf",
        "repo": "seregonwar/MemDBG",
        "match": re.compile(r"^MemDBG-ps5\.elf$"),
        "desc": "MemDBG memory debugger & trainer daemon",
    },
]

def http_json(url, headers=None):
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "ps5-payload-updater",
        **(headers or {}),
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def latest_release(repo):
    url = f"{API}/repos/{repo}/releases/latest"
    token = os.environ.get("GITHUB_TOKEN")
    headers = {"Authorization": f"Bearer {token}"} if token else None
    return http_json(url, headers)

def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "ps5-payload-updater"})
    tmp = dest + ".part"
    with urllib.request.urlopen(req, timeout=120) as resp:
        with open(tmp, "wb") as fh:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                fh.write(chunk)
    with open(tmp, "rb") as fh:
        if fh.read(4) != b"\x7fELF":
            os.remove(tmp)
            raise ValueError("downloaded file is not an ELF")
    os.replace(tmp, dest)

def main():
    os.makedirs(PAYLOAD_DIR, exist_ok=True)
    print(f"[*] Checking for latest payload releases...")
    for src in SOURCES:
        file = src["file"]
        dest = os.path.join(PAYLOAD_DIR, file)
        try:
            rel = latest_release(src["repo"])
            tag = rel.get("tag_name", "")
            asset = next((a for a in rel.get("assets", [])
                          if src["match"].match(a.get("name", ""))
                          and (not src.get("exclude") or src["exclude"] not in a.get("name", ""))), None)
            if not asset:
                print(f"[!] {file}: no matching asset in {src['repo']} ({tag})")
                continue
            print(f"[>] Downloading {file} ({tag})...")
            download(asset["browser_download_url"], dest)
            print(f"[+] {file} updated ({os.path.getsize(dest):,} bytes)")
        except Exception as exc:
            print(f"[!] {file}: update failed ({exc})")

if __name__ == "__main__":
    main()
