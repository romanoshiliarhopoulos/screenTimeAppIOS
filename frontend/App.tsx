import { useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import HomeScreen from './src/screens/HomeScreen';
import StatsScreen from './src/screens/StatsScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import ProfileScreen, { ProfileStackParamList } from './src/screens/ProfileScreen';
import ShortcutSetupScreen from './src/screens/ShortcutSetupScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SignInScreen from './src/screens/SignInScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import { useAuth } from './src/hooks/useAuth';
import { colors } from './src/theme';

export type RootTabParamList = {
  Home: undefined;
  Stats: undefined;
  Friends: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

const ACTIVE_COLOR = colors.accentPrimary;
const INACTIVE_COLOR = colors.textTertiary;

const headerStyle = {
  backgroundColor: colors.bg,
  borderBottomColor: colors.border,
} as const;

const headerTitleStyle = {
  color: colors.textPrimary,
  fontWeight: '700' as const,
  fontSize: 18,
};

function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator
      screenOptions={{
        headerStyle,
        headerTitleStyle,
        headerTintColor: colors.accentPrimary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <ProfileStack.Screen
        name="ProfileMain"
        component={ProfileScreen}
        options={{ headerTitle: 'Profile' }}
      />
      <ProfileStack.Screen
        name="ShortcutSetup"
        component={ShortcutSetupScreen}
        options={{ headerTitle: 'Set Up Shortcuts' }}
      />
      <ProfileStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ headerTitle: 'Settings' }}
      />
    </ProfileStack.Navigator>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const [showSignUp, setShowSignUp] = useState(false);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accentPrimary} />
      </View>
    );
  }

  if (!user) {
    return showSignUp ? (
      <SignUpScreen onNavigateToSignIn={() => setShowSignUp(false)} />
    ) : (
      <SignInScreen onNavigateToSignUp={() => setShowSignUp(true)} />
    );
  }

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          tabBarStyle: {
            backgroundColor: colors.surface1,
            borderTopColor: colors.border,
            height: 84,
            paddingBottom: 24,
            paddingTop: 10,
          },
          tabBarActiveTintColor: ACTIVE_COLOR,
          tabBarInactiveTintColor: INACTIVE_COLOR,
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '600',
          },
          headerStyle,
          headerTitleStyle,
          headerShadowVisible: false,
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            headerTitle: 'Today',
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="Stats"
          component={StatsScreen}
          options={{
            headerShown: false,
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? 'bar-chart' : 'bar-chart-outline'} size={24} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="Friends"
          component={FriendsScreen}
          options={{
            headerShown: false,
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? 'people' : 'people-outline'} size={24} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileStackNavigator}
          options={{
            headerShown: false,
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} size={24} color={color} />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
