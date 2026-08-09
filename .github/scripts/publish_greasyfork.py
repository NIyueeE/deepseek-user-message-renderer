#!/usr/bin/env python3
"""Publish the userscript to GreasyFork by importing it from a raw GitHub URL.

GreasyFork has no official publishing API, so this script mirrors the
login-based approach used by the community: sign in with the account
credentials (TOTP-aware) and submit the raw script URL to the import page.
Importing the same URL again updates the existing script.

Requires the GitHub Actions secrets:
  GFU                      GreasyFork account email
  GFP                      GreasyFork account password
  GREASYFORK_TOTP_SECRET   base32 TOTP secret (only if 2FA is enabled)

Uses only the Python standard library.
"""

import base64
import hashlib
import hmac
import http.cookiejar
import os
import re
import struct
import sys
import time
import urllib.parse
import urllib.request

GREASYFORK = "https://greasyfork.org"
SIGN_IN = f"{GREASYFORK}/zh-CN/users/sign_in"
IMPORT = f"{GREASYFORK}/zh-CN/import/add"


def totp(secret: str) -> str:
    """Return the current 6-digit TOTP code for a base32 secret."""
    key = base64.b32decode(secret.upper().replace(" ", ""))
    counter = struct.pack(">Q", int(time.time()) // 30)
    digest = hmac.new(key, counter, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{code:06d}"


class GreasyForkClient:
    def __init__(self) -> None:
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(jar),
            urllib.request.HTTPRedirectHandler(),
        )
        self.csrf: str | None = None

    def fetch_csrf(self) -> str:
        with self.opener.open(GREASYFORK, timeout=60) as resp:
            html = resp.read().decode("utf-8", "replace")
        match = re.search(r'<meta name="csrf-token" content="([^"]+)"', html)
        if not match:
            raise RuntimeError("Could not find the csrf-token meta tag on greasyfork.org")
        self.csrf = match.group(1)
        return self.csrf

    def post(self, url: str, data: dict[str, str]) -> str:
        body = urllib.parse.urlencode(data).encode()
        request = urllib.request.Request(url, data=body, method="POST")
        request.add_header("Content-Type", "application/x-www-form-urlencoded")
        request.add_header("Referer", GREASYFORK)
        request.add_header(
            "User-Agent",
            "deepseek-user-message-renderer release workflow",
        )
        with self.opener.open(request, timeout=120) as resp:
            return resp.read().decode("utf-8", "replace")

    def login(self, email: str, password: str, totp_code: str | None) -> None:
        if self.csrf is None:
            self.fetch_csrf()
        data = {
            "authenticity_token": self.csrf,
            "user[email]": email,
            "user[password]": password,
            "user[remember_me]": "1",
        }
        if totp_code:
            data["user[otp_attempt]"] = totp_code
        html = self.post(SIGN_IN, data)
        if "退出" not in html:
            raise RuntimeError("GreasyFork login failed: still on the sign-in page")
        self.fetch_csrf()

    def import_script(self, script_url: str) -> str:
        if self.csrf is None:
            self.fetch_csrf()
        html = self.post(
            IMPORT,
            {
                "authenticity_token": self.csrf,
                "sync_urls": script_url,
                "sync-type": "automatic",
                "commit": "导入",
            },
        )
        match = re.search(r"/scripts/(\d+)-", html)
        if not match:
            raise RuntimeError("GreasyFork import did not return a script id")
        return match.group(1)


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <raw-script-url>", file=sys.stderr)
        return 2
    email = os.environ.get("GFU", "")
    password = os.environ.get("GFP", "")
    totp_secret = os.environ.get("GREASYFORK_TOTP_SECRET", "")
    if not email or not password:
        print("GFU and GFP secrets are required", file=sys.stderr)
        return 2

    client = GreasyForkClient()
    client.fetch_csrf()
    client.login(email, password, totp(totp_secret) if totp_secret else None)
    script_id = client.import_script(sys.argv[1])
    print(f"Imported script to GreasyFork: {GREASYFORK}/scripts/{script_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
