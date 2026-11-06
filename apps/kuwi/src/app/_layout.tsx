import { Stack } from "expo-router";
/** Keep setup and the initialized account in the same offline route. */
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
