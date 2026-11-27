# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
from collections.abc import Iterator

import psycopg
import pytest
from testcontainers.community.postgres import PostgresContainer

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def postgres() -> Iterator[PostgresContainer]:
    with PostgresContainer("postgres:18-alpine", driver=None) as container:
        yield container


def test_round_trips_a_row_through_postgres(postgres: PostgresContainer) -> None:
    with psycopg.connect(postgres.get_connection_url()) as connection:
        connection.execute("CREATE TABLE greetings (message text NOT NULL)")
        connection.execute("INSERT INTO greetings (message) VALUES (%s)", ("Hello, Scout!",))
        row = connection.execute("SELECT message FROM greetings").fetchone()

    assert row == ("Hello, Scout!",)
