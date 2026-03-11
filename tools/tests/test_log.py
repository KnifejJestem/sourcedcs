"""Tests for miztoyaml.log — centralized logging configuration."""

import logging

import pytest

from tools.miztoyaml.log import log, setup_logging


@pytest.fixture(autouse=True)
def _reset_logger():
    """Remove all handlers so every test starts clean."""
    log.handlers.clear()
    log.setLevel(logging.WARNING)
    yield
    log.handlers.clear()
    log.setLevel(logging.WARNING)


class TestSetupLogging:
    """setup_logging() should configure the package-wide logger."""

    def test_default_quiet_mode(self):
        setup_logging()
        assert log.level == logging.WARNING

    def test_debug_mode(self):
        setup_logging(debug=True)
        assert log.level == logging.INFO

    def test_verbose_mode(self):
        setup_logging(verbose=True)
        assert log.level == logging.DEBUG

    def test_verbose_overrides_debug(self):
        setup_logging(debug=True, verbose=True)
        assert log.level == logging.DEBUG

    def test_handler_created(self):
        setup_logging()
        assert len(log.handlers) == 1
        assert isinstance(log.handlers[0], logging.StreamHandler)

    def test_no_duplicate_handlers(self):
        setup_logging()
        setup_logging(debug=True)
        assert len(log.handlers) == 1

    def test_handler_level_updated(self):
        setup_logging()
        assert log.handlers[0].level == logging.WARNING
        setup_logging(verbose=True)
        assert log.handlers[0].level == logging.DEBUG

    def test_log_name(self):
        assert log.name == "miztoyaml"

    def test_quiet_suppresses_info(self, capsys):
        setup_logging()
        log.info("should not appear")
        captured = capsys.readouterr()
        assert "should not appear" not in captured.err
        assert "should not appear" not in captured.out

    def test_debug_shows_info(self, capsys):
        setup_logging(debug=True)
        log.info("visible info")
        captured = capsys.readouterr()
        assert "visible info" in captured.err

    def test_verbose_shows_debug(self, capsys):
        setup_logging(verbose=True)
        log.debug("verbose detail")
        captured = capsys.readouterr()
        assert "verbose detail" in captured.err
