# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0


class BlankNameError(ValueError):
    def __init__(self) -> None:
        super().__init__("name must not be blank")


def greet(name: str) -> str:
    """Return the greeting for ``name`` without surrounding whitespace; raise BlankNameError if it is blank."""
    trimmed = name.strip()
    if not trimmed:
        raise BlankNameError
    return f"Hello, {trimmed}!"
