import json
import pathlib
import tempfile
import unittest

from tests.release import load

manifest = load("manifest")


class GateFlags(unittest.TestCase):
    def test_maps_gate_labels_and_ignores_others(self):
        flags = manifest.gate_flags_from_labels(
            ["risk:breaking", "area:ops", "GATE:mig", "risk:realm", "docs"]
        )
        self.assertEqual(flags, ["breaking", "migration", "realm"])

    def test_only_pull_requests_merged_into_the_release_range_count(self):
        merged = "\n".join(
            [
                "aaa\trisk:breaking",  # in range
                "bbb\tgate:mig",  # merged after the release commit
                "ccc\trisk:realm",  # before the previous final tag
                "aaa\tdocs",
                "malformed line",
            ]
        )
        self.assertEqual(
            manifest.labels_in_range(merged, "aaa\nddd\n"), ["docs", "risk:breaking"]
        )


class BuildManifest(unittest.TestCase):
    def test_refuses_a_short_git_sha(self):
        with self.assertRaisesRegex(SystemExit, "full lowercase SHA"):
            manifest.build_manifest(
                component="tenkai-console", version="0.2.0", git_sha="deadbeef", tag="v0.2.0",
                dist=pathlib.Path("."), images=[], attestations=[], gate_flags=[],
            )

    def test_lists_only_the_release_zip_by_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = pathlib.Path(tmp)
            (dist / "tenkai-console-v0.2.0.zip").write_bytes(b"zip")
            for name in ("SHA256SUMS", "tenkai-console-release.json", "tenkai-console.cdx.json", "RELEASE_NOTES.md"):
                (dist / name).write_text("{}\n")
            doc = manifest.build_manifest(
                component="tenkai-console", version="0.2.0", git_sha="a" * 40, tag="v0.2.0",
                dist=dist, images=[], attestations=[], gate_flags=["breaking"],
            )
        self.assertEqual(doc["schema"], "tenkai.family-release-manifest.v1")
        self.assertEqual([b["name"] for b in doc["binaries"]], ["tenkai-console-v0.2.0.zip"])
        self.assertTrue(doc["binaries"][0]["digest"].startswith("sha256:"))
        self.assertEqual(doc["images"], [])

    def test_record_attestations_drops_empty_urls(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "m.json"
            path.write_text(json.dumps({"attestations": [], "component": "tenkai-console"}))
            manifest.main(["record-attestations", str(path), "https://example.invalid/1", ""])
            doc = json.loads(path.read_text())
        self.assertEqual(doc["attestations"], ["https://example.invalid/1"])
        self.assertEqual(doc["component"], "tenkai-console")


if __name__ == "__main__":
    unittest.main()
