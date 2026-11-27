# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
from fastapi.testclient import TestClient

from python_example.api.app import app

client = TestClient(app)


def test_returns_greeting() -> None:
    response = client.get("/greetings/Scout")

    assert response.status_code == 200
    assert response.json() == {"message": "Hello, Scout!"}


def test_blank_name_is_unprocessable() -> None:
    response = client.get("/greetings/%20")

    assert response.status_code == 422
