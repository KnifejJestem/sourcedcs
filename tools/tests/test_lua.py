"""Tests for miztoyaml.lua — Lua table text helpers."""

import pytest

from tools.miztoyaml.lua import (
    lua_block_end,
    lua_bool,
    lua_get_block,
    lua_iter_array,
    lua_num,
    lua_num_map,
    lua_str,
    lua_xy,
)


class TestLuaBlockEnd:
    def test_simple_block(self):
        text = "{abc}"
        assert lua_block_end(text, 0) == 4

    def test_nested_blocks(self):
        text = "{{inner}}"
        assert lua_block_end(text, 0) == 8

    def test_deeply_nested(self):
        text = "{a{b{c}}}"
        assert lua_block_end(text, 0) == 8

    def test_no_closing(self):
        text = "{open"
        # Falls off end → returns len-1
        assert lua_block_end(text, 0) == len(text) - 1


class TestLuaGetBlock:
    def test_found(self):
        text = '["foo"] = { bar }'
        assert lua_get_block(text, "foo") == " bar "

    def test_not_found(self):
        assert lua_get_block("nothing", "foo") is None

    def test_nested_key(self):
        text = '["outer"] = { ["inner"] = { val } }'
        outer = lua_get_block(text, "outer")
        assert outer is not None
        inner = lua_get_block(outer, "inner")
        assert inner is not None
        assert "val" in inner

    def test_special_chars_in_key(self):
        text = '["name.with.dots"] = { value }'
        assert lua_get_block(text, "name.with.dots") is not None


class TestLuaIterArray:
    def test_basic(self):
        text = '[1] = { a }, [2] = { b }'
        items = list(lua_iter_array(text))
        assert len(items) == 2
        assert items[0][0] == 1
        assert 'a' in items[0][1]
        assert items[1][0] == 2

    def test_empty(self):
        assert list(lua_iter_array("nothing")) == []

    def test_nested_ignored(self):
        text = '[1] = { [99] = { inner } }'
        items = list(lua_iter_array(text))
        assert len(items) == 1
        assert items[0][0] == 1
        assert "inner" in items[0][1]


class TestLuaStr:
    def test_found(self):
        assert lua_str('["name"] = "hello"', "name") == "hello"

    def test_not_found(self):
        assert lua_str('["other"] = "val"', "name") is None

    def test_empty_string(self):
        assert lua_str('["x"] = ""', "x") == ""


class TestLuaNum:
    def test_integer(self):
        assert lua_num('["x"] = 42', "x") == 42.0

    def test_float(self):
        assert lua_num('["y"] = 3.14', "y") == pytest.approx(3.14)

    def test_scientific(self):
        assert lua_num('["z"] = 1e6', "z") == pytest.approx(1e6)

    def test_negative(self):
        assert lua_num('["n"] = -5.5', "n") == pytest.approx(-5.5)

    def test_not_found(self):
        assert lua_num('["a"] = 1', "b") is None


class TestLuaBool:
    def test_true(self):
        assert lua_bool('["flag"] = true', "flag") is True

    def test_false(self):
        assert lua_bool('["flag"] = false', "flag") is False

    def test_not_found(self):
        assert lua_bool('["x"] = 1', "flag") is False


class TestLuaNumMap:
    def test_basic(self):
        text = "[1] = 100.0, [2] = 200.0,"
        result = lua_num_map(text)
        assert result == {1: 100.0, 2: 200.0}

    def test_empty(self):
        assert lua_num_map("nothing here") == {}


class TestLuaXy:
    def test_found(self):
        text = '["x"] = 10.0, ["y"] = 20.0'
        result = lua_xy(text)
        assert result == (10.0, 20.0)

    def test_missing_x(self):
        assert lua_xy('["y"] = 20.0') is None

    def test_missing_y(self):
        assert lua_xy('["x"] = 10.0') is None

    def test_missing_both(self):
        assert lua_xy("nothing") is None
