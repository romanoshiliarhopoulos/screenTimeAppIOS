"""
NotificationService — the single public interface for all notification logic.

Invocation contexts:
  1. Session open  → notification_service.on_session_open(...)
  2. Session close → notification_service.on_session_close(...)
  3. Cron job      → notification_service.check_active_sessions()
  4. Shame button  → notification_service.send_shame(...)

All Firestore I/O is synchronous (firebase-admin). Routes that call these
methods may be async def but the calls themselves are blocking — acceptable
for this scale.
"""

import logging
from typing import Optional

from firestore_client import db

from . import (
    active_session_repository,
    audit_repository,
    push_token_repository,
    rules_engine,
    sender,
    settings_repository,
    shame_repository,
    template_builder,
)
from .models import (
    NotificationDecision,
    NotificationDecisionFailed,
    NotificationDecisionSent,
    NotificationDecisionSkipped,
    NotificationSettings,
)

logger = logging.getLogger(__name__)


class NotificationService:

    # ------------------------------------------------------------------
    # Session lifecycle hooks (called from usage router)
    # ------------------------------------------------------------------

    def on_session_open(self, user_id: str, device_id: str, app_name: str, open_time: str) -> None:
        """Write/upsert an activeSession document when a tracked app opens."""
        active_session_repository.upsert(user_id, device_id, app_name, open_time)

    def on_session_close(
        self,
        user_id: str,
        device_id: str,
        app_name: str,
        duration_seconds: int,
        daily_total_seconds: int,
    ) -> list[NotificationDecision]:
        """
        Called after a session is written on app close.
        1. Reads and deletes the activeSession doc (captures notifiedFriends flag).
        2. If friends were already alerted live, sends a close-summary to friends.
        3. Checks for daily cap warning.
        """
        results: list[NotificationDecision] = []
        settings = settings_repository.load(user_id)

        # Read + delete active session (order matters — read before delete)
        active = active_session_repository.delete_and_return(user_id, device_id, app_name)

        if not settings.enabled:
            return results

        # Close summary to friends
        if (
            active
            and active.get("notifiedFriends")
            and settings.allowFriendsToSeeLiveSessions
            and settings.sendCloseSessionSummaryToFriends
        ):
            results.extend(
                self._fan_out_close_summary(user_id, app_name, duration_seconds)
            )

        # Daily cap warning
        if (
            settings.dailyCapSeconds > 0
            and daily_total_seconds >= settings.dailyCapSeconds
            and not rules_engine.is_in_quiet_hours(settings)
            and not audit_repository.was_notified_today(user_id, "daily_cap", app_name)
        ):
            tokens = push_token_repository.get_tokens_for_user(user_id)
            if tokens:
                tmpl = template_builder.daily_cap_warning(
                    app_name, daily_total_seconds, settings.dailyCapSeconds
                )
                ticket = sender.send(tokens[0], tmpl["title"], tmpl["body"], tmpl["data"])
                if ticket.get("status") == "error":
                    results.append(NotificationDecisionFailed(errorCode=ticket.get("message", "")))
                else:
                    nid = audit_repository.record(
                        user_id, "daily_cap", app_name, "sent", "session_close",
                        session_seconds=duration_seconds,
                    )
                    results.append(NotificationDecisionSent(notificationId=nid))

        return results

    # ------------------------------------------------------------------
    # Cron job entry point
    # ------------------------------------------------------------------

    def check_active_sessions(self) -> list[dict]:
        """
        Called by POST /api/cron/check-active-sessions.
        Scans all activeSessions older than the minimum threshold and
        fires personal + friend alerts as appropriate.
        Returns a list of result summaries for logging.
        """
        min_threshold = 30  # query anything older than 30s, per-user settings decide the rest
        stale = active_session_repository.get_all_stale(min_threshold)

        summaries = []
        for active in stale:
            result = self._evaluate_active_session(active)
            summaries.append({"sessionId": active["id"], "results": result})

        return summaries

    def _evaluate_active_session(self, active: dict) -> list[str]:
        user_id = active["userId"]
        device_id = active["deviceId"]
        app_name = active["appName"]
        open_time = active["openTime"]
        notified_user = active.get("notifiedUser", False)
        notified_friends = active.get("notifiedFriends", False)

        settings = settings_repository.load(user_id)
        if not settings.enabled:
            return ["skipped:disabled"]

        elapsed = rules_engine.elapsed_seconds(open_time)
        log: list[str] = []

        # Personal threshold
        if not notified_user and rules_engine.passes_user_threshold(open_time, settings):
            decision = self._send_personal_alert(user_id, app_name, elapsed, settings)
            log.append(f"personal:{decision.status}")
            if decision.status == "sent":
                active_session_repository.mark_user_notified(user_id, device_id, app_name)

        # Friend alert
        if (
            not notified_friends
            and settings.allowFriendsToSeeLiveSessions
            and rules_engine.passes_friend_threshold(open_time, settings)
        ):
            decisions = self._fan_out_friend_alert(user_id, app_name, elapsed)
            sent_count = sum(1 for d in decisions if d.status == "sent")
            log.append(f"friend_alert:sent={sent_count}/{len(decisions)}")
            if sent_count > 0:
                active_session_repository.mark_friends_notified(user_id, device_id, app_name)

        return log

    # ------------------------------------------------------------------
    # Shame button
    # ------------------------------------------------------------------

    def send_shame(self, from_user_id: str, to_user_id: str) -> NotificationDecision:
        """Called by POST /api/users/{friendId}/shame."""
        from_settings = settings_repository.load(from_user_id)

        # Must be in the same group
        if to_user_id not in self._get_friend_ids(from_user_id):
            return NotificationDecisionSkipped(reason="not_friends")

        # Target must have an active session
        active_docs = active_session_repository.get_active_for_user(to_user_id)
        if not active_docs:
            return NotificationDecisionSkipped(reason="no_active_session")

        app_name = active_docs[0].get("appName", "an app")

        # Sender cooldown (not the target's)
        if shame_repository.is_on_cooldown(from_user_id, to_user_id, from_settings.shameCooldownSeconds):
            return NotificationDecisionSkipped(reason="cooldown")

        # Target settings + token
        to_settings = settings_repository.load(to_user_id)
        if not to_settings.enabled:
            return NotificationDecisionSkipped(reason="disabled")

        tokens = push_token_repository.get_tokens_for_user(to_user_id)
        if not tokens:
            return NotificationDecisionSkipped(reason="no_token")

        from_name = self._get_display_name(from_user_id)
        tmpl = template_builder.shame(from_name)
        ticket = sender.send(tokens[0], tmpl["title"], tmpl["body"], tmpl["data"])

        if ticket.get("status") == "error":
            return NotificationDecisionFailed(errorCode=ticket.get("message", ""))

        shame_repository.record(from_user_id, to_user_id, app_name)
        nid = audit_repository.record(to_user_id, "shame", app_name, "sent", "shame_button")
        return NotificationDecisionSent(notificationId=nid)

    # ------------------------------------------------------------------
    # Push token + settings management
    # ------------------------------------------------------------------

    def register_push_token(self, user_id: str, device_id: str, expo_push_token: str, platform: str = "ios") -> None:
        push_token_repository.save(user_id, device_id, expo_push_token, platform)

    def update_settings(self, user_id: str, data: dict) -> None:
        settings_repository.save(user_id, data)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _send_personal_alert(
        self,
        user_id: str,
        app_name: str,
        elapsed: int,
        settings: NotificationSettings,
    ) -> NotificationDecision:
        if rules_engine.is_in_quiet_hours(settings):
            audit_repository.record(user_id, "threshold_alert", app_name, "skipped", "cron", skip_reason="quiet_hours")
            return NotificationDecisionSkipped(reason="quiet_hours")

        tokens = push_token_repository.get_tokens_for_user(user_id)
        if not tokens:
            return NotificationDecisionSkipped(reason="no_token")

        tmpl = template_builder.personal_threshold(app_name, elapsed)
        ticket = sender.send(tokens[0], tmpl["title"], tmpl["body"], tmpl["data"])

        if ticket.get("status") == "error":
            audit_repository.record(user_id, "threshold_alert", app_name, "failed", "cron")
            return NotificationDecisionFailed(errorCode=ticket.get("message", ""))

        nid = audit_repository.record(
            user_id, "threshold_alert", app_name, "sent", "cron", session_seconds=elapsed
        )
        return NotificationDecisionSent(notificationId=nid)

    def _fan_out_friend_alert(
        self, user_id: str, app_name: str, elapsed: int
    ) -> list[NotificationDecision]:
        friend_name = self._get_display_name(user_id)
        results: list[NotificationDecision] = []

        for friend_id in self._get_friend_ids(user_id):
            friend_settings = settings_repository.load(friend_id)
            if not friend_settings.enabled or rules_engine.is_in_quiet_hours(friend_settings):
                results.append(NotificationDecisionSkipped(reason="skipped"))
                continue

            tokens = push_token_repository.get_tokens_for_user(friend_id)
            if not tokens:
                results.append(NotificationDecisionSkipped(reason="no_token"))
                continue

            tmpl = template_builder.friend_alert(friend_name, app_name, elapsed)
            ticket = sender.send(tokens[0], tmpl["title"], tmpl["body"], tmpl["data"])

            if ticket.get("status") == "error":
                audit_repository.record(friend_id, "friend_alert", app_name, "failed", "cron")
                results.append(NotificationDecisionFailed(errorCode=ticket.get("message", "")))
            else:
                nid = audit_repository.record(
                    friend_id, "friend_alert", app_name, "sent", "cron", session_seconds=elapsed
                )
                results.append(NotificationDecisionSent(notificationId=nid))

        return results

    def _fan_out_close_summary(
        self, user_id: str, app_name: str, duration_seconds: int
    ) -> list[NotificationDecision]:
        friend_name = self._get_display_name(user_id)
        results: list[NotificationDecision] = []

        for friend_id in self._get_friend_ids(user_id):
            friend_settings = settings_repository.load(friend_id)
            if not friend_settings.enabled or rules_engine.is_in_quiet_hours(friend_settings):
                results.append(NotificationDecisionSkipped(reason="skipped"))
                continue

            tokens = push_token_repository.get_tokens_for_user(friend_id)
            if not tokens:
                results.append(NotificationDecisionSkipped(reason="no_token"))
                continue

            tmpl = template_builder.session_close_summary(friend_name, app_name, duration_seconds)
            ticket = sender.send(tokens[0], tmpl["title"], tmpl["body"], tmpl["data"])

            if ticket.get("status") == "error":
                results.append(NotificationDecisionFailed(errorCode=ticket.get("message", "")))
            else:
                nid = audit_repository.record(
                    friend_id, "session_summary", app_name, "sent", "session_close",
                    session_seconds=duration_seconds,
                )
                results.append(NotificationDecisionSent(notificationId=nid))

        return results

    def _get_friend_ids(self, user_id: str) -> list[str]:
        groups = (
            db.collection("groups")
            .where("memberIds", "array_contains", user_id)
            .stream()
        )
        friend_ids: set[str] = set()
        for group in groups:
            for member_id in group.to_dict().get("memberIds", []):
                if member_id != user_id:
                    friend_ids.add(member_id)
        return list(friend_ids)

    def _get_display_name(self, user_id: str) -> str:
        doc = (
            db.collection("users")
            .document(user_id)
            .collection("profile")
            .document("info")
            .get()
        )
        return doc.to_dict().get("displayName", "A friend") if doc.exists else "A friend"


# Singleton — import this everywhere
notification_service = NotificationService()
