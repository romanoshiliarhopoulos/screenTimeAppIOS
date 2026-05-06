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
import { auth } from '../lib/firebase';
import { colors, spacing, fontSize } from '../theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

const APPS_TO_TRACK = ['Instagram', 'TikTok', 'YouTube', 'Twitter', 'Reddit'];

const AUTOMATION_STEPS = [
  'Open the Shortcuts app',
  'Go to the Automations tab',
  'Tap "+" → New Automation → App',
  'Select the app (e.g. Instagram)',
  'Check "Is Opened" and "Is Closed"',
  'Tap Next → Add Action → Run Shortcut',
  'Select the shortcut you just added',
  'Disable "Ask Before Running" → Done',
];

export default function ShortcutSetupScreen() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  async function downloadShortcut(appName: string) {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert('Error', 'You must be signed in.');
      return;
    }
    setDownloading(appName);
    try {
      const url = `${API_URL}/api/shortcuts/generate?userId=${uid}&app=${encodeURIComponent(appName)}`;
      await Linking.openURL(url);
      setDone((prev) => new Set(prev).add(appName));
    } catch {
      Alert.alert('Error', 'Could not open the shortcut download.');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.pageTitle}>Set Up Shortcuts</Text>
      <Text style={styles.intro}>
        iOS Shortcuts automatically log when you open and close tracked apps — no
        background permissions needed.
      </Text>

      {/* Step 1 */}
      <Text style={styles.sectionHeader}>Step 1 — Download Shortcuts</Text>
      <Text style={styles.stepNote}>
        Tap each app you want to track. Shortcuts will open with an "Add Shortcut" dialog — tap Add.
      </Text>
      <View style={styles.card}>
        {APPS_TO_TRACK.map((app) => (
          <TouchableOpacity
            key={app}
            style={[styles.appRow, done.has(app) && styles.appRowDone]}
            onPress={() => downloadShortcut(app)}
            disabled={downloading === app}
          >
            <Text style={styles.appName}>{app}</Text>
            {done.has(app) ? (
              <Text style={styles.doneLabel}>Added</Text>
            ) : (
              <Text style={styles.downloadLabel}>
                {downloading === app ? 'Opening…' : 'Download'}
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Step 2 */}
      <Text style={styles.sectionHeader}>Step 2 — Set Up Automations</Text>
      <Text style={styles.stepNote}>
        Do this once per app. It takes about 30 seconds each.
      </Text>
      <View style={styles.card}>
        {AUTOMATION_STEPS.map((step, i) => (
          <View key={i} style={[styles.stepRow, i < AUTOMATION_STEPS.length - 1 && styles.stepRowBorder]}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>

      {/* Note */}
      <View style={styles.noteCard}>
        <Text style={styles.noteText}>
          If you add or remove apps, come back here to download the updated Shortcuts.
          Old shortcuts can be deleted in the Shortcuts app.
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
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  appRowDone: {
    opacity: 0.5,
  },
  appName: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  downloadLabel: {
    fontSize: fontSize.body,
    color: colors.accentPrimary,
    fontWeight: '500',
  },
  doneLabel: {
    fontSize: fontSize.body,
    color: colors.success,
    fontWeight: '500',
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
