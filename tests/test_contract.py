"""AAA schema and cross-document security contract tests."""

from __future__ import annotations

import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "reference"))

from validate_documents import AAAValidationError, confirmation_required, validate_pair  # noqa: E402


def fixture(profile: str) -> tuple[dict, dict]:
    base = ROOT / "examples" / ("well-known" if profile == "site" else "product-examples/settings-desktop")
    return (
        json.loads((base / "agents.json").read_text(encoding="utf-8")),
        json.loads((base / "ai-instructions.json").read_text(encoding="utf-8")),
    )


class AAAContractTest(unittest.TestCase):
    def test_schema_manifest_pins_exact_schema_bytes(self) -> None:
        manifest = json.loads((ROOT / "schemas" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual("0.1.1", manifest["document_profile"])
        self.assertEqual("sha256", manifest["hash_algorithm"])
        for name, expected in manifest["schemas"].items():
            with self.subTest(schema=name):
                actual = hashlib.sha256((ROOT / "schemas" / name).read_bytes()).hexdigest()
                self.assertEqual(expected, actual)

    def test_shipped_site_and_settings_pairs_validate(self) -> None:
        for profile in ("site", "settings"):
            with self.subTest(profile=profile):
                validate_pair(*fixture(profile))

    def test_settings_none_is_valid_and_mode_mismatch_is_denied(self) -> None:
        agents, instructions = fixture("settings")
        validate_pair(agents, instructions)
        agents["http_action_api"] = "declared"
        with self.assertRaises(AAAValidationError):
            validate_pair(agents, instructions)

    def test_duplicate_action_names_are_denied(self) -> None:
        agents, instructions = fixture("site")
        duplicate = copy.deepcopy(agents["endpoints"][0])
        duplicate["path"] = "/api/v1/agent-actions/other"
        agents["endpoints"].append(duplicate)
        with self.assertRaisesRegex(AAAValidationError, "duplicate AAA action ID"):
            validate_pair(agents, instructions)

    def test_action_outside_declared_root_is_denied(self) -> None:
        agents, instructions = fixture("site")
        agents["endpoints"][1]["path"] = "/api/v1/other/task"
        with self.assertRaisesRegex(AAAValidationError, "outside action_root"):
            validate_pair(agents, instructions)

    def test_encoded_action_separator_is_denied(self) -> None:
        agents, instructions = fixture("site")
        agents["endpoints"][1]["path"] = "/api/v1/agent-actions%2ftask"
        with self.assertRaisesRegex(AAAValidationError, "canonical paths"):
            validate_pair(agents, instructions)

    def test_extra_security_relevant_fields_are_denied(self) -> None:
        agents, instructions = fixture("site")
        agents["agent_card"]["endpoints"]["alternate_action_root"] = "/admin"
        with self.assertRaises(AAAValidationError):
            validate_pair(agents, instructions)

    def test_live_requires_active_on_both_documents(self) -> None:
        agents, instructions = fixture("site")
        agents["live"] = True
        instructions["live"] = True
        with self.assertRaisesRegex(AAAValidationError, "active status"):
            validate_pair(agents, instructions)

    def test_settings_action_must_name_its_documented_anchor(self) -> None:
        agents, instructions = fixture("settings")
        instructions["settings_actions"][0]["href"] = "app://settings?id=connectors"
        with self.assertRaisesRegex(AAAValidationError, "outside a documented anchor"):
            validate_pair(agents, instructions)

    def test_autonomy_false_requires_confirmation_for_every_action(self) -> None:
        agents, instructions = fixture("site")
        action = agents["endpoints"][1]
        instructions["policy"]["require_human_approval_for"] = []
        instructions["safety"]["require_human_confirmation_for"] = []
        instructions["policy"]["allow_autonomous_execution"] = False
        self.assertTrue(confirmation_required(action, instructions))
        self.assertTrue(confirmation_required(agents["endpoints"][0], instructions))

    def test_explicit_confirmation_covers_read_action(self) -> None:
        agents, instructions = fixture("site")
        instructions["safety"]["require_human_confirmation_for"] = ["get_status"]
        self.assertTrue(confirmation_required(agents["endpoints"][0], instructions))


if __name__ == "__main__":
    unittest.main()
