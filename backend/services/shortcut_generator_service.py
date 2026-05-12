import os
import platform
import plistlib
import subprocess
import tempfile
import uuid
from typing import Literal


# Bundle IDs for supported apps
APP_BUNDLE_IDS = {
    "Instagram": "com.burbn.instagram",
    "YouTube": "com.google.ios.youtube",
    "TikTok": "com.zhiliaoapp.musically",
    "Facebook": "com.facebook.Facebook",
    "X": "com.atebits.Tweetie2",
    "Snapchat": "com.toyopagroup.picaboo",
    "Reddit": "com.reddit.Reddit",
    "Threads": "com.burbn.barcelona",
    "WhatsApp": "net.whatsapp.WhatsApp",
    "Discord": "com.hammerandchisel.discord",
    "Twitch": "tv.twitch",
    "LinkedIn": "com.linkedin.LinkedIn",
}


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


def _build_close_shortcut(app_name: str, api_url: str, api_key: str) -> dict:
    """Build the close shortcut plist (POST to /api/usage/record)."""
    date_uuid = str(uuid.uuid4()).upper()
    format_uuid = str(uuid.uuid4()).upper()
    userid_uuid = str(uuid.uuid4()).upper()

    base = f"{api_url}/api/usage/record?userId="
    mid = f"&appName={app_name}&eventType=close&eventTime="
    url_str = base + "\ufffc" + mid + "\ufffc"
    userid_pos = len(base)
    eventtime_pos = len(base) + 1 + len(mid)

    return {
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
            # 3 — POST to record endpoint
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


def _build_launcher_shortcut(app_name: str, api_url: str, api_key: str) -> dict:
    """
    Build a launcher shortcut that calls the gateway, then either
    opens the app (if allowed) or shows an alert (if blocked).

    Actions:
      0 — Get Current Date
      1 — Format Date → ISO 8601
      2 — Text: userId (Import Question)
      3 — GET /api/gateway?userId=…&app=…&eventTime=…
      4 — Get Dictionary Value: "action" from step 3
      5 — If action is NOT "allow"
      6 —   Get Dictionary Value: "message" from step 3
      7 —   Show Alert with the message
      8 — Otherwise
      9 —   Open App (bundle ID)
     10 — End If
    """
    bundle_id = APP_BUNDLE_IDS.get(app_name)
    if not bundle_id:
        raise ValueError(f"Unknown app: {app_name}. Add it to APP_BUNDLE_IDS.")

    date_uuid = str(uuid.uuid4()).upper()
    format_uuid = str(uuid.uuid4()).upper()
    userid_uuid = str(uuid.uuid4()).upper()
    gateway_uuid = str(uuid.uuid4()).upper()
    action_val_uuid = str(uuid.uuid4()).upper()
    message_val_uuid = str(uuid.uuid4()).upper()
    if_uuid = str(uuid.uuid4()).upper()

    # Build gateway URL with variable tokens
    base = f"{api_url}/api/gateway?userId="
    mid = f"&app={app_name}&eventTime="
    url_str = base + "\ufffc" + mid + "\ufffc"
    userid_pos = len(base)
    eventtime_pos = len(base) + 1 + len(mid)

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
        # 2 — Text: userId (Import Question fills this at install)
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
        # 3 — GET /api/gateway
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": gateway_uuid,
                "CustomOutputName": "Gateway Response",
                "WFHTTPMethod": "GET",
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
        # 4 — Get Dictionary Value: "action" from gateway response
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
            "WFWorkflowActionParameters": {
                "UUID": action_val_uuid,
                "CustomOutputName": "Action Value",
                "WFDictionaryKey": "action",
                "WFInput": {
                    "Value": {
                        "OutputName": "Gateway Response",
                        "OutputUUID": gateway_uuid,
                        "Type": "ActionOutput",
                    },
                    "WFSerializationType": "WFTextTokenAttachment",
                },
            },
        },
        # 5 — If action is NOT "allow"
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {
                "UUID": if_uuid,
                "GroupingIdentifier": if_uuid,
                "WFControlFlowMode": 0,  # Start of If
                "WFCondition": 5,  # "is not"
                "WFConditionalActionString": "allow",
                "WFInput": {
                    "Type": "Variable",
                    "Variable": {
                        "Value": {
                            "OutputName": "Action Value",
                            "OutputUUID": action_val_uuid,
                            "Type": "ActionOutput",
                        },
                        "WFSerializationType": "WFTextTokenAttachment",
                    },
                },
            },
        },
        # 6 — Get Dictionary Value: "message" from gateway response (for blocked case)
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
            "WFWorkflowActionParameters": {
                "UUID": message_val_uuid,
                "CustomOutputName": "Block Message",
                "WFDictionaryKey": "message",
                "WFInput": {
                    "Value": {
                        "OutputName": "Gateway Response",
                        "OutputUUID": gateway_uuid,
                        "Type": "ActionOutput",
                    },
                    "WFSerializationType": "WFTextTokenAttachment",
                },
            },
        },
        # 7 — Show Alert with block message
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
                "WFAlertActionTitle": "Blocked",
                "WFAlertActionCancelButtonShown": False,
            },
        },
        # 8 — Otherwise (allowed)
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {
                "GroupingIdentifier": if_uuid,
                "WFControlFlowMode": 1,  # Otherwise
            },
        },
        # 9 — Open App
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
        # 10 — End If
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
            "WFWorkflowActionParameters": {
                "GroupingIdentifier": if_uuid,
                "WFControlFlowMode": 2,  # End If
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


def build_shortcut_plist(
    app_name: str,
    event_type: Literal["open", "close"],
    api_url: str,
    api_key: str,
) -> bytes:
    """
    Builds a shortcut plist with an Import Question for userId.

    open  → Launcher shortcut (gateway check → Open App if allowed)
    close → Close shortcut (POST to /api/usage/record)
    """
    if event_type == "open":
        plist_data = _build_launcher_shortcut(app_name, api_url, api_key)
    else:
        plist_data = _build_close_shortcut(app_name, api_url, api_key)

    # Common metadata
    plist_data.update({
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

    return plistlib.dumps(plist_data, fmt=plistlib.FMT_XML)


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
