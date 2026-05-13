"""
block_shortcut_service.py

Generates and signs Shortcuts for the simplified block-gate flow.
No API key — endpoints are public, userId is the only identifier.

  Launcher (open):
    1. GET /api/gateway?userId=…&app=…
       → { "action": "allow" }  or  { "action": "block", "message": "…" }
    2. If blocked  → show alert with message (includes timer from backend)
       If allowed  → POST open event to /api/usage/record, then open app

  Close automation:
    POST /api/usage/record (eventType=close)
"""

import os
import platform
import plistlib
import subprocess
import tempfile
import uuid
from typing import Literal


APP_BUNDLE_IDS = {
    "Instagram": "com.burbn.instagram",
    "YouTube":   "com.google.ios.youtube",
    "TikTok":    "com.zhiliaoapp.musically",
    "Facebook":  "com.facebook.Facebook",
    "X":         "com.atebits.Tweetie2",
    "Snapchat":  "com.toyopagroup.picaboo",
    "Reddit":    "com.reddit.Reddit",
    "Threads":   "com.burbn.barcelona",
    "WhatsApp":  "net.whatsapp.WhatsApp",
    "Discord":   "com.hammerandchisel.discord",
    "Twitch":    "tv.twitch",
    "LinkedIn":  "com.linkedin.LinkedIn",
}


# ── helpers ───────────────────────────────────────────────────────────────────

def _action_output_attachment(output_name: str, output_uuid: str) -> dict:
    return {
        "Value": {
            "OutputName": output_name,
            "OutputUUID": output_uuid,
            "Type": "ActionOutput",
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def _token_url(base: str, tokens: list[tuple[str, str, str]]) -> dict:
    """
    Build a WFTextTokenString URL with embedded variable tokens.
    tokens: [(output_name, output_uuid, suffix_after_token), …]
    """
    url_str = base
    attachments = {}
    pos = len(base)

    for output_name, output_uuid, suffix in tokens:
        attachments[f"{{{pos}, 1}}"] = {
            "OutputName": output_name,
            "OutputUUID": output_uuid,
            "Type": "ActionOutput",
        }
        url_str += "\ufffc" + suffix
        pos += 1 + len(suffix)

    return {
        "Value": {"string": url_str, "attachmentsByRange": attachments},
        "WFSerializationType": "WFTextTokenString",
    }


# ── launcher shortcut (open) ──────────────────────────────────────────────────

def _build_block_launcher_shortcut(app_name: str, api_url: str) -> dict:
    """
    Home-screen launcher that replaces the real app icon.

    Actions (mirrored exactly from working shortcut):
      0  Get Current Date
      1  Format Date → ISO 8601
      2  Text: userId          [Import Question at install]
      3  GET /api/gateway?userId=…&app=…
      4  Get Dict Value "action" → Action Value
      5  If Action Value does-not-contain "allow"  (WFCondition 100)
      6    Get Dict Value "message" → Block Message
      7    Show Alert {Block Message}
      8  Otherwise
      9    POST /api/usage/record  (open event)
      10   Open App
      11 End If
    """
    bundle_id = APP_BUNDLE_IDS.get(app_name)
    if not bundle_id:
        raise ValueError(f"Unknown app: {app_name!r}. Add it to APP_BUNDLE_IDS.")

    date_uuid        = str(uuid.uuid4()).upper()
    format_uuid      = str(uuid.uuid4()).upper()
    userid_uuid      = str(uuid.uuid4()).upper()
    message_val_uuid = str(uuid.uuid4()).upper()  # gateway response = Block Message directly
    record_uuid      = str(uuid.uuid4()).upper()
    if_uuid          = str(uuid.uuid4()).upper()

    gateway_url = _token_url(
        base=f"{api_url}/api/gateway?userId=",
        tokens=[("User ID", userid_uuid, "")],
    )

    record_url = _token_url(
        base=f"{api_url}/api/usage/record?userId=",
        tokens=[
            ("User ID",        userid_uuid, f"&appName={app_name}&eventType=open&eventTime="),
            ("Formatted Time", format_uuid,  ""),
        ],
    )

    actions = [
        # 0 — Get Current Date
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.date",
            "WFWorkflowActionParameters": {
                "UUID": date_uuid,
                "CustomOutputName": "Event Time",
            },
        },
        # 1 — Format Date → ISO 8601
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.format.date",
            "WFWorkflowActionParameters": {
                "UUID": format_uuid,
                "CustomOutputName": "Formatted Time",
                "WFDateFormatStyle": "ISO 8601",
                "WFISO8601IncludeTime": True,
                "WFInput": _action_output_attachment("Event Time", date_uuid),
            },
        },
        # 2 — userId (Import Question fills this once at install)
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
            "WFWorkflowActionParameters": {
                "UUID": userid_uuid,
                "CustomOutputName": "User ID",
                "WFTextActionText": "",
            },
        },
        # 3 — GET /api/gateway → plain text message if locked, 204 if allowed
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": message_val_uuid,
                "CustomOutputName": "Block Message",
                "WFHTTPMethod": "GET",
                "WFURL": gateway_url,
            },
        },
        # 4 — If Block Message has any value  (WFCondition 1002 = has any value)
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {
                "UUID": if_uuid,
                "GroupingIdentifier": if_uuid,
                "WFControlFlowMode": 0,
                "WFCondition": 1002,
                "WFInput": {
                    "Type": "Variable",
                    "Variable": _action_output_attachment("Block Message", message_val_uuid),
                },
            },
        },
        # 5 — Show Alert with Block Message
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.alert",
            "WFWorkflowActionParameters": {
                "WFAlertActionMessage": {
                    "Value": {
                        "string": "\ufffc",
                        "attachmentsByRange": {
                            "{0, 1}": {
                                "OutputName": "Block Message",
                                "OutputUUID": message_val_uuid,
                                "Type": "ActionOutput",
                            }
                        },
                    },
                    "WFSerializationType": "WFTextTokenString",
                },
                "WFAlertActionTitle": f"{app_name} is Blocked",
                "WFAlertActionCancelButtonShown": False,
            },
        },
        # 6 — Otherwise (204 = allowed, no value)
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {
                "GroupingIdentifier": if_uuid,
                "WFControlFlowMode": 1,
            },
        },
        # 7 — POST open event
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": record_uuid,
                "WFHTTPMethod": "POST",
                "WFURL": record_url,
            },
        },
        # 8 — Open the real app
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.openapp",
            "WFWorkflowActionParameters": {
                "WFAppIdentifier": bundle_id,
                "WFSelectedApp": {
                    "BundleIdentifier": bundle_id,
                    "Name": app_name,
                    "TeamIdentifier": "",
                },
            },
        },
        # 9 — End If
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {
                "GroupingIdentifier": if_uuid,
                "WFControlFlowMode": 2,
            },
        },
    ]

    return {
        "WFWorkflowActions": actions,
        "WFWorkflowImportQuestions": [
            {
                "ActionIndex": 2,
                "Category": "Parameter",
                "DefaultValue": "",
                "ParameterKey": "WFTextActionText",
                "Text": "Your User ID (copy from the app's Setup screen)",
            }
        ],
        "WFWorkflowName": app_name,
    }


# ── close shortcut ────────────────────────────────────────────────────────────

def _build_block_close_shortcut(app_name: str, api_url: str) -> dict:
    """Background automation: fires when the tracked app is closed."""
    date_uuid   = str(uuid.uuid4()).upper()
    format_uuid = str(uuid.uuid4()).upper()
    userid_uuid = str(uuid.uuid4()).upper()

    record_url = _token_url(
        base=f"{api_url}/api/usage/record?userId=",
        tokens=[
            ("User ID",        userid_uuid, f"&appName={app_name}&eventType=close&eventTime="),
            ("Formatted Time", format_uuid,  ""),
        ],
    )

    return {
        "WFWorkflowActions": [
            # 0 — Get Current Date
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.date",
                "WFWorkflowActionParameters": {
                    "UUID": date_uuid,
                    "CustomOutputName": "Event Time",
                },
            },
            # 1 — Format Date → ISO 8601
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.format.date",
                "WFWorkflowActionParameters": {
                    "UUID": format_uuid,
                    "CustomOutputName": "Formatted Time",
                    "WFDateFormatStyle": "ISO 8601",
                    "WFISO8601IncludeTime": True,
                    "WFInput": _action_output_attachment("Event Time", date_uuid),
                },
            },
            # 2 — userId (Import Question fills this once at install)
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
            # 3 — POST close event
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
                "WFWorkflowActionParameters": {
                    "WFHTTPMethod": "POST",
                    "WFURL": record_url,
                },
            },
        ],
        "WFWorkflowImportQuestions": [
            {
                "ActionIndex": 2,
                "Category": "Parameter",
                "DefaultValue": "",
                "ParameterKey": "WFTextActionText",
                "Text": "Your User ID (copy from the app's Setup screen)",
            }
        ],
        "WFWorkflowName": f"Track {app_name} Close",
    }


# ── public API ────────────────────────────────────────────────────────────────

def build_block_shortcut_plist(
    app_name: str,
    event_type: Literal["open", "close"],
    api_url: str,
) -> bytes:
    """Returns unsigned XML plist bytes. Pass to sign_block_shortcut() before distributing."""
    if event_type == "open":
        data = _build_block_launcher_shortcut(app_name, api_url)
    else:
        data = _build_block_close_shortcut(app_name, api_url)

    data.update({
        "WFWorkflowClientVersion": "1300.0.0.0.0",
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 946986751,
            "WFWorkflowIconGlyphNumber": 59511,
        },
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": [],
    })

    return plistlib.dumps(data, fmt=plistlib.FMT_XML)


def sign_block_shortcut(unsigned_bytes: bytes) -> bytes:
    """Signs via macOS `shortcuts sign --mode anyone`. Must run on a Mac."""
    if platform.system() != "Darwin":
        raise RuntimeError(
            "Signing requires macOS. Run generate_block_shortcuts.py locally on a Mac."
        )

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
