import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { auth } from '../lib/firebase';
import { colors, spacing, fontSize } from '../theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

const APPS = [
  'Instagram',
  'YouTube',
  'Facebook',
  'TikTok',
  'X',
  'Reddit',
  'LinkedIn',
];

const AUTOMATION_STEPS = [
  'Download all 3 shortcuts for each app you want to block',
  'Tap Launcher → add to Shortcuts, then long-press it → Share → Add to Home Screen',
  'Name it the same as the app (e.g. "Instagram") and set its icon',
  'Long-press the real app on your home screen → Remove from Home Screen',
  'Open Shortcuts → Automations → + → App → select the app → check "Is Opened" → run the Open shortcut → disable "Ask Before Running"',
  'Repeat for "Is Closed" using the Close shortcut',
];

type DoneKey = `${string}-${'launcher' | 'open' | 'close'}`;

export default function ShortcutSetupScreen() {
  const [loading, setLoading] = useState<string | null>(null);
  const [done, setDone] = useState<Set<DoneKey>>(new Set());
  const [copied, setCopied] = useState(false);
  const userId = auth.currentUser?.uid ?? '';

  function copyUserId() {
    Clipboard.setStringAsync(userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function download(appName: string, event: 'launcher' | 'open' | 'close') {
    const key: DoneKey = `${appName}-${event}`;
    setLoading(key);
    try {
      const url =
        `${API_URL}/api/shortcuts/block/download` +
        `?appName=${encodeURIComponent(appName)}` +
        `&event=${event}`;
      await Linking.openURL(url);
      setDone((prev) => new Set(prev).add(key));
    } catch {
      Alert.alert('Error', 'Could not open the shortcut download.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.pageTitle}>Block Apps</Text>
      <Text style={styles.intro}>
        iOS Shortcuts replace your app icons. Tapping one checks if the app is
        blocked — if so, you see a message with the unlock time. No background
        permissions needed.
      </Text>

      {/* User ID card */}
      <View style={styles.userIdCard}>
        <Text style={styles.userIdLabel}>Your User ID</Text>
        <Text style={styles.userIdValue} numberOfLines={1} ellipsizeMode="middle">
          {userId}
        </Text>
        <TouchableOpacity style={styles.copyBtn} onPress={copyUserId}>
          <Text style={styles.copyBtnText}>{copied ? 'Copied!' : 'Copy'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.userIdHint}>
        iOS will ask for this once when you install each shortcut.
      </Text>

      {/* Step 1 */}
      <Text style={styles.sectionHeader}>Step 1 — Download Shortcuts</Text>
      <Text style={styles.stepNote}>
        Download all 3 shortcuts for each app: Launcher (home screen icon),
        Open tracker, and Close tracker. Safari will hand them to the Shortcuts app.
      </Text>

      <View style={styles.card}>
        {APPS.map((app, i) => {
          const launcherDone = done.has(`${app}-launcher`);
          const openDone = done.has(`${app}-open`);
          const closeDone = done.has(`${app}-close`);
          const isLast = i === APPS.length - 1;
          return (
            <View
              key={app}
              style={[styles.appRow, !isLast && styles.appRowBorder]}
            >
              <Text style={styles.appName}>{app}</Text>
              <View style={styles.btnGroup}>
                <TouchableOpacity
                  style={[styles.btn, launcherDone && styles.btnDone]}
                  onPress={() => download(app, 'launcher')}
                  disabled={loading === `${app}-launcher`}
                >
                  <Text style={[styles.btnText, launcherDone && styles.btnTextDone]}>
                    {loading === `${app}-launcher` ? '…' : launcherDone ? 'Launch ✓' : 'Launch ↓'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, openDone && styles.btnDone]}
                  onPress={() => download(app, 'open')}
                  disabled={loading === `${app}-open`}
                >
                  <Text style={[styles.btnText, openDone && styles.btnTextDone]}>
                    {loading === `${app}-open` ? '…' : openDone ? 'Open ✓' : 'Open ↓'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, closeDone && styles.btnDone]}
                  onPress={() => download(app, 'close')}
                  disabled={loading === `${app}-close`}
                >
                  <Text style={[styles.btnText, closeDone && styles.btnTextDone]}>
                    {loading === `${app}-close` ? '…' : closeDone ? 'Close ✓' : 'Close ↓'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      {/* Step 2 */}
      <Text style={styles.sectionHeader}>Step 2 — Set Up Automations</Text>
      <Text style={styles.stepNote}>
        Do this once per app (~30 seconds each).
      </Text>
      <View style={styles.card}>
        {AUTOMATION_STEPS.map((step, i) => (
          <View
            key={i}
            style={[
              styles.stepRow,
              i < AUTOMATION_STEPS.length - 1 && styles.stepRowBorder,
            ]}
          >
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>

      <View style={styles.noteCard}>
        <Text style={styles.noteText}>
          If iOS shows an "Untrusted Shortcut" warning, go to Settings →
          Shortcuts → Allow Untrusted Shortcuts, then retry.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  pageTitle: {
    fontSize: fontSize.page,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    letterSpacing: -0.5,
  },
  intro: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    fontSize: fontSize.section,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    letterSpacing: -0.3,
  },
  stepNote: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: 8,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  appRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  appRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  appName: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  btnGroup: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: colors.surface2,
  },
  btnDone: {
    backgroundColor: 'transparent',
  },
  btnText: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.accentPrimary,
  },
  btnTextDone: {
    color: colors.success,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    gap: spacing.md,
  },
  stepRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumberText: {
    fontSize: fontSize.tiny,
    fontWeight: '700',
    color: '#fff',
  },
  stepText: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    flex: 1,
    lineHeight: 20,
  },
  userIdCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  userIdLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
    flexShrink: 0,
  },
  userIdValue: {
    flex: 1,
    fontSize: fontSize.small,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  copyBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.surface2,
    flexShrink: 0,
  },
  copyBtnText: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.accentPrimary,
  },
  userIdHint: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginBottom: spacing.lg,
    marginTop: spacing.xs,
  },
  noteCard: {
    backgroundColor: colors.surface1,
    borderRadius: 8,
    padding: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.accentMuted,
  },
  noteText: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
