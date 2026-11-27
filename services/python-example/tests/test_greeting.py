# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import pytest

from python_example.domain.greeting import BlankNameError, greet


def test_greets_by_trimmed_name() -> None:
    assert greet("  Scout ") == "Hello, Scout!"


def test_rejects_blank_name() -> None:
    with pytest.raises(BlankNameError):
        greet("   ")
