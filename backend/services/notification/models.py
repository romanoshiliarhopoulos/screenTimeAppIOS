from dataclasses import dataclass, field
from typing import Literal, Optional, Union


@dataclass
class NotificationSettings:
    enabled: bool = True
    barkApiKey: Optional[str] = None
    userAlertThresholdSeconds: int = 420       # 7 minutes
    friendAlertThresholdSeconds: int = 900     # 15 minutes
    dailyCapSeconds: int = 3600                # 1 hour
    cooldownSeconds: int = 7200                # 2 hours
    shameCooldownSeconds: int = 1800           # 30 minutes
    trackedApps: list = field(default_factory=list)
    quietHoursStart: Optional[str] = None      # "HH:MM"
    quietHoursEnd: Optional[str] = None        # "HH:MM"
    allowFriendsToSeeLiveSessions: bool = True
    sendCloseSessionSummaryToFriends: bool = True


# --- Decision return types ---

@dataclass
class NotificationDecisionSent:
    status: Literal["sent"] = "sent"
    reason: str = "threshold_met"
    notificationId: str = ""


@dataclass
class NotificationDecisionSkipped:
    status: Literal["skipped"] = "skipped"
    reason: str = ""


@dataclass
class NotificationDecisionFailed:
    status: Literal["failed"] = "failed"
    reason: str = "delivery_error"
    errorCode: str = ""


NotificationDecision = Union[
    NotificationDecisionSent,
    NotificationDecisionSkipped,
    NotificationDecisionFailed,
]
