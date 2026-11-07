import { useEffect, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { closeDatabase, database, type Setup } from "../storage/client";
const currencies = [
  ["PHP", "Philippine Peso"],
  ["USD", "US Dollar"],
  ["EUR", "Euro"],
  ["GBP", "British Pound"],
  ["JPY", "Japanese Yen"],
  ["TWD", "New Taiwan Dollar"],
];
const cream = "#f9f5eb",
  ink = "#293c32",
  sage = "#486b51";
/** Render local setup and the first saved account; storage failures always stay visible. */
export default function Home() {
  const [saved, setSaved] = useState<Setup | null>(null),
    [phase, setPhase] = useState("loading");
  const [name, setName] = useState(""),
    [account, setAccount] = useState("Cash"),
    [amount, setAmount] = useState("0");
  const [currency, setCurrency] = useState("PHP");
  const [calculator, setCalculator] = useState(false);
  const [intro, setIntro] = useState(0);
  const [awake, setAwake] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [step, setStep] = useState(0),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  /**
   * Replace the worker and read canonical setup, updating saved data and phase.
   * Resolves after startup succeeds or its failure is displayed; callers reset
   * loading/error state before an explicit retry.
   */
  function load() {
    return closeDatabase()
      .then(() => database("state"))
      .then(
        (state) => {
          setSaved(state);
          setPhase("ready");
        },
        (failure: Error) => {
          setError(failure.message);
          setPhase("error");
        },
      );
  }
  useEffect(() => {
    void load();
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/sw.js")
        .catch(() =>
          setError("Offline caching failed. Stay online and reload to retry."),
        );
  }, []);
  /** Validate decimal text, convert to the selected currency’s integer minor units, and commit setup atomically. */
  async function finish() {
    const digits = currency === "JPY" ? 0 : 2;
    if (!(digits === 0 ? /^\d+$/ : /^\d+(\.\d{0,2})?$/).test(amount)) {
      setError(
        "Enter an amount with at most two decimal places (whole numbers for JPY).",
      );
      return;
    }
    const [whole, fraction = ""] = amount.split(".");
    const minor =
      Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
    if (!Number.isSafeInteger(minor)) {
      setError("This amount is too large.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      setSaved(
        await database("complete", {
          name,
          account,
          currency,
          amountMinor: minor,
        }),
      );
      setCelebrating(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  /** Close files before releasing ownership so another tab may safely open them. */
  async function close() {
    try {
      await closeDatabase();
      setPhase("closed");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  /** Render a labeled action with a real disabled state during validation or saving. */
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
  return (
    <ScrollView
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.shell}>
        <Text style={s.brand}>kuwi</Text>
        {error ? (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        ) : null}
        <Modal
          visible={calculator}
          transparent
          animationType="slide"
          onRequestClose={() => setCalculator(false)}
        >
          <View style={s.overlay}>
            <View style={s.calculator}>
              <Text style={s.title}>Opening balance</Text>
              <Text style={s.balance}>{amount}</Text>
              <View style={s.keys}>
                {[
                  "1",
                  "2",
                  "3",
                  "4",
                  "5",
                  "6",
                  "7",
                  "8",
                  "9",
                  ".",
                  "0",
                  "⌫",
                ].map((key) => (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={key === "⌫" ? "Delete digit" : key}
                    onPress={() =>
                      setAmount((value) =>
                        key === "⌫"
                          ? value.slice(0, -1) || "0"
                          : key === "."
                            ? currency === "JPY" || value.includes(".")
                              ? value
                              : value + "."
                            : value.includes(".") &&
                                value.split(".")[1].length >= 2
                              ? value
                              : value === "0"
                                ? key
                                : value + key,
                      )
                    }
                    style={s.key}
                  >
                    <Text style={s.title}>{key}</Text>
                  </Pressable>
                ))}
              </View>
              {button("Done", () => setCalculator(false))}
            </View>
          </View>
        </Modal>
        {phase === "loading" ? (
          <Text style={s.copy}>Opening your local account…</Text>
        ) : phase === "error" || phase === "closed" ? (
          <View style={s.content}>
            <Text style={s.title}>
              {phase === "closed"
                ? "Database closed"
                : "Unable to open your data"}
            </Text>
            <Text style={s.copy}>
              Your existing storage stays on this device.
            </Text>
            {button("Retry opening", () => {
              setPhase("loading");
              setError("");
              void load();
            })}
          </View>
        ) : saved ? (
          <View style={s.content}>
            <Text style={s.title}>Welcome, {saved.preferred_name}.</Text>
            <Text style={s.copy}>
              {celebrating
                ? "Your first account is ready. A little clarity starts here."
                : "Your first account is ready."}
            </Text>
            {celebrating
              ? button("See my account", () => setCelebrating(false))
              : null}
            <View style={s.account}>
              <Text style={s.label}>{saved.account_name}</Text>
              <Text style={s.balance}>
                {new Intl.NumberFormat("en-PH", {
                  style: "currency",
                  currency: saved.currency_code,
                }).format(
                  saved.opening_balance_minor /
                    (saved.currency_code === "JPY" ? 1 : 100),
                )}
              </Text>
            </View>
            <Text style={s.copy}>
              Saved on this device. No sign-in required.
            </Text>
            {button("Close database", () => void close())}
          </View>
        ) : (
          <View style={s.content}>
            <Animated.View
              key={`${step}-${intro}`}
              entering={FadeIn.duration(300).reduceMotion(ReduceMotion.System)}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Wake Kuwi"
                onPress={() => setAwake(true)}
              >
                <Image
                  source={{ uri: "/quokka.png" }}
                  style={s.mascot}
                  accessibilityLabel="Kuwi the quokka"
                />
              </Pressable>
              {step === 0 ? (
                <Text style={s.mascotHint}>
                  {awake
                    ? "Hello. Ready when you are."
                    : "Tap Kuwi to say hello"}
                </Text>
              ) : null}
            </Animated.View>
            {step === 0 ? (
              <>
                <Text style={s.title}>Make yourself at home.</Text>
                <Text style={s.copy}>
                  Start with your name and the money you have today.
                </Text>
                {button("Continue offline", () => setStep(1))}
                <Text style={s.note}>
                  Safari and the Home Screen app keep separate local data.
                </Text>
              </>
            ) : step === 1 ? (
              <>
                <Text style={s.title}>What should Kuwi call you?</Text>
                <Text style={s.label}>Preferred name</Text>
                <TextInput
                  accessibilityLabel="Preferred name"
                  value={name}
                  onChangeText={setName}
                  autoComplete="given-name"
                  maxLength={100}
                  style={s.input}
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    if (name.trim()) setStep(4);
                  }}
                />
                {button("Next", () => setStep(4), !name.trim())}
              </>
            ) : step === 4 ? (
              <>
                <Text style={s.title}>
                  {
                    [
                      "A little more clarity.",
                      "A place for every peso.",
                      "Room for your plans.",
                    ][intro]
                  }
                </Text>
                <Text style={s.copy}>
                  {
                    [
                      "See where your money goes, one day at a time.",
                      "Start with the cash or account you use most.",
                      "Build from what you have today.",
                    ][intro]
                  }
                </Text>
                {button("Next", () => {
                  if (intro < 2) setIntro(intro + 1);
                  else setStep(2);
                })}
                {button("Skip introduction", () => setStep(2))}
              </>
            ) : step === 2 ? (
              <>
                <Text style={s.title}>Your main currency</Text>
                <Text style={s.copy}>
                  {currencies.find((item) => item[0] === currency)?.[1]} (
                  {currency})
                </Text>
                {currencies.map(([code, label]) => (
                  <Pressable
                    key={code}
                    accessibilityRole="button"
                    accessibilityLabel={`${code} ${label}`}
                    accessibilityState={{ selected: currency === code }}
                    onPress={() => setCurrency(code)}
                    style={[
                      s.input,
                      currency === code && {
                        borderColor: sage,
                        borderWidth: 2,
                      },
                    ]}
                  >
                    <Text style={s.label}>
                      {code} {label}
                      {currency === code ? "  ✓" : ""}
                    </Text>
                  </Pressable>
                ))}
                {button("Next", () => setStep(3))}
                {button("Back", () => setStep(1))}
              </>
            ) : (
              <>
                <Text style={s.title}>Your first account</Text>
                <Text style={s.label}>Account name</Text>
                <TextInput
                  accessibilityLabel="Account name"
                  value={account}
                  onChangeText={setAccount}
                  style={s.input}
                />
                <Text style={s.label}>Opening balance ({currency})</Text>
                <TextInput
                  accessibilityLabel={`Opening balance (${currency})`}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  style={s.input}
                />
                {button("Use number pad", () => setCalculator(true))}
                <Text style={s.note}>Leave the name blank to use Cash.</Text>
                {button(
                  saving ? "Saving…" : "Save my account",
                  () => void finish(),
                  saving,
                )}
                {button("Back", () => setStep(2), saving)}
              </>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#293c3266",
  },
  calculator: {
    backgroundColor: cream,
    padding: 24,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 20,
  },
  keys: { flexDirection: "row", flexWrap: "wrap" },
  key: { width: "33.33%", padding: 16, alignItems: "center" },
  page: { flexGrow: 1, backgroundColor: cream, padding: 24 },
  shell: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    paddingTop: 24,
    paddingBottom: 32,
  },
  brand: { color: ink, fontSize: 32, fontWeight: "800", marginBottom: 24 },
  content: { gap: 18 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: "700", color: ink },
  copy: { fontSize: 17, lineHeight: 26, color: ink },
  label: { fontSize: 16, fontWeight: "600", color: ink },
  note: { fontSize: 14, lineHeight: 22, color: "#526355" },
  mascotHint: {
    textAlign: "center",
    color: "#526355",
    fontSize: 13,
    marginTop: 12,
  },
  mascot: {
    width: 220,
    height: 220,
    alignSelf: "center",
    resizeMode: "contain",
    borderRadius: 110,
  },
  input: {
    padding: 18,
    borderWidth: 1,
    borderColor: "#83927e",
    borderRadius: 14,
    fontSize: 18,
    color: ink,
    backgroundColor: "#fffdf7",
  },
  button: {
    padding: 18,
    borderRadius: 14,
    backgroundColor: sage,
    alignItems: "center",
  },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  error: {
    backgroundColor: "#fae7de",
    color: "#752e1a",
    padding: 16,
    marginBottom: 20,
    borderRadius: 12,
  },
  account: {
    backgroundColor: "#e2e9d9",
    padding: 24,
    borderRadius: 16,
    gap: 12,
  },
  balance: { fontSize: 36, fontWeight: "600", color: ink },
});
