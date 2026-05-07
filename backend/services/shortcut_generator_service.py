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
    user_id: str,
    app_name: str,
    event_type: Literal["open", "close"],
    api_url: str,
    api_key: str,
) -> bytes:
    date_uuid = str(uuid.uuid4()).upper()
    format_uuid = str(uuid.uuid4()).upper()

    plist = {
        "WFWorkflowActions": [
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.date",
                "WFWorkflowActionParameters": {
                    "UUID": date_uuid,
                    "CustomOutputName": "Event Time",
                },
            },
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.format.date",
                "WFWorkflowActionParameters": {
                    "UUID": format_uuid,
                    "CustomOutputName": "Formatted Time",
                    "WFDateFormatStyle": "Custom",
                    "WFDateFormat": "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
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
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
                "WFWorkflowActionParameters": {
                    "WFHTTPMethod": "POST",
                    "WFURL": f"{api_url}/api/usage/record",
                    "WFHTTPHeaders": {
                        "Value": {
                            "WFDictionaryFieldValueItems": [
                                _text_item("x-api-key", api_key),
                            ]
                        },
                        "WFSerializationType": "WFDictionaryFieldValue",
                    },
                    "WFHTTPBodyType": "JSON",
                    "WFHTTPRequestBody": {
                        "Value": {
                            "WFDictionaryFieldValueItems": [
                                _text_item("userId", user_id),
                                _text_item("appName", app_name),
                                _text_item("eventType", event_type),
                                _variable_item("eventTime", "Formatted Time", format_uuid),
                            ]
                        },
                        "WFSerializationType": "WFDictionaryFieldValue",
                    },
                },
            },
        ],
        "WFWorkflowClientVersion": "1300.0.0.0.0",
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 946986751,
            "WFWorkflowIconGlyphNumber": 59511,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": f"Track {app_name} {event_type.capitalize()}",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": [],
    }

    return plistlib.dumps(plist, fmt=plistlib.FMT_XML)


def sign_shortcut(unsigned_bytes: bytes) -> bytes:
    """
    On macOS: signs via the system `shortcuts` CLI (no warning on install).
    On Linux/Vercel: returns unsigned bytes — iOS installs after the user
    enables Settings → Shortcuts → Allow Untrusted Shortcuts once.
    """
    if platform.system() != "Darwin":
        return unsigned_bytes

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
        if result.returncode == 0:
            with open(tmp_out, "rb") as f:
                return f.read()
    except Exception:
        pass
    finally:
        for p in [tmp_in, tmp_out]:
            if p and os.path.exists(p):
                os.unlink(p)

    return unsigned_bytes


def generate_shortcut(
    user_id: str,
    app_name: str,
    event_type: Literal["open", "close"],
) -> bytes:
    """Entry point for the router — builds and signs a shortcut."""
    api_url = os.environ.get("API_URL", "").rstrip("/")
    api_key = os.environ.get("SHORTCUT_API_KEY", "")

    if not api_url:
        raise ValueError("API_URL env var not set")

    plist_bytes = build_shortcut_plist(user_id, app_name, event_type, api_url, api_key)
    return sign_shortcut(plist_bytes)
