import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { Account } from "../storage/client";

type WalletGroup = { id: string; name: string };
type WalletPreferences = { groups: WalletGroup[]; assignments: Record<string, string> };
const preferencesKey = "kuwi-wallet-groups-v1";
const visibilityKey = "kuwi-wallet-balances-hidden-v1";
const ink = "var(--kuwi-ink)";
const sage = "var(--kuwi-accent-button)";

/** Draw the disclosure chevron for an expanded or collapsed account group.
 * @param expanded - Whether the group's accounts are currently visible.
 */
function DisclosureIcon({ expanded }: { expanded: boolean }) {
  const path = expanded ? "m6 14 6-6 6 6" : "m6 10 6 6 6-6";
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
      <Path d={path} fill="none" stroke="var(--kuwi-ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Read and validate wallet grouping preferences, falling back to an empty layout.
 * Invalid or orphaned assignments are ignored so every saved account remains visible.
 * @returns Valid group definitions and assignments from local storage, or defaults.
 */
function readPreferences(): WalletPreferences {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(preferencesKey);
    if (!raw) return { groups: [], assignments: {} };
    const value = JSON.parse(raw) as Partial<WalletPreferences>;
    const groups = Array.isArray(value.groups)
      ? value.groups.filter((group): group is WalletGroup => Boolean(group && typeof group.id === "string" && typeof group.name === "string"))
      : [];
    const groupIds = new Set(groups.map((group) => group.id));
    const assignments = value.assignments && typeof value.assignments === "object" && !Array.isArray(value.assignments)
      ? Object.fromEntries(
        Object.entries(value.assignments).filter(([, groupId]) => typeof groupId === "string" && groupIds.has(groupId)),
      ) as Record<string, string>
      : {};
    return {
      groups,
      assignments,
    };
  } catch {
    return { groups: [], assignments: {} };
  }
}

/** Read the device-local balance masking preference, defaulting to visible.
 * @returns `true` only when the saved preference hides balances.
 */
function readBalancesHidden() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(visibilityKey) === "true";
  } catch {
    return false;
  }
}

/** Render account cards with user-named groups stored as local presentation preferences.
 * @param accounts - Saved accounts with canonical balances and currency metadata.
 * @param formatMoney - Formats a balance using the account's currency.
 * @param onOpenAccount - Opens an account's existing finance workspace.
 * @param onEditAccount - Opens the account editor.
 * @param onAddAccount - Starts account creation.
 * @param onOpenDataManagement - Opens backup and restore tools.
 * @param onOpenTroubleshooting - Opens local storage troubleshooting.
 */
export function WalletWorkspace({
  accounts,
  formatMoney,
  onOpenAccount,
  onEditAccount,
  onAddAccount,
  onOpenDataManagement,
  onOpenTroubleshooting,
}: {
  accounts: Account[];
  formatMoney: (amount: number, currency: string) => string;
  onOpenAccount: (account: Account) => void;
  onEditAccount: (account: Account) => void;
  onAddAccount: () => void;
  onOpenDataManagement: () => void;
  onOpenTroubleshooting: () => void;
}) {
  const [preferences, setPreferences] = useState(readPreferences);
  const [hidden, setHidden] = useState(readBalancesHidden);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [groupName, setGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [movingAccount, setMovingAccount] = useState<Account | null>(null);
  const [preferenceError, setPreferenceError] = useState("");

  /** Save a new group layout; keep the in-memory change visible if storage rejects it.
   * @param next - Complete group and account-assignment preference set.
   */
  function savePreferences(next: WalletPreferences) {
    setPreferences(next);
    try {
      window.localStorage.setItem(preferencesKey, JSON.stringify(next));
      setPreferenceError("");
    } catch {
      setPreferenceError("Wallet grouping could not be saved on this device.");
    }
  }

  /** Toggle balance masking and persist the choice on this device. */
  function toggleVisibility() {
    const next = !hidden;
    setHidden(next);
    try {
      window.localStorage.setItem(visibilityKey, String(next));
      setPreferenceError("");
    } catch {
      setPreferenceError("Balance visibility could not be saved on this device.");
    }
  }

  /** Add the entered group unless it is blank or duplicates an existing name.
   * A duplicate name reports an inline error; blank input is ignored.
   */
  function addGroup() {
    const trimmed = groupName.trim();
    if (!trimmed) return;
    if (preferences.groups.some((group) => group.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      setPreferenceError("Choose a different group name.");
      return;
    }
    savePreferences({
      ...preferences,
      groups: [...preferences.groups, { id: crypto.randomUUID(), name: trimmed }],
    });
    setGroupName("");
    setCreatingGroup(false);
  }

  /** Assign the selected account to a group, or to Other accounts when omitted.
   * @param groupId - Existing group ID; omit it to clear the assignment.
   */
  function moveTo(groupId?: string) {
    if (!movingAccount) return;
    const assignments = { ...preferences.assignments };
    if (groupId) assignments[movingAccount.id] = groupId;
    else delete assignments[movingAccount.id];
    savePreferences({ ...preferences, assignments });
    setMovingAccount(null);
  }

  const groups = preferences.groups.map((group) => ({
    ...group,
    accounts: accounts.filter((account) => preferences.assignments[account.id] === group.id),
  }));
  const groupIds = new Set(preferences.groups.map((group) => group.id));
  const ungrouped = accounts.filter((account) => !groupIds.has(preferences.assignments[account.id]));
  const sections = [...groups, { id: "__other__", name: "Other accounts", accounts: ungrouped }];

  return (
    <View style={styles.workspace}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>Wallet</Text>
          <Text accessibilityRole="header" nativeID="route-heading" style={styles.sectionTitle}>Your accounts</Text>
          <Text style={styles.note}>{accounts.length} {accounts.length === 1 ? "account" : "accounts"} saved on this device</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hidden ? "Show balances" : "Hide balances"}
          accessibilityState={{ selected: hidden }}
          aria-pressed={hidden}
          onPress={toggleVisibility}
          style={styles.visibilityButton}
        >
          <Text style={styles.actionText}>{hidden ? "Show balances" : "Hide balances"}</Text>
        </Pressable>
      </View>

      {preferenceError ? <Text accessibilityRole="alert" style={styles.error}>{preferenceError}</Text> : null}
      {sections.map((group) => {
        const isCollapsed = Boolean(collapsed[group.id]);
        return (
          <View key={group.id} style={styles.group}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${group.name}, ${group.accounts.length} ${group.accounts.length === 1 ? "account" : "accounts"}`}
              accessibilityState={{ expanded: !isCollapsed }}
              aria-expanded={!isCollapsed}
              onPress={() => setCollapsed((current) => ({ ...current, [group.id]: !current[group.id] }))}
              style={styles.groupHeader}
            >
              <View style={styles.groupHeadingCopy}>
                <Text style={styles.groupTitle}>{group.name}</Text>
                <Text style={styles.note}>{group.accounts.length} {group.accounts.length === 1 ? "account" : "accounts"}</Text>
              </View>
              <DisclosureIcon expanded={!isCollapsed} />
            </Pressable>
            {!isCollapsed ? group.accounts.map((account) => (
              <View key={account.id} style={styles.accountCard}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View account ${account.name}`}
                  onPress={() => onOpenAccount(account)}
                  style={styles.accountOpen}
                >
                  <View style={styles.accountHeading}>
                    <Text style={styles.accountName}>{account.name}</Text>
                    <Text style={styles.balance}>{hidden ? "••••••" : formatMoney(account.balance_minor, account.currency_code)}</Text>
                  </View>
                  <Text style={styles.note}>
                    {account.type === "assets" ? "Assets" : account.type === "credit" ? "Credit" : "Debit"} account · {account.currency_code}
                  </Text>
                  {account.type === "credit" && account.credit_limit_minor !== null ? (
                    <Text style={styles.note}>Credit limit {hidden ? "••••••" : formatMoney(account.credit_limit_minor, account.currency_code)}</Text>
                  ) : null}
                  <Text style={styles.viewText}>View account</Text>
                </Pressable>
                <View style={styles.cardActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit account ${account.name}`}
                    onPress={() => onEditAccount(account)}
                    style={styles.moveButton}
                  >
                    <Text style={styles.actionText}>Edit account</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${account.name} to a group`}
                    onPress={() => setMovingAccount(account)}
                    style={styles.moveButton}
                  >
                    <Text style={styles.actionText}>Move to group</Text>
                  </Pressable>
                </View>
              </View>
            )) : null}
            {group.id !== "__other__" && group.accounts.length === 0 ? (
              <Text style={styles.emptyGroup}>Move an account here when you are ready.</Text>
            ) : null}
          </View>
        );
      })}

      {accounts.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.groupTitle}>Your wallet is ready</Text>
          <Text style={styles.note}>Add an account to see its balance and activity here.</Text>
        </View>
      ) : null}
      {creatingGroup ? (
        <View style={styles.createGroup}>
          <Text style={styles.groupTitle}>New group</Text>
          <TextInput
            accessibilityLabel="Group name"
            value={groupName}
            onChangeText={setGroupName}
            maxLength={50}
            onSubmitEditing={addGroup}
            placeholder="For example, Everyday"
            style={styles.input}
          />
          <View style={styles.inlineActions}>
            <Pressable accessibilityRole="button" onPress={addGroup} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Create group</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setCreatingGroup(false); setGroupName(""); }} style={styles.secondaryButton}>
              <Text style={styles.actionText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setCreatingGroup(true)} style={styles.secondaryButton}>
          <Text style={styles.actionText}>Create a group</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" onPress={onAddAccount} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Add account</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onOpenDataManagement} style={styles.secondaryButton}>
        <Text style={styles.actionText}>Data management</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onOpenTroubleshooting} style={styles.secondaryButton}>
        <Text style={styles.actionText}>Database troubleshooting</Text>
      </Pressable>

      <Modal transparent visible={Boolean(movingAccount)} animationType="slide" onRequestClose={() => setMovingAccount(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.groupTitle}>Move {movingAccount?.name}</Text>
            <Text style={styles.note}>Choose where this account appears in Wallet.</Text>
            <ScrollView style={styles.groupChoices}>
              <Pressable accessibilityRole="button" onPress={() => moveTo()} style={styles.groupChoice}>
                <Text style={styles.actionText}>Other accounts</Text>
              </Pressable>
              {preferences.groups.map((group) => (
                <Pressable key={group.id} accessibilityRole="button" onPress={() => moveTo(group.id)} style={styles.groupChoice}>
                  <Text style={styles.actionText}>{group.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={() => setMovingAccount(null)} style={styles.secondaryButton}>
              <Text style={styles.actionText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  workspace: { gap: 18 },
  heading: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  headingCopy: { flex: 1, minWidth: 170, gap: 4 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: "700", color: ink },
  sectionTitle: { fontSize: 19, lineHeight: 25, fontWeight: "600", color: ink },
  note: { color: "var(--kuwi-secondary-text)", fontSize: 14, lineHeight: 21 },
  group: { gap: 12 },
  groupHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "var(--kuwi-divider)" },
  groupHeadingCopy: { gap: 3 },
  groupTitle: { color: ink, fontSize: 19, lineHeight: 26, fontWeight: "700" },
  accountCard: { padding: 16, gap: 12, borderRadius: 16, backgroundColor: "var(--kuwi-surface)", borderWidth: 1, borderColor: "var(--kuwi-border)" },
  accountOpen: { gap: 8 },
  accountHeading: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  accountName: { flex: 1, minWidth: 120, color: ink, fontSize: 18, lineHeight: 24, fontWeight: "700" },
  balance: { flexShrink: 1, color: ink, fontSize: 19, lineHeight: 25, fontWeight: "700", fontVariant: ["tabular-nums"] },
  viewText: { color: "var(--kuwi-accent-text)", fontSize: 14, lineHeight: 20, fontWeight: "700" },
  moveButton: { alignSelf: "flex-start", paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--kuwi-page)" },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionText: { color: ink, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  visibilityButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "var(--kuwi-selected)" },
  emptyGroup: { color: "var(--kuwi-secondary-text)", fontSize: 14, lineHeight: 20, paddingVertical: 8 },
  emptyState: { padding: 20, gap: 8, borderRadius: 18, backgroundColor: "var(--kuwi-selected)" },
  createGroup: { gap: 12, padding: 16, borderRadius: 18, backgroundColor: "var(--kuwi-selected)" },
  input: { padding: 13, borderWidth: 1, borderColor: "var(--kuwi-border)", borderRadius: 12, fontSize: 16, color: ink, backgroundColor: "var(--kuwi-surface)" },
  inlineActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  primaryButton: { alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: sage },
  primaryButtonText: { color: "#ffffff", fontSize: 16, lineHeight: 22, fontWeight: "700" },
  secondaryButton: { alignItems: "center", padding: 13, borderRadius: 14, borderWidth: 1, borderColor: sage, backgroundColor: "var(--kuwi-surface)" },
  error: { color: "var(--kuwi-error-fg)", padding: 12, borderRadius: 12, backgroundColor: "var(--kuwi-error-bg)" },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "color-mix(in srgb, var(--kuwi-ink) 40%, transparent)" },
  sheet: { maxHeight: "78%", padding: 22, gap: 12, paddingBottom: "max(22px, env(safe-area-inset-bottom))", borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: "var(--kuwi-page)" },
  groupChoices: { flexShrink: 1 },
  groupChoice: { padding: 16, marginBottom: 8, borderRadius: 12, backgroundColor: "var(--kuwi-surface)" },
});
