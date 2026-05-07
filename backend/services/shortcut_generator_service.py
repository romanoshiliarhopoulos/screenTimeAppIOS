import os
import platform
import plistlib
import subprocess
import tempfile
import uuid
from typing import Literal


def _text_item(key: str, value: str) -> dict:
    return {
        "WFItemType": 0,
        "WFKey": {
            "Value": {"string": key},
            "WFSerializationType": "WFTextTokenString",
        },
        "WFValue": {
            "Value": {"string": value},
            "WFSerializationType": "WFTextTokenString",
        },
    }


def _variable_item(key: str, output_name: str, output_uuid: str) -> dict:
    return {
        "WFItemType": 0,
        "WFKey": {
            "Value": {"string": key},
            "WFSerializationType": "WFTextTokenString",
        },
        "WFValue": {
            "Value": {
                "string": "\ufffc",
                "attachmentsByRange": {
                    "{0, 1}": {
                        "OutputName": output_name,
                        "OutputUUID": output_uuid,
                        "Type": "ActionOutput",
                    }
                },
            },
            "WFSerializationType": "WFTextTokenString",
        },
    }


def build_shortcut_plist(
    app_name: str,
    event_type: Literal["open", "close"],
    api_url: str,
    api_key: str,
) -> bytes:
    """
    Builds a shortcut plist with an Import Question for userId.
    Actions:
      0 — Get Current Date
      1 — Format Date (ISO 8601)        → "Formatted Time"
      2 — Text: userId placeholder      → "User ID"  ← Import Question fills this
      3 — POST to /api/usage/record     (URL contains inline variable tokens for userId + eventTime)
    """
    date_uuid   = str(uuid.uuid4()).upper()
    format_uuid = str(uuid.uuid4()).upper()
    userid_uuid = str(uuid.uuid4()).upper()

    # Build the request URL string with \ufffc placeholders for userId and eventTime.
    # Embedding params in the URL is the most reliable way to send data from iOS Shortcuts
    # — no body format ambiguity, works on every iOS version.
    base      = f"{api_url}/api/usage/record?userId="
    mid       = f"&appName={app_name}&eventType={event_type}&eventTime="
    url_str   = base + "\ufffc" + mid + "\ufffc"
    userid_pos    = len(base)
    eventtime_pos = len(base) + 1 + len(mid)

    plist = {
        "WFWorkflowActions": [
            # 0 — capture timestamp
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.date",
                "WFWorkflowActionParameters": {
                    "UUID": date_uuid,
                    "CustomOutputName": "Event Time",
                },
            },
            # 1 — format as ISO 8601
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.format.date",
                "WFWorkflowActionParameters": {
                    "UUID": format_uuid,
                    "CustomOutputName": "Formatted Time",
                    "WFDateFormatStyle": "ISO 8601",
                    "WFISO8601IncludeTime": True,
                    "WFInput": {
                        "Value": {
                            "OutputName": "Event Time",
                            "OutputUUID": date_uuid,
                            "Type": "ActionOutput",
                        },
                        "WFSerializationType": "WFTextTokenAttachment",
                    },
                },
            },
            # 2 — userId text (filled by Import Question at install time)
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
                "WFWorkflowActionParameters": {
                    "UUID": userid_uuid,
                    "CustomOutputName": "User ID",
                    "WFTextActionText": {
                        "Value": {"string": "PASTE_YOUR_USER_ID_HERE"},
                        "WFSerializationType": "WFTextTokenString",
                    },
                },
            },
            # 3 — POST to the URL with inline variable substitution directly in WFURL
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
                "WFWorkflowActionParameters": {
                    "WFHTTPMethod": "POST",
                    "WFURL": {
                        "Value": {
                            "string": url_str,
                            "attachmentsByRange": {
                                f"{{{userid_pos}, 1}}": {
                                    "OutputName": "User ID",
                                    "OutputUUID": userid_uuid,
                                    "Type": "ActionOutput",
                                },
                                f"{{{eventtime_pos}, 1}}": {
                                    "OutputName": "Formatted Time",
                                    "OutputUUID": format_uuid,
                                    "Type": "ActionOutput",
                                },
                            },
                        },
                        "WFSerializationType": "WFTextTokenString",
                    },
                    "WFHTTPHeaders": {
                        "Value": {
                            "WFDictionaryFieldValueItems": [
                                _text_item("x-api-key", api_key),
                            ]
                        },
                        "WFSerializationType": "WFDictionaryFieldValue",
                    },
                },
            },
        ],
        # Import Question — prompts once at install to fill the userId Text action (index 2)
        "WFWorkflowImportQuestions": [
            {
                "ActionIndex": 2,
                "Category": "Parameter",
                "DefaultValue": "",
                "ParameterKey": "WFTextActionText",
                "Text": "Your User ID (copy from the app's Setup screen)",
            }
        ],
        "WFWorkflowClientVersion": "1300.0.0.0.0",
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 946986751,
            "WFWorkflowIconGlyphNumber": 59511,
        },
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": f"Track {app_name} {event_type.capitalize()}",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": [],
    }

    return plistlib.dumps(plist, fmt=plistlib.FMT_XML)


def sign_shortcut(unsigned_bytes: bytes) -> bytes:
    """Signs via macOS `shortcuts sign`. Must be run on a Mac."""
    if platform.system() != "Darwin":
        raise RuntimeError("Signing requires macOS. Run generate_shortcuts.py locally.")

    tmp_in = tmp_out = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".shortcut", delete=False) as f:
            f.write(unsigned_bytes)
            tmp_in = f.name
        tmp_out = tmp_in.replace(".shortcut", "_signed.shortcut")

        result = subprocess.run(
            ["shortcuts", "sign", "--mode", "anyone", "--input", tmp_in, "--output", tmp_out],
            capture_output=True,
            timeout=15,
        )
        if result.returncode != 0:
            raise RuntimeError(f"shortcuts sign failed: {result.stderr.decode()}")

        with open(tmp_out, "rb") as f:
            return f.read()
    finally:
        for p in [tmp_in, tmp_out]:
            if p and os.path.exists(p):
                os.unlink(p)
