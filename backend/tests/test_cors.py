from __future__ import annotations

import unittest

from backend.app.main import app


async def _request(method: str, path: str, headers: list[tuple[bytes, bytes]]) -> dict:
    messages: list[dict] = []

    async def receive() -> dict:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict) -> None:
        messages.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "http_version": "1.1", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8000),
    }
    await app(scope, receive, send)

    start = next(message for message in messages if message["type"] == "http.response.start")
    response_headers = {
        key.decode("latin-1").lower(): value.decode("latin-1")
        for key, value in start["headers"]
    }
    return {"status": start["status"], "headers": response_headers}


class CorsTest(unittest.IsolatedAsyncioTestCase):
    async def test_local_frontend_origin_is_allowed(self) -> None:
        response = await _request(
            "GET",
            "/health",
            [(b"origin", b"http://localhost:5173")],
        )

        self.assertEqual(response["status"], 200)
        self.assertEqual(
            response["headers"]["access-control-allow-origin"],
            "http://localhost:5173",
        )

    async def test_post_preflight_includes_content_type(self) -> None:
        response = await _request(
            "OPTIONS",
            "/api/v1/job-fit",
            [
                (b"origin", b"http://127.0.0.1:3000"),
                (b"access-control-request-method", b"POST"),
                (b"access-control-request-headers", b"content-type"),
            ],
        )

        self.assertEqual(response["status"], 200)
        self.assertEqual(
            response["headers"]["access-control-allow-origin"],
            "http://127.0.0.1:3000",
        )
        # PUT 是 /profiles/{id}/personal-info 要用的，不能只放 GET/POST
        self.assertEqual(
            response["headers"]["access-control-allow-methods"],
            "GET, POST, PUT, OPTIONS",
        )
        allowed_headers = response["headers"]["access-control-allow-headers"].lower()
        self.assertIn("content-type", allowed_headers)

    async def test_put_preflight_allows_authorization(self) -> None:
        """改个人信息带 Bearer 令牌，预检必须放行 Authorization。"""

        response = await _request(
            "OPTIONS",
            "/api/v1/profiles/p1/personal-info",
            [
                (b"origin", b"http://localhost:5173"),
                (b"access-control-request-method", b"PUT"),
                (b"access-control-request-headers", b"authorization,content-type"),
            ],
        )

        self.assertEqual(response["status"], 200)
        allowed_headers = response["headers"]["access-control-allow-headers"].lower()
        self.assertIn("authorization", allowed_headers)
        self.assertIn("PUT", response["headers"]["access-control-allow-methods"])

    async def test_remote_origin_is_rejected(self) -> None:
        response = await _request(
            "GET",
            "/health",
            [(b"origin", b"https://untrusted.example")],
        )

        self.assertEqual(response["status"], 200)
        self.assertNotIn("access-control-allow-origin", response["headers"])


if __name__ == "__main__":
    unittest.main()
