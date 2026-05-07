def personal_threshold(app_name: str, elapsed_seconds: int) -> dict:
    minutes = elapsed_seconds // 60
    return {
        "title": "Take a breath",
        "body": f"You've been on {app_name} for {minutes} minutes. Want to pause now?",
        "data": {"type": "threshold_alert", "appName": app_name},
    }


def friend_alert(friend_name: str, app_name: str, elapsed_seconds: int) -> dict:
    minutes = elapsed_seconds // 60
    return {
        "title": "Your friend is doomscrolling",
        "body": f"{friend_name} has been on {app_name} for {minutes} minutes. Go shame them!",
        "data": {"type": "friend_alert", "appName": app_name},
    }


def shame(from_name: str) -> dict:
    return {
        "title": "You've been called out",
        "body": f"{from_name} is calling you out! Time to put the phone down.",
        "data": {"type": "shame"},
    }


def session_close_summary(friend_name: str, app_name: str, duration_seconds: int) -> dict:
    minutes = duration_seconds // 60
    return {
        "title": f"{friend_name} finally got off their phone",
        "body": f"They were on {app_name} for {minutes} minutes.",
        "data": {"type": "session_summary", "appName": app_name},
    }


def daily_cap_warning(app_name: str, total_seconds: int, cap_seconds: int) -> dict:
    total_min = total_seconds // 60
    cap_min = cap_seconds // 60
    return {
        "title": "Daily limit reached",
        "body": f"You've used {app_name} for {total_min} min today. Your daily limit is {cap_min} min.",
        "data": {"type": "daily_cap", "appName": app_name},
    }
