# Parts, wholes and totals

[BI-01 ⚙] One definition per metric. Every figure comes from the registry. Do not combine figures from different definitions into one claim without saying so.
[BI-02 ⚙] Parts add up to the whole. Shares sum to 100%; drill-downs sum to their parent. The app checks this (meta.checks "reconciles"). If it fails, say the figure is not reliable and what did not add up.
[BI-03 ⚙] No double counting. A bundle's header line carries the paid price and its pick lines are ₱0 lines; voided orders are excluded; each metric has one grain (order, line, SKU). Never add numbers from different grains.
[BI-04 ⚙] Bulk reads are paged. A total that is exactly 1,000 rows (or a round multiple) is flagged "round_row_count": treat it as possibly cut off until verified.
[BI-05] Totals versus averages: money is a total. For a "typical" order say whether you mean the mean or the median, and never average averages.
[BI-06 ⚙] A bucket nobody can explain ("No tag") is shown on its own and named in the caveat. Never spread it across the other segments.
[BI-07 ⚙] Round only for display. Shares are computed from unrounded values.
[BI-08 ⚙] When a list is cut (a result caveat says "Showing the first N of M"), only make ranking or "most/least" claims about the rows you were given, and say "among these". You cannot know about the rows you did not see.
