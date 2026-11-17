import unittest

from tests.release import load

sbom = load("sbom")

LOCK = (
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


class Sbom(unittest.TestCase):
    def test_lists_each_locked_package_once_without_peer_suffixes(self):
        self.assertEqual(
            sbom.packages_from_lockfile(LOCK),
            [("@tanstack/react-query", "5.104.0"), ("react", "19.3.0"), ("zustand", "5.0.15")],
        )

    def test_names_the_console_with_the_fields_attest_sbom_requires(self):
        bom = sbom.bom_from_packages(sbom.packages_from_lockfile(LOCK), "0.2.0")
        self.assertEqual(bom["bomFormat"], "CycloneDX")
        self.assertEqual(bom["specVersion"], "1.5")
        self.assertRegex(bom["serialNumber"], sbom.SERIAL_NUMBER)
        self.assertEqual(
            bom["metadata"]["component"],
            {
                "type": "application",
                "bom-ref": "pkg:npm/tenkai-console@0.2.0",
                "name": "tenkai-console",
                "version": "0.2.0",
                "purl": "pkg:npm/tenkai-console@0.2.0",
            },
        )
        scoped = next(c for c in bom["components"] if c["name"] == "@tanstack/react-query")
        self.assertEqual(scoped["purl"], "pkg:npm/%40tanstack/react-query@5.104.0")

    def test_serial_number_is_unique_per_bom(self):
        self.assertNotEqual(
            sbom.bom_from_packages([], "0.2.0")["serialNumber"],
            sbom.bom_from_packages([], "0.2.0")["serialNumber"],
        )


if __name__ == "__main__":
    unittest.main()
