import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from "react-native-svg";

export type QuokkaPose = "idle" | "greeting" | "celebrate";

/** Original layered vector artwork for Kuwi, kept in source so its poses stay editable.
 * @param pose - Idle, greeting, or completed-action celebration pose.
 * @param active - Whether the artwork is visible and may run decorative motion.
 * @param reduceMotion - Whether to suppress movement and blinking.
 */
export function Quokka({
  pose,
  active,
  reduceMotion,
}: {
  pose: QuokkaPose;
  active: boolean;
  reduceMotion: boolean;
}) {
  const [blink, setBlink] = useState(false);
  const bob = useSharedValue(0);
  const turn = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bob.value }, { rotate: `${turn.value}deg` }],
  }));

  useEffect(() => {
    if (!active || reduceMotion) {
      cancelAnimation(bob);
      // Reanimated drives this shared value outside React's render lifecycle.
      // eslint-disable-next-line react-hooks/immutability
      bob.value = 0;
      return;
    }
    // Reanimated drives this shared value outside React's render lifecycle.
    bob.value = withRepeat(withSequence(withTiming(-2.5, { duration: 1050 }), withTiming(0, { duration: 1050 })), -1, false);
    return () => cancelAnimation(bob);
  }, [active, reduceMotion, bob]);

  useEffect(() => {
    if (!active || reduceMotion || pose === "idle") return;
    // Reanimated drives this shared value outside React's render lifecycle.
    // eslint-disable-next-line react-hooks/immutability
    turn.value = withSequence(
      withSpring(pose === "celebrate" ? -6 : 4, { damping: 8, stiffness: 190 }),
      withSpring(pose === "celebrate" ? 6 : -2, { damping: 8, stiffness: 190 }),
      withSpring(0, { damping: 11, stiffness: 170 }),
    );
    return () => cancelAnimation(turn);
  }, [active, reduceMotion, pose, turn]);

  useEffect(() => {
    if (!active || reduceMotion) {
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let closedTimer: ReturnType<typeof setTimeout>;
    /** Schedule one blink and another only after the current blink closes. */
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        closedTimer = setTimeout(() => {
          setBlink(false);
          schedule();
        }, 130);
      }, 3300 + Math.random() * 1800);
    };
    schedule();
    return () => {
      clearTimeout(timer);
      clearTimeout(closedTimer);
    };
  }, [active, reduceMotion]);
  const eyesClosed = active && !reduceMotion && blink;

  const rightArm = pose === "greeting"
    ? "M167 137 C178 123 183 107 181 91 C180 80 187 76 194 81 C203 88 199 108 195 121 C192 133 184 146 176 151"
    : pose === "celebrate"
      ? "M166 138 C177 123 178 111 176 98 C174 87 180 81 188 85 C198 91 196 109 193 123 C190 137 183 147 175 152"
      : "M166 140 C178 145 190 151 195 161 C199 169 195 176 187 174 C177 171 169 165 160 159";

  return (
    <Animated.View style={[styles.frame, animatedStyle]}>
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 240 220"
        accessibilityRole="image"
        accessibilityLabel="Kuwi, a smiling quokka wearing a sage green shirt"
      >
        <Defs>
          <LinearGradient id="fur" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#c8895e" />
            <Stop offset="0.55" stopColor="#a96545" />
            <Stop offset="1" stopColor="#774632" />
          </LinearGradient>
          <LinearGradient id="muzzle" x1="0" y1="0" x2="0.7" y2="1">
            <Stop offset="0" stopColor="#f5dfc2" />
            <Stop offset="1" stopColor="#dbb58d" />
          </LinearGradient>
          <LinearGradient id="shirt" x1="0" y1="0" x2="0.9" y2="1">
            <Stop offset="0" stopColor="#8da985" />
            <Stop offset="1" stopColor="#526f56" />
          </LinearGradient>
        </Defs>
        <Ellipse cx="119" cy="205" rx="66" ry="9" fill="#5d4938" opacity="0.13" />
        <Path d="M63 158 C40 158 33 173 41 184 C49 195 70 188 77 177" fill="none" stroke="#704431" strokeWidth="13" strokeLinecap="round" />
        <Path d="M63 158 C40 158 33 173 41 184 C49 195 70 188 77 177" fill="none" stroke="#bb8058" strokeWidth="7" strokeLinecap="round" />
        <Path d="M79 155 C71 175 74 194 91 201 L148 201 C166 192 169 174 159 154 Z" fill="url(#shirt)" stroke="#593d30" strokeWidth="4" strokeLinejoin="round" />
        <Path d="M96 168 L94 197 M143 168 L146 198" fill="none" stroke="#afc09d" strokeWidth="2" opacity="0.55" />
        <Path d="M100 164 C110 170 129 170 140 164 L136 181 C126 186 112 186 103 180 Z" fill="#f1e0c6" stroke="#593d30" strokeWidth="3" strokeLinejoin="round" />
        <Path d={rightArm} fill="none" stroke="#593d30" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
        <Path d={rightArm} fill="none" stroke="url(#fur)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M57 111 C44 101 42 82 52 73 C61 65 75 70 81 85 Z" fill="url(#fur)" stroke="#593d30" strokeWidth="4" />
        <Path d="M58 93 C54 83 60 76 67 79 C72 82 73 90 69 97 Z" fill="#e9b09a" />
        <Path d="M159 84 C164 69 179 63 190 71 C201 79 198 98 186 109 Z" fill="url(#fur)" stroke="#593d30" strokeWidth="4" />
        <Path d="M177 84 C180 76 188 76 190 83 C192 89 188 96 182 98 Z" fill="#e9b09a" />
        <Path d="M54 119 C54 81 77 54 117 53 C156 51 185 78 184 119 C183 154 156 172 120 172 C83 172 55 153 54 119 Z" fill="url(#fur)" stroke="#593d30" strokeWidth="5" />
        <Path d="M72 117 C73 90 91 73 119 72 C148 72 166 92 166 119 C166 141 147 154 120 154 C92 154 72 140 72 117 Z" fill="url(#muzzle)" />
        <Path d="M87 99 C95 88 108 85 118 91" fill="none" stroke="#e6b589" strokeWidth="5" strokeLinecap="round" opacity="0.75" />
        <Path d="M127 88 C140 84 151 92 155 102" fill="none" stroke="#e6b589" strokeWidth="5" strokeLinecap="round" opacity="0.65" />
        <G opacity={eyesClosed ? 0 : 1}>
          <Ellipse cx="99" cy="112" rx="10" ry="13" fill="#fffaf1" />
          <Ellipse cx="142" cy="112" rx="10" ry="13" fill="#fffaf1" />
          <Ellipse cx="101" cy="114" rx="5.5" ry="8" fill="#2b211c" />
          <Ellipse cx="140" cy="114" rx="5.5" ry="8" fill="#2b211c" />
          <Circle cx="103" cy="110" r="2.1" fill="#ffffff" />
          <Circle cx="142" cy="110" r="2.1" fill="#ffffff" />
        </G>
        <G opacity={eyesClosed ? 1 : 0}>
          <Path d="M90 113 Q99 119 108 113" fill="none" stroke="#593d30" strokeWidth="3" strokeLinecap="round" />
          <Path d="M133 113 Q142 119 151 113" fill="none" stroke="#593d30" strokeWidth="3" strokeLinecap="round" />
        </G>
        <Ellipse cx="120" cy="130" rx="24" ry="17" fill="#fff0d9" opacity="0.93" />
        <Path d="M113 126 Q120 120 127 126 Q126 133 120 133 Q114 133 113 126 Z" fill="#704237" />
        <Path d="M120 133 Q121 145 133 141 Q142 138 143 131" fill="none" stroke="#704237" strokeWidth="3" strokeLinecap="round" />
        <Path d="M119 133 Q117 144 107 142 Q99 140 98 133" fill="none" stroke="#704237" strokeWidth="3" strokeLinecap="round" />
        <Ellipse cx="83" cy="128" rx="8" ry="4" fill="#d98f7c" opacity="0.45" />
        <Ellipse cx="157" cy="128" rx="8" ry="4" fill="#d98f7c" opacity="0.45" />
        <Path d="M96 65 C103 51 122 46 135 53" fill="none" stroke="#e6b589" strokeWidth="4" strokeLinecap="round" opacity="0.8" />
        {pose === "celebrate" ? (
          <G fill="#d9a85f" stroke="#8d663d" strokeWidth="1.4">
            <Path d="M37 90 L40 98 L48 101 L40 104 L37 112 L34 104 L26 101 L34 98 Z" />
            <Path d="M201 54 L204 61 L211 64 L204 67 L201 74 L198 67 L191 64 L198 61 Z" />
            <Circle cx="47" cy="56" r="3" />
          </G>
        ) : null}
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
});
