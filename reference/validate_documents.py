"""Validate AAA/0.1.1 documents and their cross-document action semantics.

The schemas validate individual objects. This reference profile also checks
properties that JSON Schema cannot express across array members or files.
It does not authenticate a host or grant authority to execute an action.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator, FormatChecker


ROOT = Path(__file__).resolve().parents[1]


class AAAValidationError(ValueError):
    """A document pair violates the AAA discovery profile."""


def _schema(name: str) -> dict:
    return json.loads((ROOT / "schemas" / name).read_text(encoding="utf-8"))


def _validate_shape(document: dict, schema_name: str) -> None:
    schema = _schema(schema_name)
    Draft202012Validator.check_schema(schema)
    errors = sorted(
        Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(document),
        key=lambda error: (tuple(str(part) for part in error.path), error.message),
    )
    if errors:
        error = errors[0]
        location = "/".join(str(part) for part in error.path) or "<root>"
        raise AAAValidationError(f"{schema_name}:{location}: {error.message}")


def _surface(value: str) -> tuple[tuple[str, str, int] | None, str]:
    """Return a canonical HTTPS origin and path, or a same-origin relative path."""
    if "%" in value or "\\" in value:
        raise AAAValidationError("action URLs must use canonical paths without encoded or backslash separators")
    parsed = urlsplit(value)
    if parsed.query or parsed.fragment:
        raise AAAValidationError("action URLs cannot contain a query or fragment; pass arguments separately")
    if parsed.scheme:
        if parsed.scheme != "https" or parsed.username or parsed.password or not parsed.hostname:
            raise AAAValidationError("absolute action URLs must use HTTPS without userinfo")
        try:
            port = parsed.port or 443
        except ValueError as error:
            raise AAAValidationError("action URL has an invalid port") from error
        origin = (parsed.scheme, parsed.hostname.lower(), port)
    else:
        if parsed.netloc or not value.startswith("/") or value.startswith("//"):
            raise AAAValidationError("relative action URLs must start with one slash")
        origin = None
    path = parsed.path or "/"
    if "//" in path or any(part in {".", ".."} for part in path.split("/")):
        raise AAAValidationError("action URLs cannot contain empty or dot path segments")
    return origin, path.rstrip("/") or "/"


def _under_root(root: str, endpoint: str) -> bool:
    root_origin, root_path = _surface(root)
    endpoint_origin, endpoint_path = _surface(endpoint)
    if root_origin != endpoint_origin:
        return False
    if root_path == "/":
        return True
    return endpoint_path == root_path or endpoint_path.startswith(root_path + "/")


def confirmation_required(action: dict, instructions: dict) -> bool:
    """Return the mandatory AAA confirmation decision for one declared action."""
    action_id = action["name"]
    path = action["path"]
    policy = instructions["policy"]
    named = set(policy["require_human_approval_for"])
    named.update(instructions["safety"]["require_human_confirmation_for"])
    return (
        action_id in named
        or path in named
        or not policy["allow_autonomous_execution"]
    )


def validate_pair(agents: dict, instructions: dict) -> None:
    """Raise AAAValidationError unless both objects form one coherent profile."""
    _validate_shape(agents, "agents.schema.json")
    _validate_shape(instructions, "ai-instructions.schema.json")
    if agents["live"] != instructions["live"] or agents["status"] != instructions["status"]:
        raise AAAValidationError("AAA documents disagree on live/status state")
    if agents["live"] and agents["status"] != "active":
        raise AAAValidationError("a live AAA document must have active status")
    if agents["http_action_api"] != instructions["http_action_api"]:
        raise AAAValidationError("AAA documents disagree on HTTP action API mode")

    root = agents["agent_card"]["endpoints"]["action_root"]
    if root == "none":
        if instructions["profile"] != "settings":
            raise AAAValidationError("action_root none requires the Settings profile")
        anchors = {item["id"]: item["deep_link"] for item in instructions["settings_anchors"]}
        if len(anchors) != len(instructions["settings_anchors"]):
            raise AAAValidationError("duplicate Settings anchor ID")
        seen_actions: set[str] = set()
        for item in instructions["settings_actions"]:
            if item["id"] in seen_actions:
                raise AAAValidationError("duplicate Settings action ID")
            seen_actions.add(item["id"])
            if anchors.get(item["id"]) != item["href"]:
                raise AAAValidationError("Settings action points outside a documented anchor")
        return

    if instructions["profile"] != "site":
        raise AAAValidationError("HTTP actions require the site profile")
    seen_names: set[str] = set()
    for action in agents["endpoints"]:
        if action["name"] in seen_names:
            raise AAAValidationError("duplicate AAA action ID")
        seen_names.add(action["name"])
        if not _under_root(root, action["path"]):
            raise AAAValidationError(f"action {action['name']} is outside action_root")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate one AAA agents/instructions pair")
    parser.add_argument("agents", type=Path)
    parser.add_argument("instructions", type=Path)
    args = parser.parse_args()
    agents = json.loads(args.agents.read_text(encoding="utf-8"))
    instructions = json.loads(args.instructions.read_text(encoding="utf-8"))
    try:
        validate_pair(agents, instructions)
    except AAAValidationError as error:
        parser.error(str(error))
    print("AAA/0.1.1 pair valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
