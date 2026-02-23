"""lua — brace-balanced helpers for Lua table text."""

from __future__ import annotations

import re
from typing import Iterator


def lua_block_end(text: str, open_pos: int) -> int:
    """Return index of the '}' that closes the '{' at open_pos."""
    depth = 0
    for i in range(open_pos, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return i
    return len(text) - 1


def lua_get_block(text: str, key: str) -> str | None:
    """Return inner text of  ["key"] = { ... }  (brace-balanced)."""
    m = re.search(rf'\["{re.escape(key)}"\]\s*=\s*\{{', text)
    if not m:
        return None
    close = lua_block_end(text, m.end() - 1)
    return text[m.end() : close]


def lua_iter_array(text: str) -> Iterator[tuple[int, str]]:
    """
    Yield (index, inner_text) for every  [N] = { ... }  entry at the
    TOP level of text.  Nested arrays inside those blocks are skipped.
    """
    pattern = re.compile(r'\[(\d+)\]\s*=\s*\n?\s*\{')
    pos = 0
    while pos < len(text):
        m = pattern.search(text, pos)
        if not m:
            break
        open_pos = m.end() - 1
        close_pos = lua_block_end(text, open_pos)
        yield int(m.group(1)), text[open_pos + 1 : close_pos]
        pos = close_pos + 1


def lua_str(text: str, key: str) -> str | None:
    m = re.search(rf'\["{re.escape(key)}"\]\s*=\s*"([^"]*)"', text)
    return m.group(1) if m else None


def lua_num(text: str, key: str) -> float | None:
    m = re.search(rf'\["{re.escape(key)}"\]\s*=\s*([0-9eE.+\-]+)', text)
    return float(m.group(1)) if m else None


def lua_bool(text: str, key: str) -> bool:
    m = re.search(rf'\["{re.escape(key)}"\]\s*=\s*(true|false)', text)
    return m.group(1) == 'true' if m else False


def lua_xy(text: str) -> tuple[float, float] | None:
    x, y = lua_num(text, 'x'), lua_num(text, 'y')
    return (x, y) if (x is not None and y is not None) else None
