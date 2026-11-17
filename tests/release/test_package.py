"""package.sh dry runs against this checkout and against a scratch repository."""

import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

from tests.release import RELEASE, ROOT, load

SCRIPT = RELEASE / "package.sh"
notes = load("notes")


def fake_gh(bin_dir: pathlib.Path, body: str) -> dict:
    """Put a `gh` running `body` first on PATH; return the environment."""
    bin_dir.mkdir()
    (bin_dir / "gh").write_text("#!/usr/bin/env bash\n" + body)
    (bin_dir / "gh").chmod(0o755)
    return {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}


class Package(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix=f"pkg{os.getpid()}-")
        self.addCleanup(tmp.cleanup)
        self.tmp = pathlib.Path(tmp.name)
        self.out = self.tmp / "release"
        self.sha = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
        ).stdout.strip()
        self.version = json.loads((ROOT / "package.json").read_text())["version"]

    def package(self, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(SCRIPT), "--out", str(self.out), "--skip-build", "--skip-test",
             "--git-sha", self.sha, *args],
            env=env or os.environ, capture_output=True, text=True,
        )

    def test_dry_run_writes_manifest_sbom_and_checksums_without_latest(self):
        self.out.mkdir()
        (self.out / f"tenkai-console-v{self.version}.zip").write_bytes(b"zip")
        result = self.package("--skip-github")
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.out / "tenkai-console-release.json").read_text())
        self.assertEqual(manifest["schema"], "tenkai.family-release-manifest.v1")
        self.assertEqual(manifest["component"], "tenkai-console")
        self.assertEqual(manifest["git_sha"], self.sha)
        self.assertEqual([b["name"] for b in manifest["binaries"]], [f"tenkai-console-v{self.version}.zip"])
        self.assertEqual(manifest["images"], [])
        self.assertNotIn("latest", json.dumps(manifest))
        bom = json.loads((self.out / "tenkai-console.cdx.json").read_text())
        self.assertEqual((bom["bomFormat"], bom["specVersion"]), ("CycloneDX", "1.5"))
        self.assertIn(f"tenkai-console-v{self.version}.zip", (self.out / "SHA256SUMS").read_text())

    def test_tagged_run_writes_notes_from_the_changelog_section(self):
        result = self.package("--skip-github", "--tag", f"v{self.version}")
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = notes.notes_for((ROOT / "CHANGELOG.md").read_text(), self.version)
        self.assertEqual((self.out / "RELEASE_NOTES.md").read_text().strip(), expected)
        manifest = json.loads((self.out / "tenkai-console-release.json").read_text())
        self.assertEqual((manifest["version"], manifest["tag"]), (self.version, f"v{self.version}"))

    def test_tag_must_match_the_workspace_version(self):
        result = self.package("--skip-github", "--tag", "v999.0.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not match workspace version", result.stderr)

    def test_tagged_run_fails_closed_when_gate_flags_cannot_be_read(self):
        # Empty gate flags would read as a release that passed no gates.
        env = fake_gh(self.tmp / "bin", "echo 'HTTP 403' >&2\nexit 1\n")
        result = self.package("--tag", f"v{self.version}", env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cannot list merged pull requests", result.stderr)
        self.assertFalse((self.out / "tenkai-console-release.json").exists())


class GateFlagRange(unittest.TestCase):
    """Gate flags come only from pull requests merged since the last final tag, up to the release commit."""

    def test_counts_release_candidates_and_never_later_or_earlier_merges(self):
        tmp = pathlib.Path(tempfile.mkdtemp(prefix=f"gates{os.getpid()}-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        work = tmp / "w"
        (work / "scripts").mkdir(parents=True)
        shutil.copytree(RELEASE, work / "scripts" / "release")
        (work / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\npackages:\n")
        (work / "CHANGELOG.md").write_text("# Changelog\n\n## [0.2.0]\n\n- notes\n")
        git = lambda *a: subprocess.run(
            ["git", "-C", str(work), *a], check=True, capture_output=True, text=True
        ).stdout.strip()
        git("init", "-q")
        for k, v in {"user.name": "t", "user.email": "t@example.invalid",
                     "commit.gpgsign": "false", "tag.gpgSign": "false"}.items():
            git("config", k, v)
        commits = {}
        for name, version, tag in (("final", "0.1.0", "v0.1.0"), ("rc", "0.2.0-rc.1", "v0.2.0-rc.1"),
                                   ("release", "0.2.0", None), ("later", "0.2.0", None)):
            (work / "package.json").write_text(json.dumps({"name": "tenkai-console", "version": version}))
            (work / name).write_text(name)
            git("add", "-A")
            git("commit", "-q", "-m", name)
            commits[name] = git("rev-parse", "HEAD")
            if tag:
                git("tag", "-a", tag, "-m", tag)
        merged = "".join(
            f"{commits[name]}\t{label}\\n"
            for name, label in (("final", "risk:realm"), ("rc", "risk:breaking"),
                                ("release", "gate:mig"), ("later", "risk:realm"))
        )
        env = fake_gh(tmp / "bin", f"printf '{merged}'\n")
        result = subprocess.run(
            ["bash", str(work / "scripts" / "release" / "package.sh"), "--out", str(tmp / "out"),
             "--skip-build", "--skip-test", "--tag", "v0.2.0", "--git-sha", commits["release"]],
            env=env, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((tmp / "out" / "tenkai-console-release.json").read_text())
        self.assertEqual(manifest["gate_flags"], ["breaking", "migration"])


if __name__ == "__main__":
    unittest.main()
