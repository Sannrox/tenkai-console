#!/usr/bin/env python3
"""Write a CycloneDX 1.5 SBOM from pnpm-lock.yaml packages."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

COMPONENT = "tenkai-console"
PACKAGE_HEAD = re.compile(r"^ {2}(?:'([^']+)'|([^:\s]+)):$")


def workspace_version(root: Path) -> str:
    data = json.loads((root / "package.json").read_text())
    version = data.get("version")
    if not version:
        raise SystemExit("package.json has no version")
    return version


def split_name_version(key: str) -> tuple[str, str] | None:
    key = key.split("(", 1)[0]
    if key.startswith("@"):
        rest = key[1:]
        if "/" not in rest:
            return None
        name_part, _, version = rest.rpartition("@")
        if not name_part or not version or "/" not in name_part:
            return None
        return "@" + name_part, version
    if "@" not in key:
        return None
    name, version = key.rsplit("@", 1)
    if not name or not version:
        return None
    return name, version


def npm_purl(name: str, version: str) -> str:
    if name.startswith("@"):
        scope, pkg = name[1:].split("/", 1)
        return f"pkg:npm/%40{scope}/{pkg}@{version}"
    return f"pkg:npm/{name}@{version}"


def packages_from_lockfile(text: str) -> list[tuple[str, str]]:
    in_packages = False
    seen: dict[tuple[str, str], None] = {}
    for line in text.splitlines():
        if line == "packages:":
            in_packages = True
            continue
        if in_packages and line and not line.startswith(" ") and line.endswith(":"):
            break
        if not in_packages:
            continue
        match = PACKAGE_HEAD.match(line)
        if not match:
            continue
        parsed = split_name_version(match.group(1) or match.group(2))
        if parsed is None:
            continue
        seen[parsed] = None
    return sorted(seen)


def bom_from_packages(packages: list[tuple[str, str]], version: str) -> dict:
    components = []
    for name, pkg_version in packages:
        purl = npm_purl(name, pkg_version)
        components.append(
            {
                "type": "library",
                "bom-ref": purl,
                "name": name,
                "version": pkg_version,
                "purl": purl,
            }
        )
    root_purl = f"pkg:npm/{COMPONENT}@{version}"
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "bom-ref": root_purl,
                "name": COMPONENT,
                "version": version,
                "purl": root_purl,
            }
        },
        "components": components,
    }


def self_test() -> None:
    lock = (
        "lockfileVersion: '9.0'\n"
        "importers:\n"
        "  .:\n"
        "    dependencies:\n"
        "      react:\n"
        "        specifier: ^19.3.0\n"
        "        version: 19.3.0\n"
        "packages:\n"
        "\n"
        "  '@tanstack/react-query@5.104.0':\n"
        "    resolution: {integrity: sha512-aaa}\n"
        "\n"
        "  react@19.3.0:\n"
        "    resolution: {integrity: sha512-bbb}\n"
        "\n"
        "  'zustand@5.0.15(react@19.3.0)':\n"
        "    resolution: {integrity: sha512-ccc}\n"
        "\n"
        "snapshots:\n"
        "  react@19.3.0:\n"
        "    {}\n"
    )
    packages = packages_from_lockfile(lock)
    assert packages == [
        ("@tanstack/react-query", "5.104.0"),
        ("react", "19.3.0"),
        ("zustand", "5.0.15"),
    ], packages
    bom = bom_from_packages(packages, "0.2.0")
    assert bom["bomFormat"] == "CycloneDX"
    assert bom["metadata"]["component"]["name"] == "tenkai-console"
    assert bom["metadata"]["component"]["version"] == "0.2.0"
    assert bom["metadata"]["component"]["type"] == "application"
    names = {item["name"] for item in bom["components"]}
    assert names == {"@tanstack/react-query", "react", "zustand"}, names
    scoped = next(item for item in bom["components"] if item["name"] == "@tanstack/react-query")
    assert scoped["purl"] == "pkg:npm/%40tanstack/react-query@5.104.0", scoped
    print("release-sbom self-test passed")


def main(argv: list[str]) -> None:
    if argv == ["--self-test"]:
        self_test()
        return
    if len(argv) != 1:
        raise SystemExit("usage: release-sbom.py OUT")
    root = Path(__file__).resolve().parent.parent
    lock = (root / "pnpm-lock.yaml").read_text()
    bom = bom_from_packages(packages_from_lockfile(lock), workspace_version(root))
    out = Path(argv[0])
    out.write_text(json.dumps(bom, indent=2) + "\n")
    print(out)


if __name__ == "__main__":
    main(sys.argv[1:])
