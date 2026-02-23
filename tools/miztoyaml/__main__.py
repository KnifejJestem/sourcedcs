"""Allow `python3 tools/miztoyaml <args>` and `python3 -m tools.miztoyaml <args>`."""
import sys
import os

# When invoked as `python3 tools/miztoyaml`, Python sets __package__ to ''.
# Insert the parent (tools/) dir so that `import miztoyaml` resolves correctly.
_pkg_parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _pkg_parent not in sys.path:
    sys.path.insert(0, _pkg_parent)

from miztoyaml.extract import main

if __name__ == "__main__":
    main()
