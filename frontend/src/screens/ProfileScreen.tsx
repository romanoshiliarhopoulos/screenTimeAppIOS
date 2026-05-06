import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { auth } from '../lib/firebase';
import { colors, spacing, fontSize } from '../theme';

export type ProfileStackParamList = {
  ProfileMain: undefined;
  ShortcutSetup: undefined;
  Settings: undefined;
};

type Props = {
  navigation: NativeStackNavigationProp<ProfileStackParamList, 'ProfileMain'>;
};

type NavRowProps = {
  label: string;
  sublabel?: string;
  onPress: () => void;
  accent?: boolean;
};

function NavRow({ label, sublabel, onPress, accent }: NavRowProps) {
  return (
    <TouchableOpacity style={styles.navRow} onPress={onPress} activeOpacity={0.7}>
      <View>
        <Text style={[styles.navRowLabel, accent && styles.navRowLabelAccent]}>{label}</Text>
        {sublabel ? <Text style={styles.navRowSublabel}>{sublabel}</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function ProfileScreen({ navigation }: Props) {
  const user = auth.currentUser;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.pageTitle}>Profile</Text>

      {/* User info */}
      <View style={styles.userCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>
            {user?.email?.[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
        <View>
          <Text style={styles.userEmail}>{user?.email ?? '—'}</Text>
          <Text style={styles.userId}>ID: {user?.uid?.slice(0, 8) ?? '—'}…</Text>
        </View>
      </View>

      {/* Shortcuts */}
      <Text style={styles.sectionHeader}>Data Collection</Text>
      <View style={styles.card}>
        <NavRow
          label="Set Up Shortcuts"
          sublabel="Download iOS Shortcuts to start tracking apps"
          onPress={() => navigation.navigate('ShortcutSetup')}
          accent
        />
      </View>

      {/* More */}
      <Text style={styles.sectionHeader}>More</Text>
      <View style={styles.card}>
        <NavRow
          label="Settings"
          sublabel="Display name, account"
          onPress={() => navigation.navigate('Settings')}
        />
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
    marginBottom: spacing.lg,
    letterSpacing: -0.5,
  },
  userCard: {
    backgroundColor: colors.surface1,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: fontSize.section,
    fontWeight: '700',
    color: '#fff',
  },
  userEmail: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  userId: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  sectionHeader: {
    fontSize: fontSize.small,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: 8,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navRowLabel: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  navRowLabelAccent: {
    color: colors.accentPrimary,
  },
  navRowSublabel: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  chevron: {
    fontSize: 20,
    color: colors.textTertiary,
    lineHeight: 24,
  },
});
