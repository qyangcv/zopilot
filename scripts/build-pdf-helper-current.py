#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import platform as platform_module
from pathlib import Path

from pdf_helper_build_config import current_host_platform


def main() -> int:
    platform = current_host_platform()
    if not platform:
        raise SystemExit(
            "Unsupported PDF helper build host: "
            f"{platform_module.system().lower()}/{platform_module.machine().lower()}"
        )
    script = Path(__file__).with_name("build-pdf-helper.py")
    return subprocess.run(
        [sys.executable, str(script), "--platform", platform],
        check=False,
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
