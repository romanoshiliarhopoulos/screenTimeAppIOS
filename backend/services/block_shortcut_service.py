"""
block_shortcut_service.py

Generates and signs the three Shortcuts that make up the block-gate flow.

  1. Launcher  ({app_name})
       Home-screen icon replacement.
       Current Date × 2 Format steps (unused but present in template),
       Text userId [Import Question],
       GET /api/gateway?userId=… → "Gateway Response",
       If Gateway Response is not {} → Show Alert (response text), Else Open App.

  2. Open Tracker  (Track {app_name} Open)
       iOS automation: runs when {app_name} opens.
       Current Date, Format Date (ISO 8601), Text userId [Import Question],
       POST /api/usage/record?userId=…&appName=…&eventType=open&eventTime=…

  3. Close Tracker  (Track {app_name} Close)
       Same as open tracker but eventType=close.

Gateway contract:
  plain text "Locked for N min · by X"  →  locked   (condition "is not {}" = True)
  JSON {}                                →  allowed  (condition "is not {}" = False)
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

_WORKFLOW_METADATA = {
    "WFWorkflowClientVersion": "4042.0.2.2",
    "WFWorkflowHasShortcutInputVariables": False,
    "WFWorkflowHasOutputFallback": False,
    "WFWorkflowIcon": {
        "WFWorkflowIconStartColor": 946986751,
        "WFWorkflowIconGlyphNumber": 59511,
    },
    "WFWorkflowInputContentItemClasses": [],
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowOutputContentItemClasses": [],
    "WFQuickActionSurfaces": [],
    "WFWorkflowTypes": ["Watch"],
}


# ── helpers ───────────────────────────────────────────────────────────────────

def _uid() -> str:
    return str(uuid.uuid4()).upper()


def _attachment(output_name: str, output_uuid: str) -> dict:
    return {
        "Value": {
            "OutputName": output_name,
            "OutputUUID": output_uuid,
            "Type": "ActionOutput",
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def _token_string(base: str, tokens: list[tuple[str, str, str]]) -> dict:
    """
    Build a WFTextTokenString with embedded variable tokens.
    tokens: [(output_name, output_uuid, suffix_after_token), …]
    """
    s = base
    attachments = {}
    pos = len(base)
    for output_name, output_uuid, suffix in tokens:
        attachments[f"{{{pos}, 1}}"] = {
            "OutputName": output_name,
            "OutputUUID": output_uuid,
            "Type": "ActionOutput",
        }
        s += "\ufffc" + suffix
        pos += 1 + len(suffix)
    return {
        "Value": {"string": s, "attachmentsByRange": attachments},
        "WFSerializationType": "WFTextTokenString",
    }


def _import_question(action_index: int) -> list:
    return [
        {
            "ActionIndex": action_index,
            "Category": "Parameter",
            "DefaultValue": "",
            "ParameterKey": "WFTextActionText",
            "Text": "Your User ID (copy from the app's Setup screen)",
        }
    ]


# ── 1. Launcher ───────────────────────────────────────────────────────────────

def _build_launcher(app_name: str, api_url: str) -> dict:
    """
    10 actions (matches template screenshots):
      0  Get Current Date            → "Event Time"
      1  Format Date ISO 8601        → "Formatted Time"   (present but unused in URL)
      2  Format Date yyyy-MM-dd      → "Local Date"       (present but unused in URL)
      3  Text: userId                [Import Question]    → "User ID"
      4  GET /api/gateway?userId=…   → "Gateway Response"
      5  If Gateway Response is not {}   (WFCondition 5 = does not equal)
      6    Show Alert  "{app} is Blocked" / {Gateway Response}
      7  Otherwise
      8    Open App
      9  End If
    """
    bundle_id = APP_BUNDLE_IDS[app_name]

    date_uuid    = _uid()
    format_uuid  = _uid()
    local_uuid   = _uid()
    userid_uuid  = _uid()
    gateway_uuid = _uid()
    if_uuid      = _uid()

    gateway_url = _token_string(
        base=f"{api_url}/api/gateway?userId=",
        tokens=[("User ID", userid_uuid, "")],
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
                    "WFInput": _attachment("Event Time", date_uuid),
                },
            },
            # 2 — Format Date → yyyy-MM-dd
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.format.date",
                "WFWorkflowActionParameters": {
                    "UUID": local_uuid,
                    "CustomOutputName": "Local Date",
                    "WFDateFormatStyle": "Custom",
                    "WFDateFormat": "yyyy-MM-dd",
                    "WFInput": _attachment("Event Time", date_uuid),
                },
            },
            # 3 — userId [Import Question]
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
                "WFWorkflowActionParameters": {
                    "UUID": userid_uuid,
                    "CustomOutputName": "User ID",
                    "WFTextActionText": "",
                },
            },
            # 4 — GET gateway → "Gateway Response"
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
                "WFWorkflowActionParameters": {
                    "UUID": gateway_uuid,
                    "CustomOutputName": "Gateway Response",
                    "WFHTTPMethod": "GET",
                    "WFURL": gateway_url,
                },
            },
            # 5 — If Gateway Response is not {}  (WFCondition 5 = does not equal)
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
                "WFWorkflowActionParameters": {
                    "UUID": if_uuid,
                    "GroupingIdentifier": if_uuid,
                    "WFControlFlowMode": 0,
                    "WFCondition": 5,
                    "WFConditionalActionString": "{}",
                    "WFInput": {
                        "Type": "Variable",
                        "Variable": _attachment("Gateway Response", gateway_uuid),
                    },
                },
            },
            # 6 — Show Alert (blocked) — display Gateway Response directly
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.alert",
                "WFWorkflowActionParameters": {
                    "WFAlertActionTitle": f"{app_name} is Blocked",
                    "WFAlertActionMessage": {
                        "Value": {
                            "string": "\ufffc",
                            "attachmentsByRange": {
                                "{0, 1}": {
                                    "OutputName": "Gateway Response",
                                    "OutputUUID": gateway_uuid,
                                    "Type": "ActionOutput",
                                }
                            },
                        },
                        "WFSerializationType": "WFTextTokenString",
                    },
                    "WFAlertActionCancelButtonShown": False,
                },
            },
            # 7 — Otherwise (allowed)
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
                "WFWorkflowActionParameters": {
                    "GroupingIdentifier": if_uuid,
                    "WFControlFlowMode": 1,
                },
            },
            # 8 — Open the real app
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.openapp",
                "WFWorkflowActionParameters": {
                    "UUID": _uid(),
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
                    "UUID": _uid(),
                    "GroupingIdentifier": if_uuid,
                    "WFControlFlowMode": 2,
                },
            },
        ],
        "WFWorkflowImportQuestions": _import_question(action_index=3),
        "WFWorkflowName": app_name,
    }


# ── 2 & 3. Open / Close Tracker ──────────────────────────────────────────────

def _build_tracker(app_name: str, api_url: str, event_type: Literal["open", "close"]) -> dict:
    """
    4 actions (matches template screenshots):
      0  Get Current Date        → "Event Time"
      1  Format Date → ISO 8601  → "Formatted Time"
      2  Text: userId             [Import Question]  → "User ID"
      3  POST /api/usage/record?userId=…&appName=…&eventType=…&eventTime=…
    """
    date_uuid   = _uid()
    format_uuid = _uid()
    userid_uuid = _uid()

    record_url = _token_string(
        base=f"{api_url}/api/usage/record?userId=",
        tokens=[
            ("User ID",        userid_uuid, f"&appName={app_name}&eventType={event_type}&eventTime="),
            ("Formatted Time", format_uuid, ""),
        ],
    )

    label = "Open" if event_type == "open" else "Close"

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
            # 1 — Format → ISO 8601
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.format.date",
                "WFWorkflowActionParameters": {
                    "UUID": format_uuid,
                    "CustomOutputName": "Formatted Time",
                    "WFDateFormatStyle": "ISO 8601",
                    "WFISO8601IncludeTime": True,
                    "WFInput": _attachment("Event Time", date_uuid),
                },
            },
            # 2 — userId [Import Question]
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
            # 3 — POST event
            {
                "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
                "WFWorkflowActionParameters": {
                    "WFHTTPMethod": "POST",
                    "WFURL": record_url,
                },
            },
        ],
        "WFWorkflowImportQuestions": _import_question(action_index=2),
        "WFWorkflowName": f"Track {app_name} {label}",
    }


# ── public API ────────────────────────────────────────────────────────────────

EventType = Literal["launcher", "open", "close"]


def build_block_shortcut_plist(
    app_name: str,
    event_type: EventType,
    api_url: str,
) -> bytes:
    """Returns unsigned XML plist bytes. Pass to sign_block_shortcut() before distributing."""
    if app_name not in APP_BUNDLE_IDS:
        raise ValueError(f"Unknown app: {app_name!r}. Add it to APP_BUNDLE_IDS.")

    if event_type == "launcher":
        data = _build_launcher(app_name, api_url)
    elif event_type == "open":
        data = _build_tracker(app_name, api_url, "open")
    else:
        data = _build_tracker(app_name, api_url, "close")

    data.update(_WORKFLOW_METADATA)
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
