"""log — centralized logging for miztoyaml.

Three verbosity levels controlled via ``setup_logging()``:

* **quiet** (default) – only warnings and errors (``WARNING``).
* **debug** (``--debug``) – informational progress messages (``INFO``).
* **verbose** (``--verbose`` / ``-v``) – full diagnostic detail (``DEBUG``).

All output is written to *stderr* so it is visible in Docker containers via
``docker compose logs`` while keeping *stdout* clean for pipeline use.
"""

from __future__ import annotations

import logging
import sys

# Package-wide logger — every module should do:
#   from .log import log
#   log.info("message")
log: logging.Logger = logging.getLogger("miztoyaml")


def setup_logging(*, quiet: bool = True, debug: bool = False, verbose: bool = False) -> None:
    """Configure the *miztoyaml* logger.

    Parameters
    ----------
    quiet : bool
        Default mode — only warnings/errors.
    debug : bool
        Show informational progress messages (``INFO``).
    verbose : bool
        Show everything including ``DEBUG`` diagnostics.

    ``verbose`` takes precedence over ``debug``; ``debug`` takes precedence
    over ``quiet``.
    """
    if verbose:
        level = logging.DEBUG
    elif debug:
        level = logging.INFO
    else:
        level = logging.WARNING

    log.setLevel(level)

    # Avoid duplicate handlers when called more than once (e.g. in tests)
    if not log.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setLevel(level)
        fmt = logging.Formatter("[%(levelname)s] %(message)s")
        handler.setFormatter(fmt)
        log.addHandler(handler)
    else:
        for h in log.handlers:
            h.setLevel(level)
