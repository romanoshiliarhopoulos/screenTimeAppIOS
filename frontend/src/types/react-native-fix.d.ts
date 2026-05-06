/**
 * TypeScript + React Native JSX fix.
 *
 * RN class components (View, Text, etc.) extend an intersection
 * `Constructor<NativeMethods> & typeof XComponent`. TypeScript cannot
 * resolve the React.Component members through this intersection for JSX
 * checking (TS2786, TS2607). We add the missing members to each class
 * instance type via interface merging so TypeScript finds them directly.
 */
import 'react-native';

/** All members required by JSX.ElementClass (React.Component<any>) */
interface RNComponentBase {
  readonly props: any;
  readonly state: any;
  context: any;
  refs: { [key: string]: any };
  setState: any;
  forceUpdate: any;
  render(): any;
}

declare module 'react-native' {
  interface View extends RNComponentBase {}
  interface Text extends RNComponentBase {}
  interface TouchableOpacity extends RNComponentBase {}
  interface TouchableHighlight extends RNComponentBase {}
  interface TouchableWithoutFeedback extends RNComponentBase {}
  interface ScrollView extends RNComponentBase {}
  interface FlatList extends RNComponentBase {}
  interface TextInput extends RNComponentBase {}
  interface Image extends RNComponentBase {}
  interface ActivityIndicator extends RNComponentBase {}
  interface RefreshControl extends RNComponentBase {}
  interface KeyboardAvoidingView extends RNComponentBase {}
  interface Modal extends RNComponentBase {}
  interface Pressable extends RNComponentBase {}
  // Allow children on Animated.View (React 18 + RN type gap)
  namespace Animated {
    interface AnimatedProps<T> {
      children?: import('react').ReactNode;
    }
  }
}
