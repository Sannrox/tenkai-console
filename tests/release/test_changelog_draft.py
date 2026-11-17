"""changelog-draft.sh against a scratch repository and its origin."""

import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

from tests.release import ROOT

SCRIPT = ROOT / "scripts" / "changelog-draft.sh"


class ChangelogDraft(unittest.TestCase):
    def test_starts_at_the_last_final_tag_not_a_release_candidate(self):
        tmp = pathlib.Path(tempfile.mkdtemp(prefix=f"draft{os.getpid()}-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        origin, work = tmp / "origin.git", tmp / "w"
        git = lambda *a, cwd=work: subprocess.run(
            ["git", *a], cwd=cwd, check=True, capture_output=True, text=True
        ).stdout
        git("init", "-q", "--bare", "-b", "main", str(origin), cwd=tmp)
        git("init", "-q", "-b", "main", str(work), cwd=tmp)
        for k, v in {"user.name": "t", "user.email": "t@example.invalid",
                     "commit.gpgsign": "false", "tag.gpgSign": "false"}.items():
            git("config", k, v)
        git("remote", "add", "origin", str(origin))
        (work / "scripts").mkdir()
        shutil.copy(SCRIPT, work / "scripts" / "changelog-draft.sh")
        for subject, tag in (("chore: release 0.1.0", "v0.1.0"), ("feat: in the rc", "v0.2.0-rc.1"),
                             ("fix: after the rc", None)):
            git("commit", "-q", "--allow-empty", "-m", subject)
            if tag:
                git("tag", "-a", tag, "-m", tag)
        git("push", "-q", "origin", "main", "--tags")
        draft = subprocess.run(
            ["bash", str(work / "scripts" / "changelog-draft.sh")], capture_output=True, text=True,
        )
        self.assertEqual(draft.returncode, 0, draft.stderr)
        self.assertEqual(
            draft.stdout.splitlines(),
            ["## Unreleased (since v0.1.0)", "", "- fix: after the rc", "- feat: in the rc"],
        )


if __name__ == "__main__":
    unittest.main()
