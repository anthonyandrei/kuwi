import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import type { Account, DashboardTransaction, DashboardTransfer, HomeDashboard } from "../storage/client";
import { Quokka, type QuokkaPose } from "../mascot/Quokka";
import { dateLabel, homePeriod, localCalendarDate, type HomePeriod } from "./periods";

const ink = "var(--kuwi-ink)";
const card = "var(--kuwi-surface)";
const palette = ["#4f7655", "#b77a52", "#d3a451", "#7189a1", "#92728f", "#80935c"];
const periodOptions: { key: HomePeriod; label: string }[] = [
  { key: "daily", label: "Day" },
  { key: "weekly", label: "Week" },
  { key: "monthly", label: "Month" },
];

/** Format stored minor units using the account currency's fractional precision.
 * @param amountMinor - Integer amount in minor currency units.
 * @param currency - ISO 4217 currency code.
 * @param decimalPlaces - Number of fractional digits for the currency.
 * @returns A localized currency amount.
 */
function formattedMoney(amountMinor: number, currency: string, decimalPlaces: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(amountMinor / 10 ** decimalPlaces);
}

/** Build an SVG wedge path for an angular slice of the category chart.
 * @param startDegrees - Slice start angle measured clockwise from the x-axis.
 * @param endDegrees - Slice end angle, greater than the start angle.
 * @param radius - Wedge radius in the chart's 144-unit view box.
 * @returns An SVG path centered at (72, 72).
 */
function pieSlicePath(startDegrees: number, endDegrees: number, radius: number) {
  /** Locate an angle on the chart circle centered at (72, 72). */
  const point = (degrees: number) => {
    const radians = degrees * Math.PI / 180;
    return { x: 72 + radius * Math.cos(radians), y: 72 + radius * Math.sin(radians) };
  };
  const start = point(startDegrees);
  const end = point(endDegrees);
  const largeArc = endDegrees - startDegrees > 180 ? 1 : 0;
  return `M 72 72 L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

/** Draw the category breakdown; the adjacent text list carries the exact values.
 * @param categories - Nonnegative minor-unit totals in display order.
 * @returns A ring for an empty period or a labeled category pie chart.
 */
function SpendingChart({ categories }: { categories: { label: string; amount: number }[] }) {
  const total = categories.reduce((sum, category) => sum + category.amount, 0);
  if (total <= 0) {
    return (
      <Svg width={144} height={144} viewBox="0 0 144 144" accessibilityRole="image" accessibilityLabel="No spending recorded in this period">
        <Circle cx="72" cy="72" r="56" fill="none" stroke="var(--kuwi-divider)" strokeWidth="22" />
      </Svg>
    );
  }
  const slices = categories.reduce<{ angle: number; paths: { key: string; path: string; color: string }[] }>((current, category, index) => {
    const end = current.angle + category.amount / total * 360;
    const path = category.amount === total
      ? `M 72 15 A 57 57 0 1 1 71.99 15 Z`
      : pieSlicePath(current.angle, end, 57);
    return {
      angle: end,
      paths: [...current.paths, { key: category.label, path, color: palette[index % palette.length] }],
    };
  }, { angle: -90, paths: [] }).paths;
  return (
    <Svg width={144} height={144} viewBox="0 0 144 144" accessibilityRole="image" accessibilityLabel="Spending by category, with amounts listed below">
      {slices.map((slice) => <Path key={slice.key} d={slice.path} fill={slice.color} />)}
      <Circle cx="72" cy="72" r="35" fill={card} />
      <Circle cx="72" cy="72" r="57" fill="none" stroke={card} strokeWidth="2" />
    </Svg>
  );
}

type TimelineItem = {
  id: string;
  date: string;
  createdAt: string;
  kind: "expense" | "income" | "transfer";
  accountId: string;
  title: string;
  subtitle: string;
  amount: string;
  planned: boolean;
};

/** Merge finance rows into the most recent twelve dated activity entries.
 * @param transactions - Posted and planned income or expense records.
 * @param transfers - Saved account-to-account transfers.
 * @returns Display rows sorted newest first, with each row's own currency.
 */
function timelineItems(
  transactions: DashboardTransaction[],
  transfers: DashboardTransfer[],
): TimelineItem[] {
  const transactionItems = transactions.map((item): TimelineItem => ({
    id: `${item.kind}:${item.id}`,
    date: item.date,
    createdAt: item.created_at,
    kind: item.kind,
    accountId: item.account_id,
    title: item.category_label ?? (item.kind === "income" ? "Income" : "Expense"),
    subtitle: `${item.account_name} · ${item.note || (item.kind === "income" ? "Income" : "Expense")}`,
    amount: `${item.kind === "income" ? "+" : "−"}${formattedMoney(item.planned ? item.planned_amount_minor ?? item.amount_minor : item.amount_minor, item.currency_code, item.decimal_places)} ${item.currency_code}`,
    planned: Boolean(item.planned),
  }));
  const transferItems = transfers.map((item): TimelineItem => ({
    id: `transfer:${item.id}`,
    date: item.date,
    createdAt: item.created_at,
    kind: "transfer",
    accountId: item.from_account_id,
    title: "Transfer",
    subtitle: `${item.from_account_name} to ${item.to_account_name}${item.note ? ` · ${item.note}` : ""}`,
    amount: item.from_currency_code === item.to_currency_code
      ? `${formattedMoney(item.amount_minor, item.from_currency_code, item.from_decimal_places)} ${item.from_currency_code}`
      : `${formattedMoney(item.amount_minor, item.from_currency_code, item.from_decimal_places)} ${item.from_currency_code} → ${formattedMoney(item.received_amount_minor, item.to_currency_code, item.to_decimal_places)} ${item.to_currency_code}`,
    planned: false,
  }));
  return [...transactionItems, ...transferItems]
    .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, 12);
}

/** Summarize saved activity by currency and the documented budget calendar boundaries.
 * @param dashboard - Canonical profile, accounts, categories, and finance records.
 * @param celebrationId - Increasing ID for a completed action, or zero when none is pending.
 * @param onOpenHistory - Opens the referenced account's transaction history.
 * @param onAddExpense - Opens expense entry for the selected account.
 * @param onReactionShown - Acknowledges a completed mascot reaction.
 */
export function HomeWorkspace({
  dashboard,
  celebrationId,
  onOpenHistory,
  onAddExpense,
  onReactionShown,
}: {
  dashboard: HomeDashboard;
  celebrationId: number;
  onOpenHistory: (accountId: string) => void;
  onAddExpense: (account: Account) => void;
  onReactionShown: (celebrationId: number) => void;
}) {
  const reduceMotion = Boolean(useReducedMotion());
  const compact = useWindowDimensions().width < 360;
  const [period, setPeriod] = useState<HomePeriod>("weekly");
  const [currency, setCurrency] = useState(() => {
    const available = new Set(dashboard.accounts.map((account) => account.currency_code));
    return available.has(dashboard.preferred_currency) ? dashboard.preferred_currency : dashboard.accounts[0]?.currency_code ?? dashboard.preferred_currency;
  });
  const [pose, setPose] = useState<QuokkaPose>("greeting");
  const [mascotActive, setMascotActive] = useState(true);
  const availableCurrencies = [...new Set(dashboard.accounts.map((account) => account.currency_code))];
  const selectedAccount = dashboard.accounts.find((account) => account.currency_code === currency) ?? dashboard.accounts[0];
  const decimalPlaces = selectedAccount?.decimal_places ?? (currency === "JPY" ? 0 : 2);
  const today = localCalendarDate();
  const range = homePeriod(period, today, dashboard.monthly_cycle_start_day);
  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of dashboard.transactions) {
      if (item.kind !== "expense" || item.currency_code !== currency || item.date < range.start || item.date > range.end || item.planned) continue;
      const label = item.category_label ?? "Other";
      totals.set(label, (totals.get(label) ?? 0) + item.amount_minor);
    }
    return [...totals].map(([label, amount]) => ({ label, amount })).sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label));
  }, [dashboard.transactions, currency, range.start, range.end]);
  const incomeMinor = dashboard.transactions
    .filter((item) => item.kind === "income" && item.currency_code === currency && item.date >= range.start && item.date <= range.end && !item.planned)
    .reduce((sum, item) => sum + item.amount_minor, 0);
  const expenseMinor = categoryTotals.reduce((sum, item) => sum + item.amount, 0);
  const chartCategories = categoryTotals.length > 6
    ? [...categoryTotals.slice(0, 5), { label: "Other", amount: categoryTotals.slice(5).reduce((sum, item) => sum + item.amount, 0) }]
    : categoryTotals;
  const recent = useMemo(() => timelineItems(dashboard.transactions, dashboard.transfers), [dashboard.transactions, dashboard.transfers]);

  useEffect(() => {
    const timeout = setTimeout(() => setPose("idle"), reduceMotion ? 0 : 1200);
    return () => clearTimeout(timeout);
  }, [reduceMotion]);

  useEffect(() => {
    if (celebrationId <= 0) return;
    let finish: ReturnType<typeof setTimeout>;
    const start = setTimeout(() => {
      if (!reduceMotion) setPose("celebrate");
      finish = setTimeout(() => {
        setPose("idle");
        onReactionShown(celebrationId);
      }, reduceMotion ? 0 : 1000);
    }, 0);
    return () => {
      clearTimeout(start);
      clearTimeout(finish);
    };
  }, [celebrationId, onReactionShown, reduceMotion]);

  useEffect(() => {
    const element = document.getElementById("kuwi-home-mascot");
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setMascotActive(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rangeText = range.start === range.end ? dateLabel(range.start) : `${dateLabel(range.start)} to ${dateLabel(range.end)}`;
  const dateGroups = new Map<string, TimelineItem[]>();
  for (const item of recent) dateGroups.set(item.date, [...(dateGroups.get(item.date) ?? []), item]);
  const anyActivity = dashboard.transactions.length > 0 || dashboard.transfers.length > 0;

  return (
    <View style={styles.workspace}>
      <View style={[styles.hero, compact && styles.heroCompact]}>
        <View style={[styles.heroCopy, compact && styles.heroCopyCompact]}>
          <Text accessibilityRole="header" nativeID="route-heading" style={[styles.title, compact && styles.titleCompact]}>Welcome, {dashboard.preferred_name}.</Text>
          <Text style={styles.heroMessage}>Your money check-in is ready.</Text>
          <Text style={styles.heroNote}>A friendly quokka to keep you company.</Text>
        </View>
        <View nativeID="kuwi-home-mascot" style={[styles.mascot, compact && styles.mascotCompact]}>
          <Quokka pose={pose} active={mascotActive} reduceMotion={reduceMotion} />
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <View style={styles.sectionCopy}>
            <Text style={styles.sectionTitle}>Your activity</Text>
            <Text style={styles.note}>{rangeText}</Text>
          </View>
          <View accessibilityRole="tablist" style={styles.periods}>
            {periodOptions.map((option) => (
              <Pressable
                key={option.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: period === option.key }}
                aria-selected={period === option.key}
                onPress={() => setPeriod(option.key)}
                style={[styles.periodButton, period === option.key && styles.periodSelected]}
              >
                <Text style={[styles.periodText, period === option.key && styles.periodTextSelected]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {availableCurrencies.length > 1 ? (
          <View style={styles.currencies}>
            <Text style={styles.note}>Currency</Text>
            {availableCurrencies.map((code) => (
              <Pressable
                key={code}
                accessibilityRole="button"
                accessibilityState={{ selected: currency === code }}
                onPress={() => setCurrency(code)}
                style={[styles.currencyButton, currency === code && styles.currencySelected]}
              >
                <Text style={[styles.currencyText, currency === code && styles.periodTextSelected]}>{code}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Income</Text>
            <Text style={styles.summaryAmount}>{formattedMoney(incomeMinor, currency, decimalPlaces)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Expenses</Text>
            <Text style={styles.summaryAmount}>{formattedMoney(expenseMinor, currency, decimalPlaces)}</Text>
          </View>
        </View>
        {availableCurrencies.length > 1 ? (
          <Text style={styles.note}>Totals use {currency} records. Other currencies are shown separately.</Text>
        ) : null}
        {!dashboard.transactions.some((item) => item.currency_code === currency && item.planned) ? null : (
          <Text style={styles.note}>Planned entries are not included in these totals.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Spending by category</Text>
        {categoryTotals.length ? (
          <View style={styles.chartCard}>
            <SpendingChart categories={chartCategories} />
            <View style={styles.categoryList}>
              {categoryTotals.map((item, index) => (
                <View key={item.label} style={styles.categoryRow}>
                  <View style={[styles.dot, { backgroundColor: palette[index % palette.length] }]} />
                  <Text style={styles.categoryName}>{item.label}</Text>
                  <Text style={styles.categoryAmount}>{formattedMoney(item.amount, currency, decimalPlaces)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <SpendingChart categories={[]} />
            <Text style={styles.note}>No posted expenses in this period.</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <View style={styles.sectionCopy}>
            <Text style={styles.sectionTitle}>Recent activity</Text>
            <Text style={styles.note}>Entries are grouped by their saved date.</Text>
          </View>
          {selectedAccount ? (
            <Pressable accessibilityRole="button" onPress={() => onOpenHistory(selectedAccount.id)} style={styles.smallAction}>
              <Text style={styles.smallActionText}>History</Text>
            </Pressable>
          ) : null}
        </View>
        {!anyActivity ? (
          <View style={styles.emptyCard}>
            <Text style={styles.sectionTitle}>Nothing recorded yet</Text>
            <Text style={styles.note}>Add an income or expense and it will appear here.</Text>
            {dashboard.accounts[0] ? (
              <Pressable accessibilityRole="button" onPress={() => onAddExpense(dashboard.accounts[0])} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Add an expense</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.timeline}>
            {[...dateGroups].map(([date, items]) => (
              <View key={date} style={styles.timelineDay}>
                <Text style={styles.dateHeading}>{dateLabel(date)}</Text>
                {items.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.planned ? "Planned " : ""}${item.kind}, ${item.title}, ${item.amount}, ${item.subtitle}`}
                    onPress={() => onOpenHistory(item.accountId)}
                    style={styles.timelineItem}
                  >
                    <View style={styles.timelineMark}>
                      <View style={[styles.timelineDot, item.kind === "income" ? styles.incomeDot : item.kind === "transfer" ? styles.transferDot : styles.expenseDot]} />
                      <View style={styles.timelineLine} />
                    </View>
                    <View style={styles.timelineCopy}>
                      <View style={styles.timelineHeading}>
                        <Text style={styles.timelineTitle}>{item.title}</Text>
                        <Text style={[styles.timelineAmount, item.kind === "income" && styles.incomeAmount]}>{item.amount}</Text>
                      </View>
                      <Text style={styles.note} numberOfLines={2}>{item.subtitle}</Text>
                      {item.planned ? <Text style={styles.plannedLabel}>Planned</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  workspace: { gap: 26 },
  hero: { minHeight: 164, flexDirection: "row", alignItems: "center", overflow: "hidden", padding: 20, borderRadius: 20, backgroundColor: "var(--kuwi-selected)" },
  heroCompact: { flexDirection: "column", alignItems: "stretch", gap: 12, padding: 16 },
  heroCopy: { flex: 1, minWidth: 135, gap: 8 },
  heroCopyCompact: { width: "100%", minWidth: 0 },
  title: { maxWidth: 250, color: ink, fontSize: 29, lineHeight: 35, fontWeight: "800" },
  titleCompact: { maxWidth: "100%", fontSize: 25, lineHeight: 31 },
  heroMessage: { color: ink, fontSize: 16, lineHeight: 23, fontWeight: "600" },
  heroNote: { color: "var(--kuwi-secondary-text)", fontSize: 13, lineHeight: 19 },
  mascot: { flexShrink: 0, width: 130, height: 132, marginLeft: -6 },
  mascotCompact: { alignSelf: "center", width: 112, height: 112, marginLeft: 0 },
  section: { gap: 14 },
  sectionHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 },
  sectionCopy: { flex: 1, minWidth: 170, gap: 3 },
  sectionTitle: { color: ink, fontSize: 20, lineHeight: 26, fontWeight: "700" },
  note: { color: "var(--kuwi-secondary-text)", fontSize: 14, lineHeight: 21 },
  periods: { flexDirection: "row", padding: 4, borderRadius: 14, backgroundColor: "var(--kuwi-selected)" },
  periodButton: { alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  periodSelected: { backgroundColor: "var(--kuwi-surface)" },
  periodText: { color: "var(--kuwi-secondary-text)", fontSize: 14, lineHeight: 20, fontWeight: "600" },
  periodTextSelected: { color: ink },
  currencies: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  currencyButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "var(--kuwi-selected)" },
  currencySelected: { backgroundColor: "var(--kuwi-accent-button)" },
  currencyText: { color: ink, fontSize: 13, fontWeight: "700" },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  summaryCard: { flex: 1, minWidth: 140, gap: 7, padding: 16, borderRadius: 18, backgroundColor: "var(--kuwi-surface)" },
  summaryLabel: { color: "var(--kuwi-secondary-text)", fontSize: 14, lineHeight: 20, fontWeight: "600" },
  summaryAmount: { flexShrink: 1, color: ink, fontSize: 20, lineHeight: 27, fontWeight: "800", fontVariant: ["tabular-nums"] },
  chartCard: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 18, padding: 16, borderRadius: 16, backgroundColor: card },
  categoryList: { flex: 1, minWidth: 175, gap: 10 },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  categoryName: { flex: 1, color: ink, fontSize: 14, lineHeight: 20 },
  categoryAmount: { color: ink, fontSize: 14, lineHeight: 20, fontWeight: "600", fontVariant: ["tabular-nums"] },
  emptyCard: { alignItems: "center", gap: 12, padding: 20, borderRadius: 16, backgroundColor: card },
  smallAction: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "var(--kuwi-selected)" },
  smallActionText: { color: ink, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  timeline: { gap: 18 },
  timelineDay: { gap: 10 },
  dateHeading: { color: "var(--kuwi-secondary-text)", fontSize: 14, lineHeight: 20, fontWeight: "700" },
  timelineItem: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 16, backgroundColor: card },
  timelineMark: { alignItems: "center", width: 14, paddingTop: 5 },
  timelineDot: { width: 10, height: 10, borderRadius: 5 },
  incomeDot: { backgroundColor: "#638b68" },
  expenseDot: { backgroundColor: "#b77a52" },
  transferDot: { backgroundColor: "#7189a1" },
  timelineLine: { flex: 1, width: 2, marginTop: 5, backgroundColor: "var(--kuwi-divider)" },
  timelineCopy: { flex: 1, minWidth: 0, gap: 5 },
  timelineHeading: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 6 },
  timelineTitle: { flex: 1, minWidth: 95, color: ink, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  timelineAmount: { flexShrink: 1, color: ink, fontSize: 15, lineHeight: 21, fontWeight: "700", fontVariant: ["tabular-nums"] },
  incomeAmount: { color: "#527454" },
  plannedLabel: { alignSelf: "flex-start", color: "var(--kuwi-warning-fg)", fontSize: 12, lineHeight: 17, fontWeight: "700", paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, backgroundColor: "var(--kuwi-warning-bg)" },
  primaryButton: { alignSelf: "stretch", alignItems: "center", padding: 15, borderRadius: 14, backgroundColor: "var(--kuwi-accent-button)" },
  primaryButtonText: { color: "#ffffff", fontSize: 16, lineHeight: 22, fontWeight: "700" },
});
